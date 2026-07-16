// 음성 → 텍스트 공용 클라이언트 헬퍼. FileUploader/VoiceRecorder/page.tsx 3곳이 공유.
// 흐름: 저장소 업로드 → 서명URL → /api/transcribe(JSON) → (503이면 브라우저 STT 폴백)
//      → finally에서 임시 사본 삭제(고아 방지). 저장소 업로드 실패 시 multipart 직접 POST 폴백.
import { authedFetch } from '@/lib/authFetch';
import { getRecordingStorage } from '@/lib/storage';
import { isNoSttProviderResponse } from '@/lib/stt/browserSTT';
import type { TranscriptSegment, TranscriptionResult } from '@/lib/stt/types';

const SIGNED_URL_TTL_SEC = 300; // 서버가 fetch할 동안만 유효
const MAX_DIRECT_POST_BYTES = 4 * 1024 * 1024; // multipart 직접 POST는 Vercel 4.5MB 한계 내에서만

export interface TranscribeResult {
  text: string;
  segments?: TranscriptSegment[];
  duration?: number;
}

export interface TranscribeDeps {
  // useBrowserSTT().transcribeBlob — 키 없음(503) 시 폴백. 훅 의존이라 주입받는다.
  browserTranscribe: (blob: Blob, language?: string) => Promise<TranscriptionResult | null>;
  browserError?: string | null;
  // 단계 전환 콜백(업로드중/변환중) — 진행률 라벨용. 선택.
  onPhase?: (phase: 'uploading' | 'transcribing') => void;
}

// 서버 응답(JSON) → 표준 결과
function pickFromResponse(data: { text?: string; segments?: TranscriptSegment[]; duration?: number }): TranscribeResult {
  return { text: data.text || '', segments: data.segments, duration: data.duration };
}

// Firebase Function STT URL(환경변수). 설정 시 클라가 Function으로 직접 호출 — Vercel 300s 한계 회피.
// us-central1 고정 배포로 Gemini geo-block 회피 (Workers HKG colo 문제 해결).
// 미설정 시 기존 /api/transcribe (Vercel) 경로 유지(폴백).
const STT_FUNCTION_URL = process.env.NEXT_PUBLIC_STT_FUNCTION_URL;

// Function 장애(502/504/네트워크) 시 자동으로 Vercel /api/transcribe 로 폴백.
// 회귀 0 — STT_FUNCTION_URL 미설정 시 100% 기존 동작. 설정 시에도 폴백 안전망 유지.
function isFunctionFallbackStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

// /api/transcribe 또는 Function 호출(JSON signedUrl 또는 multipart). 응답 객체를 그대로 반환.
// 분기: STT_FUNCTION_URL 설정 + JSON(signedUrl) → Function. 그 외 → 기존 Vercel /api/transcribe.
//       Function 502/503/504 → 자동 Vercel 폴백(재시도 1회).
async function callTranscribe(body: { signedUrl: string; language: string } | FormData): Promise<Response> {
  // multipart(FormData)는 작은 파일 직접 업로드 경로 — Function은 signedUrl만 받으므로
  // 이 경로는 항상 Vercel. STT_FUNCTION_URL 설정 여부와 무관.
  if (body instanceof FormData) {
    return authedFetch('/api/transcribe', { method: 'POST', body });
  }

  // JSON(signedUrl) — Function URL 있으면 Function 우선, 장애 시 Vercel 폴백.
  if (STT_FUNCTION_URL) {
    const fnRes = await authedFetch(STT_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!isFunctionFallbackStatus(fnRes.status)) {
      return fnRes;
    }
    // Function 502/503/504 → Vercel 폴백 (TODO: 중복 Gemini 호출 비용/과금 영향 P1 검토)
    console.warn(
      `[transcribeAudio] Function ${fnRes.status}, Vercel /api/transcribe 로 폴백`
    );
  }

  return authedFetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * 음성 Blob을 텍스트로 변환. 성공 시 결과 반환, 실패 시 throw(메시지는 사용자 노출용).
 */
export async function transcribeAudio(
  blob: Blob,
  language: string,
  deps: TranscribeDeps
): Promise<TranscribeResult> {
  const storage = getRecordingStorage();
  let ref: string | null = null;

  try {
    // 1) 저장소 업로드 → 서명 URL (Vercel 4.5MB 우회). 실패하면 multipart 직접 POST로 폴백.
    let response: Response;
    try {
      deps.onPhase?.('uploading');
      const uploaded = await storage.upload(blob, { contentType: blob.type });
      ref = uploaded.ref;
      const signedUrl = await storage.getReadableUrl(ref, SIGNED_URL_TTL_SEC);
      deps.onPhase?.('transcribing');
      response = await callTranscribe({ signedUrl, language });
    } catch (uploadErr) {
      // 저장소 미설정/업로드 실패 → 작은 파일은 직접 POST로 폴백(안전망)
      console.warn('[transcribeAudio] 저장소 경로 실패, multipart 폴백 시도:', uploadErr);
      if (blob.size > MAX_DIRECT_POST_BYTES) {
        throw new Error('오디오 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      const fd = new FormData();
      fd.append('audioFile', blob, 'audio.webm');
      fd.append('language', language);
      deps.onPhase?.('transcribing');
      response = await callTranscribe(fd);
    }

    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      const result = pickFromResponse(data);
      if (!result.text.trim()) throw new Error('변환된 텍스트가 비어 있습니다.');
      return result;
    }

    // 2) 키 없음(503) → 브라우저 무료 STT 폴백
    if (isNoSttProviderResponse(data)) {
      const browser = await deps.browserTranscribe(blob, language);
      if (!browser || !browser.text.trim()) {
        throw new Error(deps.browserError || '브라우저 음성 변환에 실패했습니다.');
      }
      return { text: browser.text, segments: browser.segments, duration: browser.duration };
    }

    // 3) 그 외 서버 에러
    throw new Error(data.message || data.error || '음성 변환에 실패했습니다.');
  } finally {
    // 변환 성공/실패/폴백 어느 경로든 임시 사본 정리(베스트에포트)
    if (ref) void storage.delete(ref);
  }
}
