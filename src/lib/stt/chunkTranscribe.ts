// 25MB(Whisper 파일당 한계)를 넘는 오디오를 바이트 청크로 나눠 병렬 STT 후 이어붙인다.
// 베타 범위: ffmpeg 미사용(번들 50MB·cold start 부담 회피). 바이트 슬라이스는
// 프레임 경계가 관대한 mp3/mpeg에서 실무상 동작하고, 녹음 webm은 useRecorder의
// 32kbps 저비트레이트로 25MB 안에 들어오게 해 청크 경로 자체를 회피한다.
import { WhisperApiProvider } from './factory';
import type { STTProvider, STTTranscribeOptions, TranscriptSegment, TranscriptionResult } from './types';

// Whisper 25MB 한계 직전. 청크당 이 크기로 분할.
const CHUNK_BYTES = 20 * 1024 * 1024;

// 바이트 슬라이스가 STT에서 안전한 포맷인지(프레임 경계 관대). webm/ogg는 컨테이너라 위험.
function isByteSliceable(contentType?: string): boolean {
  const t = (contentType || '').toLowerCase();
  return t.includes('mpeg') || t.includes('mp3') || t.includes('mpga');
}

export function needsChunking(byteLength: number): boolean {
  return byteLength > CHUNK_BYTES;
}

export function canChunk(contentType?: string): boolean {
  return isByteSliceable(contentType);
}

/**
 * 큰 오디오 Buffer를 CHUNK_BYTES 단위로 나눠 병렬 STT 후 결과를 이어붙인다.
 * segment timestamp는 청크 누적 duration으로 전역 보정한다.
 * 호출 전 canChunk(contentType)로 분할 가능 포맷인지 확인할 것.
 *
 * provider 주입: caller가 getServerProvider() 결과를 넘긴다. 과거엔 new WhisperApiProvider()로
 * hardcoded되어 STT_PROVIDER=gemini-audio여도 큰 파일은 무조건 Whisper로 가 401(키 없음) 실패했음
 * (2026-07-16 회귀). 미주입 시 기존 호환을 위해 Whisper로 폴백.
 */
export async function transcribeChunked(
  buffer: Buffer,
  opts?: STTTranscribeOptions,
  provider: STTProvider = new WhisperApiProvider()
): Promise<TranscriptionResult> {

  const chunks: Buffer[] = [];
  for (let i = 0; i < buffer.byteLength; i += CHUNK_BYTES) {
    chunks.push(buffer.subarray(i, i + CHUNK_BYTES));
  }

  // Whisper는 stateless → 병렬. 베타 규모라 rate limit 무관.
  const results = await Promise.all(chunks.map((chunk) => provider.transcribe(chunk, opts)));

  let offset = 0;
  const segments: TranscriptSegment[] = [];
  let text = '';

  for (const r of results) {
    for (const seg of r.segments) {
      segments.push({ ...seg, start: seg.start + offset, end: seg.end + offset });
    }
    text += (text ? ' ' : '') + r.text;
    offset += r.duration || 0;
  }

  return {
    segments,
    text,
    duration: offset,
    language: results[0]?.language || opts?.language || 'ko',
    provider: 'whisper-api',
    hasSpeakerDiarization: false,
  };
}
