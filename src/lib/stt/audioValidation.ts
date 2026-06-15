// 오디오 입력 검증: 형식/크기/빈 파일. 서버·클라 양쪽에서 사용.
import { routeInputFile } from '@/lib/inputRouter';

export const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB (클라이언트 업로드 상한)
export const WHISPER_API_MAX_SIZE = 25 * 1024 * 1024; // 25MB (Whisper API 한계 → 초과 시 청크 필요)

export interface AudioValidationResult {
  ok: boolean;
  error?: string;
  needsChunking?: boolean; // Whisper API 25MB 초과 시 true (P2 청크 분할 대상)
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
  return { ok: true, needsChunking: file.size > WHISPER_API_MAX_SIZE };
}
