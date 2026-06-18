// Supabase Storage 구현. 반드시 브라우저(supabase-js)에서 호출 — RLS가 auth.uid()로
// 본인 폴더만 허용하기 때문(서버 라우트엔 JWT 없어 깨짐. meetingsSync와 동일 원칙).
// 버킷 'recordings'(private), 경로 = {user_id}/{uuid}.{ext}.
import { supabase } from '@/lib/supabase';
import { NO_RECORDING_STORAGE, type RecordingStorage, type RecordingStorageName, type UploadResult } from './types';

const BUCKET = 'recordings';

// webm/mp3/m4a/wav → 확장자 추정(미상이면 bin). 경로 가독성·디버깅용일 뿐 변환엔 무관.
function extFromType(type: string): string {
  if (!type) return 'bin';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'bin';
}

export class SupabaseRecordingStorage implements RecordingStorage {
  readonly name: RecordingStorageName = 'supabase';

  async upload(blob: Blob, opts?: { contentType?: string }): Promise<UploadResult> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error(NO_RECORDING_STORAGE);

    const contentType = opts?.contentType || blob.type || 'application/octet-stream';
    // RLS 정책이 storage.foldername[1] = auth.uid() 를 검사 → 첫 세그먼트는 반드시 user.id.
    const ref = `${user.id}/${crypto.randomUUID()}.${extFromType(contentType)}`;

    const { error } = await supabase.storage.from(BUCKET).upload(ref, blob, {
      contentType,
      upsert: false,
    });
    if (error) throw new Error(`녹음 업로드 실패: ${error.message}`);
    return { ref };
  }

  async getReadableUrl(ref: string, ttlSec: number): Promise<string> {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ref, ttlSec);
    if (error || !data?.signedUrl) {
      throw new Error(`서명 URL 생성 실패: ${error?.message || '알 수 없음'}`);
    }
    return data.signedUrl;
  }

  async delete(ref: string): Promise<void> {
    // 베스트에포트: 실패해도 throw 안 함(고아 사본은 Phase 3 배치 청소 대상).
    const { error } = await supabase.storage.from(BUCKET).remove([ref]);
    if (error) console.warn('[recordingsStorage] 임시 사본 삭제 실패:', error.message);
  }
}
