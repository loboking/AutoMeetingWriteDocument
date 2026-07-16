// Gemini 오디오 STT provider. 네이티브 generateContent API(OpenAI 호환 아님).
// STT + 화자분리 동시 수행 — 응답 텍스트에 "화자 1: ... 화자 2: ..." 형태로 라벨이 포함됨.
// Whisper fallback(factory.ts)과 병존하며, STT_PROVIDER=gemini-audio일 때만 선택된다.
//
// 의존성 추가 없음: @google/generative-ai SDK 대신 fetch 직접 호출.
// 토큰 실측: usageMetadata에서 input/output/thoughts/total 추출 → tokenUsage(op='stt').
import {
  NO_STT_PROVIDER,
  type STTProvider,
  type STTProviderName,
  type STTTranscribeOptions,
  type TranscriptSegment,
  type TranscriptionResult,
} from './types';

// Gemini 네이티브 generateContent 엔드포인트. OpenAI 호환(/v1beta/openai/)이 아님.
const GEMINI_GENERATE_CONTENT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini File API 엔드포인트. inlineData 16MB 한계를 넘는 큰 오디오 전용.
// 업로드는 /upload/v1beta/files(multipart/related), 상태 폴링은 /v1beta/{name}.
const GEMINI_FILES_ENDPOINT = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_FILE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// inlineData 한계(약 16MB). 이 크기를 넘으면 File API로 업로드 후 file_uri로 참조.
// Gemini inlineData 공식 한계 ~20MB이나 실사용 15MB 이하 권장. 15MB로 잡아 마진 확보.
const INLINE_DATA_MAX_BYTES = 15 * 1024 * 1024;

// File API 업로드 후 ACTIVE 상태 폴링 상한. 보통 수 초 내 ACTIVE. 60s 초과 시 throw.
const FILE_POLL_TIMEOUT_MS = 60_000;
const FILE_POLL_INTERVAL_MS = 1_000;

// STT용 모델. LLM용 GEMINI_MODEL과 분리(STT와 LLM이 다른 모델을 쓸 수 있게).
function resolveModel(): string {
  return process.env.GEMINI_STT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

// Gemini generateContent 응답의 usageMetadata 형태.
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

// generateContent 응답에서 텍스트 부분만 추출. candidates[0].content.parts[].text 를 이어붙임.
interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: GeminiUsageMetadata;
}

// File API 업로드 응답. file.state는 PROCESSING → ACTIVE. 실패 시 FAILED.
interface GeminiFileResource {
  name: string; // "files/xxx"
  displayName?: string;
  mimeType: string;
  uri: string; // "https://generativelanguage.googleapis.com/v1beta/files/xxx"
  // Gemini File API는 enum명(FILE_STATE_ACTIVE)이 아니라 짧은 형태('ACTIVE')로 응답.
  state?: 'ACTIVE' | 'PROCESSING' | 'FAILED' | 'FILE_STATE_ACTIVE' | 'FILE_STATE_PROCESSING' | 'FILE_STATE_FAILED';
  error?: { code?: number; message?: string };
}

interface GeminiUploadResponse {
  file: GeminiFileResource;
}

// 폴링(GET /v1beta/{name}) 응답은 루트 자체가 파일 리소스다 (file 래핑 없음 — 업로드 응답과 다름).
type GeminiFileGetResponse = GeminiFileResource;

