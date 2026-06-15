import type { TranscriptSegment, TranscriptionResult } from '@/lib/stt/types';

// transcript 입력 3종(평문 string / 세그먼트 배열 / TranscriptionResult)을
// 단일 TranscriptSegment[]로 수렴시키는 순수 함수 모음. 외부 의존 없음.

// TranscriptionResult 판별 (segments 속성 보유 객체)
function isTranscriptionResult(
  input: unknown
): input is TranscriptionResult {
  return (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { segments?: unknown }).segments)
  );
}

// 거친 transcript를 표준 세그먼트 배열로 정규화한다. throw 금지.
export function normalizeTranscript(
  input: string | TranscriptSegment[] | TranscriptionResult
): TranscriptSegment[] {
  // 세그먼트 배열: 그대로 통과 (빈 배열 OK)
  if (Array.isArray(input)) {
    return input;
  }

  // TranscriptionResult: segments 추출
  if (isTranscriptionResult(input)) {
    return input.segments;
  }

  // string: 빈 문자열/공백뿐이면 [], 아니면 단일 Unknown 세그먼트
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  return [{ speaker: 'Unknown', text: trimmed, start: 0, end: 0 }];
}

// 화자 라벨이 의미를 가지는지(Unknown 외 화자가 하나라도 있는지) 판정
function hasNamedSpeaker(segments: TranscriptSegment[]): boolean {
  return segments.some((s) => s.speaker && s.speaker !== 'Unknown');
}

// 세그먼트를 텍스트로 합친다.
// 화자가 모두 'Unknown'이면 라벨 생략, 화자가 있으면 "화자: 텍스트" 형식.
export function segmentsToText(segments: TranscriptSegment[]): string {
  if (segments.length === 0) {
    return '';
  }

  if (!hasNamedSpeaker(segments)) {
    return segments.map((s) => s.text).join('\n');
  }

  return segments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
}

// summarize 프롬프트용 포맷. 화자 있으면 "화자: ...", Unknown이면 그냥 text.
// (segmentsToText와 유사하나 세그먼트별로 개별 판정하여 프롬프트 친화적)
export function formatSegmentsForPrompt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) {
    return '';
  }

  return segments
    .map((s) =>
      s.speaker && s.speaker !== 'Unknown' ? `${s.speaker}: ${s.text}` : s.text
    )
    .join('\n');
}
