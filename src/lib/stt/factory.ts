import {
  NO_STT_PROVIDER,
  type STTProvider,
  type STTProviderName,
  type STTTranscribeOptions,
  type TranscriptSegment,
  type TranscriptionResult,
} from './types';
import { GeminiAudioProvider } from './geminiAudioProvider';
export { GeminiAudioProvider };

// Whisper는 OpenAI 전용. z.ai BASE(ZAI_BASE_URL)는 STT 404이므로 절대 사용하지 않는다.
const OPENAI_TRANSCRIPTIONS_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

// verbose_json 응답의 segment 형태 (start/end/text만 사용)
interface WhisperVerboseSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperVerboseResponse {
  text: string;
  duration?: number;
  language?: string;
  segments?: WhisperVerboseSegment[];
}

// 원본 MIME → Whisper에 보낼 (mime, 확장자). Whisper 지원: mp3/mp4/m4a/wav/webm/ogg/flac/mpeg/mpga.
// 미상이면 webm으로 가정(브라우저 녹음 기본 포맷).
function whisperFileMeta(contentType?: string): { mime: string; ext: string } {
  const t = (contentType || '').toLowerCase();
  if (t.includes('m4a') || t.includes('mp4') || t.includes('aac')) return { mime: 'audio/mp4', ext: 'm4a' };
  if (t.includes('mpeg') || t.includes('mp3') || t.includes('mpga')) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (t.includes('wav')) return { mime: 'audio/wav', ext: 'wav' };
  if (t.includes('ogg') || t.includes('oga')) return { mime: 'audio/ogg', ext: 'ogg' };
  if (t.includes('flac')) return { mime: 'audio/flac', ext: 'flac' };
  if (t.includes('webm')) return { mime: 'audio/webm', ext: 'webm' };
  return { mime: 'audio/webm', ext: 'webm' };
}

export class WhisperApiProvider implements STTProvider {
  readonly name: STTProviderName = 'whisper-api';

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async transcribe(audio: Buffer, opts?: STTTranscribeOptions): Promise<TranscriptionResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(NO_STT_PROVIDER);
    }

    const language = opts?.language || 'ko';

    // Whisper는 파일 확장자로 포맷을 판단한다. 원본 MIME에 맞는 확장자/타입을 보내야
    // m4a·mp3·wav 등이 디코딩 실패(500) 없이 변환된다. (이전엔 무조건 audio.webm 고정 → m4a 깨짐)
    const { mime, ext } = whisperFileMeta(opts?.contentType);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: mime });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'verbose_json');

    const response = await fetch(OPENAI_TRANSCRIPTIONS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      throw new Error(`Whisper API error (${response.status}): ${detail}`.trim());
    }

    const data = (await response.json()) as WhisperVerboseResponse;

    const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
      speaker: 'Unknown', // MVP: 화자분리 OFF
      text: (s.text ?? '').trim(),
      start: s.start,
      end: s.end,
    }));

    return {
      segments,
      text: data.text,
      duration: data.duration ?? 0,
      language: data.language || language,
      provider: 'whisper-api',
      hasSpeakerDiarization: false,
    };
  }
}

// 서버에 STT 수단이 없을 때 graceful 에러를 유도하는 placeholder provider.
export class DummyProvider implements STTProvider {
  readonly name: STTProviderName = 'dummy';

  isAvailable(): boolean {
    return true;
  }

  // 인자는 무시하지만 STTProvider 시그니처를 만족시키기 위해 선언만 둔다.
  async transcribe(_audio: Buffer, _opts?: STTTranscribeOptions): Promise<TranscriptionResult> {
    void _audio;
    void _opts;
    throw new Error(NO_STT_PROVIDER);
  }
}

// 서버측 provider 선택.
// STT_PROVIDER 노브(gemini-audio|whisper, 기본 whisper) + isAvailable 폴백.
//   - gemini-audio 명시: GEMINI_API_KEY 있으면 Gemini 오디오, 없으면 Whisper로 폴백.
//   - whisper(기본): OPENAI_API_KEY 있으면 Whisper, 없으면 Dummy(NO_STT_PROVIDER 유도).
// NOTE: 브라우저 전용 provider(transformers / web-speech)는 서버 factory에 포함하지 않는다.
//       해당 provider는 클라이언트 훅에서 처리한다.
export function getServerProvider(): STTProvider {
  const preferred = (process.env.STT_PROVIDER || 'whisper').toLowerCase();
  if (preferred === 'gemini-audio') {
    const gemini = new GeminiAudioProvider();
    if (gemini.isAvailable()) return gemini;
    // GEMINI_API_KEY 없으면 Whisper로 폴백
  }
  if (process.env.OPENAI_API_KEY) {
    return new WhisperApiProvider();
  }
  return new DummyProvider();
}

// 이름으로 provider 인스턴스 생성.
// transformers / web-speech는 브라우저 전용이라 서버 factory에서 dummy로 폴백한다.
export function createProvider(name: STTProviderName): STTProvider {
  switch (name) {
    case 'whisper-api':
      return new WhisperApiProvider();
    case 'gemini-audio':
      return new GeminiAudioProvider();
    case 'dummy':
    case 'transformers': // 브라우저 전용 — 서버에서는 미지원
    case 'web-speech': // 브라우저 전용 — 서버에서는 미지원
    default:
      return new DummyProvider();
  }
}