// File API로 오디오 업로드. Gemini는 resumable upload 프로토콜을 쓴다(단일 multipart/related는
// metadata 파트 크기 한계로 400). 2단계:
//   1. POST /upload/v1beta/files?uploadType=resumable + JSON metadata → 응답 헤더 Location(session URI)
//   2. PUT sessionURI + 오디오 바이너리 → 응답 body에 file 리소스(uri/name/state)
// Returns: { uri, name, mimeType } — generateContent fileData 참조용.
// throws: 각 단계 비-2xx, 응답 파싱 실패, file 누락. API 키는 URL query에만 있고 message에 안 섞임.
async function uploadGeminiFile(
  audio: Buffer,
  mimeType: string,
  apiKey: string,
  displayName = 'stt-audio'
): Promise<{ uri: string; name: string; mimeType: string }> {
  // step1: resumable 세션 시작 (metadata-only). 응답 헤더 Location에 session URI.
  const startUrl = `${GEMINI_FILES_ENDPOINT}?uploadType=resumable&key=${apiKey}`;
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { displayName } }),
  });
  if (!startRes.ok) {
    let detail = '';
    try {
      detail = await startRes.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Gemini File API resumable 시작 실패 (${startRes.status}): ${detail}`.trim()
    );
  }
  const sessionUri = startRes.headers.get('location');
  if (!sessionUri) {
    throw new Error('Gemini File API resumable 응답에 Location 헤더 누락');
  }

  // step2: PUT 바이너리 → 응답 body file 리소스.
  const putRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Length': String(audio.byteLength) },
    body: new Uint8Array(audio),
  });
  if (!putRes.ok) {
    let detail = '';
    try {
      detail = await putRes.text();
    } catch {
      // ignore
    }
    throw new Error(`Gemini File API 업로드 실패 (${putRes.status}): ${detail}`.trim());
  }

  let data: GeminiUploadResponse;
  try {
    data = (await putRes.json()) as GeminiUploadResponse;
  } catch (e) {
    throw new Error(
      `Gemini File API 업로드 응답 파싱 실패: ${e instanceof Error ? e.message : 'unknown'}`
    );
  }

  const file = data.file;
  if (!file?.uri || !file?.name) {
    throw new Error('Gemini File API 업로드 응답에 file.uri/name 누락');
  }
  return { uri: file.uri, name: file.name, mimeType: file.mimeType || mimeType };
}

// 업로드한 파일이 ACTIVE(변환 완료) 상태가 될 때까지 폴링.
// PROCESSING 사이에 폴링 간격 1s. timeoutMs(60s) 초과 시 throw — 무한 루프 금지.
// FAILED 상태면 즉시 throw.
async function pollGeminiFileActive(
  name: string,
  apiKey: string,
  timeoutMs = FILE_POLL_TIMEOUT_MS
): Promise<void> {
  const url = `${GEMINI_FILE_BASE}/${name}?key=${apiKey}`;
  const deadline = Date.now() + timeoutMs;
  let lastState = '';
  while (Date.now() < deadline) {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
      throw new Error(`Gemini File API poll 실패 (${res.status}): ${detail}`.trim());
    }
    let data: GeminiFileGetResponse;
    try {
      data = (await res.json()) as GeminiFileGetResponse;
    } catch (e) {
      throw new Error(
        `Gemini File API poll 응답 파싱 실패: ${e instanceof Error ? e.message : 'unknown'}`
      );
    }
    // GET 응답은 루트가 곧 file 리소스. name/state 필수.
    const file = data;
    if (!file?.name || !file?.state) {
      throw new Error('Gemini File API poll 응답에 name/state 누락');
    }
    lastState = file.state;
    // API 응답은 짧은 형태('ACTIVE'/'PROCESSING'/'FAILED'). enum명도 허용(방어).
    if (file.state === 'ACTIVE' || file.state === 'FILE_STATE_ACTIVE') return;
    if (file.state === 'FAILED' || file.state === 'FILE_STATE_FAILED') {
      const msg = file.error?.message || '업로드 파일 처리 실패(FAILED)';
      throw new Error(`Gemini File API 파일 처리 실패: ${msg}`);
    }
    // PROCESSING → 계속 폴링
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Gemini File API ACTIVE 대기 타임아웃(${timeoutMs}ms, 마지막 상태=${lastState})`
  );
}

// 화자 라벨 매칭(캡처 없는 split용). "화자 1:", "Speaker 1:", " speaker 1 -" 등 대응.
// Gemini 한국어 프롬프트로 "화자 N:" 형태를 유도하지만, 영문 라벨이 섞여 나올 수도 있어 둘 다 잡는다.
const SPEAKER_LABEL_RE = /(?:화자|Speaker|speaker|발화자)\s*(\d+)\s*[:：\-]\s*/;

// Gemini 오디오 응답 텍스트 → TranscriptSegment[].
// Gemini는 타임스탬프를 주지 않으므로 start/end는 0(정보 없음). 화자 라벨은 텍스트에서 파싱.
function parseTranscript(rawText: string): TranscriptSegment[] {
  const text = rawText.trim();
  if (!text) return [];

  // 정규식으로 텍스트를 (라벨, 발화) 쌍으로 분해.
  // 전역 없는 정규식을 exec로 수동 반복 — 매치마다 이전 매치 끝~현재 매치 시작 사이
  // "라벨 없는 텍스트"가 있으면 Unknown으로, 라벨 이후 텍스트는 해당 화자로.
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  let pendingSpeaker: string | null = null; // 직전 라벨 (다음 매치 전까지의 텍스트가 이 화자 발화)

  let m: RegExpExecArray | null;
  const re = new RegExp(SPEAKER_LABEL_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    // 직전 라벨~이번 라벨 사이 텍스트 = 직전 화자의 발화
    const between = text.slice(cursor, m.index).trim();
    if (between && pendingSpeaker) {
      segments.push({ speaker: pendingSpeaker, text: between, start: 0, end: 0 });
    } else if (between && !pendingSpeaker) {
      // 첫 라벨 이전 라벨 없는 텍스트 → Unknown
      segments.push({ speaker: 'Unknown', text: between, start: 0, end: 0 });
    }
    pendingSpeaker = `화자 ${m[1]}`;
    cursor = m.index + m[0].length;
  }

  // 마지막 라벨 이후 남은 텍스트
  const tail = text.slice(cursor).trim();
  if (tail && pendingSpeaker) {
    segments.push({ speaker: pendingSpeaker, text: tail, start: 0, end: 0 });
  } else if (tail && !pendingSpeaker) {
    // 라벨이 전혀 없음 → 통째로 Unknown
    segments.push({ speaker: 'Unknown', text: tail, start: 0, end: 0 });
  }

  return segments;
}

