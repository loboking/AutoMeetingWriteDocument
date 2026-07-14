import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GeminiAudioProvider, extractGeminiAudioUsage } from './geminiAudioProvider';

// generateContent 응답 mock (화자 라벨 포함)
function makeGeminiResponse(text: string, usage?: Record<string, number>) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: usage,
  };
}

function mockFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function mockFetchError(status: number) {
  return vi.fn(async () => ({
    ok: false,
    status,
    text: async () => 'gemini error',
    json: async () => ({ error: 'gemini error' }),
  })) as unknown as typeof fetch;
}

describe('GeminiAudioProvider', () => {
  const origKey = process.env.GEMINI_API_KEY;
  const origModel = process.env.GEMINI_STT_MODEL;
  const origLlmModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    delete process.env.GEMINI_STT_MODEL;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origKey;
    if (origModel === undefined) delete process.env.GEMINI_STT_MODEL;
    else process.env.GEMINI_STT_MODEL = origModel;
    if (origLlmModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = origLlmModel;
  });

  describe('isAvailable', () => {
    it('GEMINI_API_KEY가 있으면 true다', () => {
      process.env.GEMINI_API_KEY = 'gemini-test-key';
      expect(new GeminiAudioProvider().isAvailable()).toBe(true);
    });

    it('GEMINI_API_KEY가 없으면 false다', () => {
      delete process.env.GEMINI_API_KEY;
      expect(new GeminiAudioProvider().isAvailable()).toBe(false);
    });
  });

  describe('transcribe', () => {
    it('GEMINI_API_KEY 없으면 NO_STT_PROVIDER 에러', async () => {
      delete process.env.GEMINI_API_KEY;
      await expect(
        new GeminiAudioProvider().transcribe(Buffer.from('audio'))
      ).rejects.toThrow('NO_STT_PROVIDER');
    });

    it('화자 라벨이 포함된 응답을 TranscriptSegment로 파싱한다', async () => {
      const text = '화자 1: 안녕하세요\n화자 2: 네 반갑습니다\n화자 1: 회의 시작하죠';
      vi.stubGlobal('fetch', mockFetchOk(makeGeminiResponse(text)));

      const result = await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      expect(result.provider).toBe('gemini-audio');
      expect(result.hasSpeakerDiarization).toBe(true);
      expect(result.segments).toHaveLength(3);
      expect(result.segments[0]).toMatchObject({ speaker: '화자 1', text: '안녕하세요' });
      expect(result.segments[1]).toMatchObject({ speaker: '화자 2', text: '네 반갑습니다' });
      expect(result.segments[2]).toMatchObject({ speaker: '화자 1', text: '회의 시작하죠' });
    });

    it('화자 라벨이 없으면 통째로 Unknown 1세그먼트', async () => {
      const text = '그냥 일반 전사 텍스트입니다';
      vi.stubGlobal('fetch', mockFetchOk(makeGeminiResponse(text)));

      const result = await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      expect(result.hasSpeakerDiarization).toBe(false);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toMatchObject({ speaker: 'Unknown', text: '그냥 일반 전사 텍스트입니다' });
    });

    it('Gemini 네이티브 엔드포인트(generateContent)로 호출한다 (OpenAI 호환 아님)', async () => {
      const fetchMock = mockFetchOk(makeGeminiResponse('테스트'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('generativelanguage.googleapis.com');
      expect(calledUrl).toContain(':generateContent');
      expect(calledUrl).not.toContain('/openai/');
    });

    it('기본 모델은 gemini-2.5-flash다', async () => {
      const fetchMock = mockFetchOk(makeGeminiResponse('테스트'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/gemini-2.5-flash:generateContent');
    });

    it('GEMINI_STT_MODEL로 모델을 오버라이드한다', async () => {
      process.env.GEMINI_STT_MODEL = 'gemini-2.5-pro';
      const fetchMock = mockFetchOk(makeGeminiResponse('테스트'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/gemini-2.5-pro:generateContent');
    });

    it('STT 모델 미설정 시 GEMINI_MODEL(LLM용)으로 폴백한다', async () => {
      process.env.GEMINI_MODEL = 'gemini-2.0-flash';
      const fetchMock = mockFetchOk(makeGeminiResponse('테스트'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(Buffer.from('audio'));

      const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/gemini-2.0-flash:generateContent');
    });

    it('fetch가 비-OK면 에러를 throw한다', async () => {
      vi.stubGlobal('fetch', mockFetchError(403));
      await expect(
        new GeminiAudioProvider().transcribe(Buffer.from('audio'))
      ).rejects.toThrow();
    });

    it('요청 body에 base64 inlineData가 포함된다', async () => {
      const fetchMock = mockFetchOk(makeGeminiResponse('테스트'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(Buffer.from('audio'), { contentType: 'audio/mp3' });

      const callArgs = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const inlinePart = body.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData);
      expect(inlinePart).toBeTruthy();
      expect(inlinePart.inlineData.mimeType).toBe('audio/mp3');
      // base64 문자열이어야 함
      expect(typeof inlinePart.inlineData.data).toBe('string');
    });
  });

  describe('extractGeminiAudioUsage', () => {
    it('usageMetadata가 없으면 undefined', () => {
      expect(extractGeminiAudioUsage(undefined)).toBeUndefined();
    });

    it('파일럿 실측값(8.5분 mp3)을 올바르게 매핑한다', () => {
      // 실측: input 16,224 + output 2,698 + thoughts 2,435 = total 21,510(근사)
      const usage = extractGeminiAudioUsage({
        promptTokenCount: 16224,
        candidatesTokenCount: 2698,
        thoughtsTokenCount: 2435,
        totalTokenCount: 21357,
      });
      expect(usage).toBeDefined();
      expect(usage!.inputTokens).toBe(16224);
      // thoughts는 output에 포함
      expect(usage!.outputTokens).toBe(2698 + 2435);
      expect(usage!.totalTokens).toBe(21357);
    });

    it('input/output 모두 0이면 undefined', () => {
      expect(extractGeminiAudioUsage({ promptTokenCount: 0, candidatesTokenCount: 0 })).toBeUndefined();
    });
  });
});
