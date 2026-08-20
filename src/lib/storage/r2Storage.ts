// Cloudflare R2 저장소 구현(브라우저). Supabase 무료 플랜 50MB 업로드 한계 해제가 목적.
// R2 presigned PUT 직접 업로드는 ~5GB까지 가능하고 Vercel 바디 한계(4.5MB)를 통과하지 않는다.
//
// 흐름: 클라가 /api/storage/sign(PUT/GET presign 발급, requireUser 인증) → R2 직접 PUT/GET.
// 유저 격리: Supabase RLS가 하던 {user_id}/ 프리픽스 강제를 presign 라우트가 key로 대체.
import { authedFetch } from '@/lib/authFetch';
import { NO_RECORDING_STORAGE, type RecordingStorage, type UploadResult } from './types';

// webm/mp3/m4a/wav → 확장자(미상 bin). Storage key 가독성용.
function extFromType(type: string): string {
  if (!type) return 'bin';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'bin';
}

interface PresignResponse {
  key?: string;
  uploadUrl?: string;
  error?: string;
  message?: string;
}

export class R2RecordingStorage implements RecordingStorage {
  readonly name = 'r2' as const;

  async upload(blob: Blob, opts?: { contentType?: string }): Promise<UploadResult> {
    const contentType = opts?.contentType || blob.type || 'application/octet-stream';

    // 1) presign 발급 — 서버(requireUser)가 key를 {userId}/{uuid}.{ext}로 강제한다.
    const res = await authedFetch('/api/storage/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, ext: extFromType(contentType) }),
    });
    const data = (await res.json().catch(() => ({}))) as PresignResponse;
    if (!res.ok || !data.key || !data.uploadUrl) {
      throw new Error(data.message || data.error || '녹음 업로드 준비에 실패했습니다.');
    }

    // 2) R2 직접 PUT — presigned URL이라 자격증명 노출 없음. 파일은 Vercel을 거치지 않는다.
    const put = await fetch(data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
    if (!put.ok) {
      const detail = await put.text().catch(() => '');
      throw new Error(`녹음 업로드 실패 (R2 ${put.status}): ${detail.slice(0, 120)}`.trim());
    }
    return { ref: data.key };
  }

  async getReadableUrl(ref: string, ttlSec: number): Promise<string> {
    const res = await authedFetch('/api/storage/sign', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ref, ttlSec }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (!res.ok || !data.url) {
      throw new Error(data.message || '서명 URL 생성 실패');
    }
    return data.url;
  }

  async delete(ref: string): Promise<void> {
    // 베스트에포트: 실패해도 throw 안 함(성공 시에만 호출되는 임시 사본 정리).
    try {
      const res = await authedFetch('/api/storage/sign', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ref }),
      });
      if (!res.ok) console.warn('[r2Storage] 임시 사본 삭제 실패:', res.status);
    } catch (e) {
      console.warn('[r2Storage] 임시 사본 삭제 실패:', e);
    }
  }
}

export function isR2Configured(): boolean {
  return typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_R2_BUCKET_ENDPOINT_HOST;
}

export { NO_RECORDING_STORAGE };