export class GeminiAudioProvider implements STTProvider {
  readonly name: STTProviderName = 'gemini-audio';

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  async transcribe(audio: Buffer, opts?: STTTranscribeOptions): Promise<TranscriptionResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(NO_STT_PROVIDER);
    }

    const language = opts?.language || 'ko';
    const model = resolveModel();

    // 원본 MIME → Gemini mimeType. 미지정 시 webm 가정(브라우저 녹음 기본).
    const mimeType = (opts?.contentType || 'audio/webm').toLowerCase();

    // (b) 분기: 15MB 미만은 inlineData(빠름, 기존 경로), 이상은 File API 업로드 후 file_uri.
    // Gemini inlineData는 약 16MB에서 400/413으로 거절. 큰 회의록(20-50MB)은 File API 필수.
    const useFileApi = audio.byteLength > INLINE_DATA_MAX_BYTES;

    // 프롬프트: 한국어 화자분리 요청. Gemini 오디오가 텍스트 응답에 "화자 N: ..." 형태로
    // 라벨을 붙이도록 유도. 파일럿 실측에서 3명 화자 정확 분리 확인.
    const prompt =
      language === 'ko'
        ? '이 오디오를 한국어로 전사하고, 화자를 구분해 "화자 1: ", "화자 2: " 형태로 라벨을 붙여 주세요. 발화 내용만 출력하고 요약하지 마세요.'
        : 'Transcribe this audio and label each speaker as "Speaker 1: ", "Speaker 2: " etc. Output only the transcript, no summary.';

    // 오디오 파트: inlineData(작은 파일) 또는 fileData(File API 업로드 후).
    let audioPart: { inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string; mimeType: string } };
    if (useFileApi) {
      const uploaded = await uploadGeminiFile(audio, mimeType, apiKey);
      await pollGeminiFileActive(uploaded.name, apiKey);
      audioPart = { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType } };
    } else {
      const base64Audio = audio.toString('base64');
      audioPart = { inlineData: { mimeType, data: base64Audio } };
    }

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }, audioPart],
        },
      ],
      generationConfig: {
        // 오디오 STT는 저온도(결정적 전사).
        temperature: 0,
      },
    };

    const url = `${GEMINI_GENERATE_CONTENT_ENDPOINT}/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      throw new Error(`Gemini Audio API error (${response.status}): ${detail}`.trim());
    }

    const data = (await response.json()) as GeminiGenerateResponse;

    // candidates[0].content.parts[].text 이어붙임
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const fullText = parts
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('')
      .trim();

    const segments = parseTranscript(fullText);
    const flatText = fullText; // Gemini 응답 전체(라벨 포함)를 text로 둔다
    const hasDiarization = segments.some((s) => s.speaker !== 'Unknown');

    return {
      segments,
      text: flatText,
      duration: 0, // Gemini 오디오는 duration을 주지 않음
      language,
      provider: 'gemini-audio',
      hasSpeakerDiarization: hasDiarization,
    };
  }
}

// tokenUsage(op='stt')용 usage 추출 헬퍼. Gemini usageMetadata → LLMUsage 호환 형태.
// thoughtsTokenCount는 output에 포함(Gemini가 thoughts를 output 토큰으로 과금).
export function extractGeminiAudioUsage(meta?: GeminiUsageMetadata): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | undefined {
  if (!meta) return undefined;
  const inputTokens = meta.promptTokenCount ?? 0;
  const thoughts = meta.thoughtsTokenCount ?? 0;
  const outputTokens = (meta.candidatesTokenCount ?? 0) + thoughts;
  const totalTokens = meta.totalTokenCount ?? inputTokens + outputTokens;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}
