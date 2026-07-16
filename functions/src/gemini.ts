// Gemini 오디오 STT — Firebase Cloud Functions용.
// 원본: workers/stt-proxy/src/gemini.ts (Cloudflare Workers 런타임, ArrayBuffer 기반).
// 이 파일은 Firebase Functions(Node 20) 런타임에 맞춰 env 바인딩을 process.env로 교체.
//
// 핵심 수정점 (Workers 대비):
//   1. Workers `Env` 바인딩 → `process.env` (Firebase Functions 환경변수/Secret Manager).
//   2. ArrayBuffer/Uint8Array 로직은 그대로 — Node에서도 작동.
//   3. base64 인코딩(arrayBufferToBase64) 그대로 — Node의 globalThis.btoa 사용 가능.
//   4. Gemini 호출 실패 시 throw → 인덱스에서 catch → 502/503/504 응답.
//   5. geo-block 감지(GEMINI_GEO_BLOCKED) 유지 — Workers 특화 메시지였으나 fallback으로 남김.
//      us-central1 고정 배포가 핵심 회피책이지만, 여전히 방어 로직은 유지.

// Gemini 네이티브 generateContent 엔드포인트. OpenAI 호환(/v1beta/openai/)이 아님.
const GEMINI_GENERATE_CONTENT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini File API 엔드포인트. inlineData 한계(15MB) 넘는 큰 오디오 전용.
const GEMINI_FILES_ENDPOINT = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_FILE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// inlineData 한계(약 16MB). 이 크기를 넘으면 File API로 업로드 후 file_uri로 참조.
// 공식 한계 ~20MB이나 실사용 15MB 이하 권장 — 마진 확보.
const INLINE_DATA_MAX_BYTES = 15 * 1024 * 1024;

// 폴링 간격/상한. Workers Free 50 subrequest 제약에서 온 값이나, Firebase Functions는
// 해당 제약 없음. 540s timeoutSeconds 내에서 충분히 안전(3s×15=45s 캡).
// 더 큰 오디오(35MB)도 File API 업로드 자체가 수 초이므로 45s 폴링으로 충분.
const FILE_POLL_MAX_ATTEMPTS = 15;
const FILE_POLL_INTERVAL_MS = 3_000;

export interface GeminiEnv {
  GEMINI_API_KEY: string;
  GEMINI_STT_MODEL?: string;
  GEMINI_MODEL?: string;
}

// Firebase Functions 환경변수에서 GeminiEnv 조립.
export function loadGeminiEnv(): GeminiEnv {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
  const GEMINI_STT_MODEL = process.env.GEMINI_STT_MODEL || undefined;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || undefined;
  return { GEMINI_API_KEY, GEMINI_STT_MODEL, GEMINI_MODEL };
}

function resolveModel(env: GeminiEnv): string {
  return env.GEMINI_STT_MODEL || env.GEMINI_MODEL || 'gemini-2.5-flash';
}

// ArrayBuffer → base64 문자열. Node의 globalThis.btoa 사용.
// chunk 단위로 String.fromCharCode 변환(btoa의 call stack 한계 회피 — 큰 오디오도 안전).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]);
  }
  return btoa(binary);
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiFileResource {
  name: string;
  displayName?: string;
  mimeType: string;
  uri: string;
  state?: 'ACTIVE' | 'PROCESSING' | 'FAILED' | 'FILE_STATE_ACTIVE' | 'FILE_STATE_PROCESSING' | 'FILE_STATE_FAILED';
  error?: { code?: number; message?: string };
}

interface GeminiUploadResponse {
  file: GeminiFileResource;
}

type GeminiFileGetResponse = GeminiFileResource;

// File API로 오디오 업로드. resumable upload 2단계:
//   1. POST /upload/v1beta/files?uploadType=resumable + JSON metadata → Location 헤더(session URI)
//   2. PUT sessionURI + 오디오 바이너리 → file 리소스(uri/name/state)
async function uploadGeminiFile(
  audio: ArrayBuffer,
  mimeType: string,
  apiKey: string,
  displayName = 'stt-audio'
): Promise<{ uri: string; name: string; mimeType: string }> {
  // step1: resumable 세션 시작
  const startUrl = `${GEMINI_FILES_ENDPOINT}?uploadType=resumable&key=${apiKey}`;
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { displayName } }),
  });
  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => '');
    // Gemini File API는 일부 리전(한국 등)에서
    // "User location is not supported for the API use" 400으로 geo-block 함.
    // us-central1 배포가 회피책이지만 여전히 방어 — 503으로 클라이언트에 Vercel 폴백 안내.
    if (startRes.status === 400 && detail.includes('User location is not supported')) {
      throw new Error('GEMINI_GEO_BLOCKED: Functions 리전에서 Gemini API 차단됨');
    }
    throw new Error(`Gemini File API resumable 시작 실패 (${startRes.status}): ${detail}`.trim());
  }
  const sessionUri = startRes.headers.get('location');
  if (!sessionUri) {
    throw new Error('Gemini File API resumable 응답에 Location 헤더 누락');
  }

  // step2: PUT 바이너리 → file 리소스
  const putRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Length': String(audio.byteLength) },
    body: audio,
  });
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '');
    throw new Error(`Gemini File API 업로드 실패 (${putRes.status}): ${detail}`.trim());
  }

  let data: GeminiUploadResponse;
  try {
    data = (await putRes.json()) as GeminiUploadResponse;
  } catch (e) {
    throw new Error(`Gemini File API 업로드 응답 파싱 실패: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  const file = data.file;
  if (!file?.uri || !file?.name) {
    throw new Error('Gemini File API 업로드 응답에 file.uri/name 누락');
  }
  return { uri: file.uri, name: file.name, mimeType: file.mimeType || mimeType };
}

// 업로드한 파일이 ACTIVE 상태가 될 때까지 폴링.
// 3s 간격 15회(45s)로 캡. 15회 안에 ACTIVE 안 되면 throw → 인덱스에서 504 Gateway Timeout.
async function pollGeminiFileActive(
  name: string,
  apiKey: string
): Promise<void> {
  const url = `${GEMINI_FILE_BASE}/${name}?key=${apiKey}`;
  let lastState = '';
  for (let attempt = 0; attempt < FILE_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Gemini File API poll 실패 (${res.status}): ${detail}`.trim());
    }
    let data: GeminiFileGetResponse;
    try {
      data = (await res.json()) as GeminiFileGetResponse;
    } catch (e) {
      throw new Error(`Gemini File API poll 응답 파싱 실패: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    const file = data;
    if (!file?.name || !file?.state) {
      throw new Error('Gemini File API poll 응답에 name/state 누락');
    }
    lastState = file.state;
    if (file.state === 'ACTIVE' || file.state === 'FILE_STATE_ACTIVE') return;
    if (file.state === 'FAILED' || file.state === 'FILE_STATE_FAILED') {
      const msg = file.error?.message || '업로드 파일 처리 실패(FAILED)';
      throw new Error(`Gemini File API 파일 처리 실패: ${msg}`);
    }
    // PROCESSING → 다음 폴링까지 3s 대기
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Gemini File API ACTIVE 대기 시간 초과 (폴링 ${FILE_POLL_MAX_ATTEMPTS}회 / ${FILE_POLL_MAX_ATTEMPTS * FILE_POLL_INTERVAL_MS / 1000}s, 마지막 상태=${lastState})`
  );
}

