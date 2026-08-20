// 오디오 입력 검증: 형식/크기/빈 파일. 서버·클라 양쪽에서 사용.
import { routeInputFile } from '@/lib/inputRouter';

// 업로드 상한. 저장소가 R2(presigned PUT ~5GB)로 전환되며 500MB까지 허용.
// R2 미설정(Supabase 폴백) 환경은 storage가 50MB에서 413으로 안내하므로 여기선 완화만.
export const MAX_AUDIO_SIZE = 500 * 1024 * 1024;

export interface AudioValidationResult {
  ok: boolean;
  error?: string;
}

export function validateAudio(file: { name: string; type: string; size: number }): AudioValidationResult {
  if (routeInputFile(file) !== 'audio') {
    return { ok: false, error: '지원하지 않는 오디오 형식입니다. (mp3, wav, webm, m4a, ogg)' };
  }
  if (!file.size || file.size <= 0) {
    return { ok: false, error: '빈 오디오 파일입니다.' };
  }
  if (file.size > MAX_AUDIO_SIZE) {
    return { ok: false, error: `오디오 파일은 ${MAX_AUDIO_SIZE / 1024 / 1024}MB 이하여야 합니다.` };
  }
  return { ok: true };
}
