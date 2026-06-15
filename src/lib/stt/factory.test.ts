import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getServerProvider, createProvider, WhisperApiProvider, DummyProvider } from './factory';
import { NO_STT_PROVIDER } from './types';

// verbose_json 형태의 Whisper 응답 mock
function makeVerboseJsonResponse() {
  return {
    text: '안녕하세요 회의를 시작하겠습니다',
    duration: 12.5,
    language: 'korean',
    segments: [
      { start: 0, end: 5.2, text: '안녕하세요' },
      { start: 5.2, end: 12.5, text: '회의를 시작하겠습니다' },
    ],
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
    text: async () => 'unauthorized',
    json: async () => ({ error: 'unauthorized' }),
  })) as unknown as typeof fetch;
}

describe('getServerProvider', () => {
  const original = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it('OPENAI_API_KEY가 있으면 whisper-api provider를 반환한다', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const provider = getServerProvider();
    expect(provider.name).toBe('whisper-api');
    expect(provider.isAvailable()).toBe(true);
  });

  it('OPENAI_API_KEY가 없으면 dummy provider를 반환한다', () => {
    delete process.env.OPENAI_API_KEY;
    const provider = getServerProvider();
    expect(provider.name).toBe('dummy');
  });
});

describe('createProvider', () => {
  it('이름으로 해당 provider 인스턴스를 반환한다', () => {
    expect(createProvider('whisper-api').name).toBe('whisper-api');
    expect(createProvider('dummy').name).toBe('dummy');
  });
});

describe('DummyProvider', () => {
  it('isAvailable()는 true다', () => {
    expect(new DummyProvider().isAvailable()).toBe(true);
  });

  it('transcribe()는 NO_STT_PROVIDER 에러를 throw한다', async () => {
    const provider = new DummyProvider();
    await expect(provider.transcribe(Buffer.from('x'))).rejects.toThrow(NO_STT_PROVIDER);
  });
});

describe('WhisperApiProvider', () => {
  const original = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });

  it('isAvailable()은 OPENAI_API_KEY 유무로 판정한다', () => {
    const provider = new WhisperApiProvider();
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(provider.isAvailable()).toBe(true);
    delete process.env.OPENAI_API_KEY;
    expect(provider.isAvailable()).toBe(false);
  });

  it('verbose_json 응답을 TranscriptionResult로 매핑한다', async () => {
    const body = makeVerboseJsonResponse();
    vi.stubGlobal('fetch', mockFetchOk(body));

    const provider = new WhisperApiProvider();
    const result = await provider.transcribe(Buffer.from('audio'), { language: 'ko' });

    expect(result.provider).toBe('whisper-api');
    expect(result.hasSpeakerDiarization).toBe(false);
    expect(result.text).toBe(body.text);
    expect(result.duration).toBe(body.duration);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      speaker: 'Unknown',
      text: '안녕하세요',
      start: 0,
      end: 5.2,
    });
    expect(result.segments[1]).toMatchObject({
      speaker: 'Unknown',
      text: '회의를 시작하겠습니다',
      start: 5.2,
      end: 12.5,
    });
  });

  it('OpenAI 엔드포인트(api.openai.com)로 호출한다 (z.ai BASE 미사용)', async () => {
    const fetchMock = mockFetchOk(makeVerboseJsonResponse());
    vi.stubGlobal('fetch', fetchMock);

    // z.ai 환경변수가 설정돼 있어도 무시해야 함
    process.env.ZAI_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4';

    const provider = new WhisperApiProvider();
    await provider.transcribe(Buffer.from('audio'));

    const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('api.openai.com');
    expect(calledUrl).not.toContain('bigmodel.cn');

    delete process.env.ZAI_BASE_URL;
  });

  it('fetch가 비-OK(401)면 에러를 throw한다', async () => {
    vi.stubGlobal('fetch', mockFetchError(401));
    const provider = new WhisperApiProvider();
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow();
  });
});