// 화자 라벨 매칭. "화자 1:", "Speaker 1:", " speaker 1 -" 등 대응.
const SPEAKER_LABEL_RE = /(?:화자|Speaker|speaker|발화자)\s*(\d+)\s*[:：\-]\s*/;

export interface TranscriptSegment {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

// Gemini 응답 텍스트 → TranscriptSegment[] (타임스탬프 없음, start/end=0).
function parseTranscript(rawText: string): TranscriptSegment[] {
  const text = rawText.trim();
  if (!text) return [];

  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  let pendingSpeaker: string | null = null;

  let m: RegExpExecArray | null;
  const re = new RegExp(SPEAKER_LABEL_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const between = text.slice(cursor, m.index).trim();
    if (between && pendingSpeaker) {
      segments.push({ speaker: pendingSpeaker, text: between, start: 0, end: 0 });
    } else if (between && !pendingSpeaker) {
      segments.push({ speaker: 'Unknown', text: between, start: 0, end: 0 });
    }
    pendingSpeaker = `화자 ${m[1]}`;
    cursor = m.index + m[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail && pendingSpeaker) {
    segments.push({ speaker: pendingSpeaker, text: tail, start: 0, end: 0 });
  } else if (tail && !pendingSpeaker) {
    segments.push({ speaker: 'Unknown', text: tail, start: 0, end: 0 });
  }

  return segments;
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  text: string;
  duration: number;
  language: string;
  provider: 'gemini-audio';
  hasSpeakerDiarization: boolean;
}

// Gemini 오디오 STT 메인. 원본 GeminiAudioProvider.transcribe 와 동일 로직,
// ArrayBuffer, process.env, 폴링 캡 45s 유지.
export async function transcribeWithGemini(
  audio: ArrayBuffer,
  env: GeminiEnv,
  opts?: { language?: string; contentType?: string }
): Promise<TranscriptionResult> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('NO_STT_PROVIDER');
  }

  const language = opts?.language || 'ko';
  const model = resolveModel(env);
  const mimeType = (opts?.contentType || 'audio/webm').toLowerCase();

  const useFileApi = audio.byteLength > INLINE_DATA_MAX_BYTES;

  const prompt =
    language === 'ko'
      ? '이 오디오를 한국어로 전사하고, 화자를 구분해 "화자 1: ", "화자 2: " 형태로 라벨을 붙여 주세요. 발화 내용만 출력하고 요약하지 마세요.'
      : 'Transcribe this audio and label each speaker as "Speaker 1: ", "Speaker 2: " etc. Output only the transcript, no summary.';

  let audioPart:
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } };
  if (useFileApi) {
    const uploaded = await uploadGeminiFile(audio, mimeType, apiKey);
    await pollGeminiFileActive(uploaded.name, apiKey);
    audioPart = { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } };
  } else {
    const base64Audio = arrayBufferToBase64(audio);
    audioPart = { inlineData: { mimeType, data: base64Audio } };
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, audioPart],
      },
    ],
    generationConfig: { temperature: 0 },
  };

  const url = `${GEMINI_GENERATE_CONTENT_ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // generateContent도 File API와 동일한 geo-block 당함(5MB inlineData 경로에서도 재현).
    // GEMINI_GEO_BLOCKED로 통일 — index.ts catch에서 503 + 안내.
    if (response.status === 400 && detail.includes('User location is not supported')) {
      throw new Error('GEMINI_GEO_BLOCKED: Functions 리전에서 Gemini API 차단됨');
    }
    throw new Error(`Gemini Audio API error (${response.status}): ${detail}`.trim());
  }

  const data = (await response.json()) as GeminiGenerateResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const fullText = parts
    .map((p) => p.text ?? '')
    .filter(Boolean)
    .join('')
    .trim();

  const segments = parseTranscript(fullText);
  const hasDiarization = segments.some((s) => s.speaker !== 'Unknown');

  return {
    segments,
    text: fullText,
    duration: 0, // Gemini는 duration 미제공
    language,
    provider: 'gemini-audio',
    hasSpeakerDiarization: hasDiarization,
  };
}
