// Cloudflare R2 저장소 구현(브라우저). Supabase 무료 플랜 50MB 업로드 한계 해제가 목적.
// 대용량은 S3 multipart upload(10MB 청크 순차) — 모바일 브라우저가 단일 PUT 55MB에서
// 메모리/연결이 죽어 "Failed to fetch"로 실패하는 문제의 표준 해법.
//
// 흐름: 클라가 /api/storage/sign(presign/multipart 제어, requireUser 인증) → R2 직접 PUT/GET.
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

// multipart 전환 임계 — 이보다 크면 청크 업로드(모바일 안전).
const MULTIPART_THRESHOLD = 16 * 1024 * 1024;
// 파트 크기 — S3 최소 5MB(마지막 제외)보다 큰 10MB. 폰 메모리 여유.
const PART_SIZE = 10 * 1024 * 1024;

interface SignResponse {
  key?: string;
  uploadUrl?: string;
  uploadId?: string;
  url?: string;
  ok?: boolean;
  error?: string;
  message?: string;
}

async function callSign(method: 'POST' | 'PUT' | 'DELETE', payload: unknown): Promise<{ res: Response; data: SignResponse }> {
  const res = await authedFetch('/api/storage/sign', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as SignResponse;
  return { res, data };
}

export class R2RecordingStorage implements RecordingStorage {
  readonly name = 'r2' as const;

  async upload(blob: Blob, opts?: { contentType?: string }): Promise<UploadResult> {
    const contentType = opts?.contentType || blob.type || 'application/octet-stream';
    const ext = extFromType(contentType);

    // 소형(≤16MB)은 단일 presigned PUT — 간단하고 빠름.
    if (blob.size <= MULTIPART_THRESHOLD) {
      const { res, data } = await callSign('POST', { contentType, ext });
      if (!res.ok || !data.key || !data.uploadUrl) {
        throw new Error(data.message || data.error || '녹음 업로드 준비에 실패했습니다.');
      }
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

    // 대형(>16MB) — multipart: 10MB 청크 순차 업로드. 모바일 메모리 안전.
    const { res: createRes, data: create } = await callSign('POST', {
      contentType,
      ext,
      mode: 'multipart-create',
    });
    if (!createRes.ok || !create.key || !create.uploadId) {
      throw new Error(create.message || create.error || '업로드 세션 생성에 실패했습니다.');
    }
    const { key, uploadId } = create;

    try {
      const parts: { partNumber: number; etag: string }[] = [];
      const totalParts = Math.ceil(blob.size / PART_SIZE);
      for (let i = 0; i < totalParts; i++) {
        const partNumber = i + 1;
        const chunk = blob.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
        const { res: pRes, data: p } = await callSign('PUT', {
          key,
          mode: 'multipart-part',
          uploadId,
          partNumber,
        });
        if (!pRes.ok || !p.url) throw new Error(p.message || '파트 서명 발급 실패');
        const put = await fetch(p.url, { method: 'PUT', body: chunk });
        if (!put.ok) {
          throw new Error(`파트 ${partNumber}/${totalParts} 업로드 실패 (R2 ${put.status})`);
        }
        const etag = put.headers.get('etag') || put.headers.get('ETag') || '';
        if (!etag) throw new Error(`파트 ${partNumber} ETag 없음`);
        parts.push({ partNumber, etag });
      }
      const { res: cRes, data: c } = await callSign('PUT', {
        key,
        mode: 'multipart-complete',
        uploadId,
        parts,
      });
      if (!cRes.ok || !c.ok) throw new Error(c.message || '업로드 완료 처리 실패');
      return { ref: key };
    } catch (e) {
      // 실패 시 미완성 파트 정리(방치되면 R2 저장 과금).
      void callSign('PUT', { key, mode: 'multipart-abort', uploadId }).catch(() => {});
      throw e;
    }
  }

  async getReadableUrl(ref: string, ttlSec: number): Promise<string> {
    const { res, data } = await callSign('PUT', { key: ref, ttlSec });
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
