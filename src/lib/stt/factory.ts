import {
  NO_STT_PROVIDER,
  type STTProvider,
  type STTProviderName,
  type STTTranscribeOptions,
  type TranscriptSegment,
  type TranscriptionResult,
} from './types';

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

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audio)], { type: 'audio/webm' });
    formData.append('file', blob, 'audio.webm');
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
// OPENAI_API_KEY 있으면 Whisper API, 없으면 Dummy(NO_STT_PROVIDER 유도).
// NOTE: 브라우저 전용 provider(transformers / web-speech)는 서버 factory에 포함하지 않는다.
//       해당 provider는 클라이언트 훅에서 처리한다.
export function getServerProvider(): STTProvider {
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
    case 'dummy':
    case 'transformers': // 브라우저 전용 — 서버에서는 미지원
    case 'web-speech': // 브라우저 전용 — 서버에서는 미지원
    default:
      return new DummyProvider();
  }
}
