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
    text: async () => JSON.stringify(body),
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

// File API 업로드(resumable 2단) → 폴링(ACTIVE) → generateContent fetch를 단일 mock으로 라우팅.
// resumable 프로토콜:
//   step1: POST /upload/v1beta/files?uploadType=resumable + JSON metadata → Location 헤더
//   step2: PUT <sessionUri> + 바이너리 → file 리소스(uri/name/state)
//   step3: GET /v1beta/files/{name} → 폴링(state ACTIVE 대기)
//   step4: POST :generateContent + fileData
function mockFetchFileApiFlow(opts: {
  startOk?: boolean; // step1 (resumable 시작)
  uploadOk?: boolean; // step2 (PUT 바이너리)
  uploadStatus?: number;
  pollState?: 'ACTIVE' | 'PROCESSING' | 'FAILED';
  generateText?: string;
  generateOk?: boolean;
}) {
  const {
    startOk = true,
    uploadOk = true,
    uploadStatus = 200,
    pollState = 'ACTIVE',
    generateText = '화자 1: 테스트',
    generateOk = true,
  } = opts;
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  type MockResp = {
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
    // Headers-like: 실제 Response.headers.get(name) 호환. lowercase 키 조회.
    headers?: { get: (name: string) => string | null };
  };
  const SESSION_URI =
    'https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=test&upload_id=abc';
  const mock = vi.fn(async (url: string, init?: RequestInit): Promise<MockResp> => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body });
    const u = String(url);
    // step1: resumable 시작 — POST + uploadType=resumable + Location 헤더
    if (u.includes('/upload/v1beta/files') && u.includes('uploadType=resumable') && init?.method === 'POST') {
      if (!startOk) {
        return { ok: false, status: 400, text: async () => 'start failed' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'location' ? SESSION_URI : null) },
        text: async () => '',
      };
    }
    // step2: PUT session URI → file 리소스
    if (u === SESSION_URI && init?.method === 'PUT') {
      if (!uploadOk) {
        return { ok: false, status: uploadStatus, text: async () => 'upload failed' };
      }
      return {
        ok: true,
        status: uploadStatus,
        json: async () => ({
          file: {
            name: 'files/test-file-1',
            uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-file-1',
            mimeType: 'audio/mpeg',
            state: 'PROCESSING',
            displayName: 'stt-audio',
          },
        }),
        text: async () => '{}',
      };
    }
    // 폴링 — GET 응답은 루트가 곧 file 리소스(file 래핑 없음)
    if (u.includes('/v1beta/files/') && (!init || init.method === 'GET')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: 'files/test-file-1',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/test-file-1',
          mimeType: 'audio/mpeg',
          state: pollState,
        }),
        text: async () => '{}',
      };
    }
    // generateContent
    if (u.includes(':generateContent')) {
      if (!generateOk) {
        return { ok: false, status: 400, text: async () => 'gen error' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => makeGeminiResponse(generateText),
        text: async () => '{}',
      };
    }
    return { ok: false, status: 404, text: async () => 'unmatched' };
  });
  return { mock, calls };
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

    it('15MB 초과 오디오는 File API로 업로드 후 fileData로 변환을 요청한다', async () => {
      // 16MB 버퍼 — inlineData 한계(15MB) 초과 → File API 분기.
      const big = Buffer.alloc(16 * 1024 * 1024, 0);
      const { mock, calls } = mockFetchFileApiFlow({
        pollState: 'ACTIVE',
        generateText: '화자 1: 큰 파일 테스트',
      });
      vi.stubGlobal('fetch', mock);

      const result = await new GeminiAudioProvider().transcribe(big, { contentType: 'audio/mpeg' });

      // 4단 fetch: resumable 시작(POST) → PUT 바이너리 → 폴링(GET) → generateContent(POST)
      const posts = calls.filter((c) => c.method === 'POST');
      const puts = calls.filter((c) => c.method === 'PUT');
      const gets = calls.filter((c) => c.method === 'GET');
      expect(posts.filter((c) => c.url.includes('uploadType=resumable'))).toHaveLength(1);
      expect(puts).toHaveLength(1);
      expect(gets.filter((c) => c.url.includes('/v1beta/files/'))).toHaveLength(1);
      expect(posts.filter((c) => c.url.includes(':generateContent'))).toHaveLength(1);

      // generateContent body에는 fileData(fileUri)가 있어야 하고 inlineData는 없어야 한다.
      const genCall = calls.find((c) => c.url.includes(':generateContent'));
      const body = JSON.parse(String(genCall?.body));
      const parts = body.contents[0].parts;
      const fileDataPart = parts.find((p: { fileData?: unknown }) => p.fileData);
      const inlinePart = parts.find((p: { inlineData?: unknown }) => p.inlineData);
      expect(fileDataPart).toBeTruthy();
      expect(fileDataPart.fileData.fileUri).toContain('files/test-file-1');
      expect(fileDataPart.fileData.mimeType).toBe('audio/mpeg');
      expect(inlinePart).toBeUndefined();

      expect(result.segments[0]).toMatchObject({ speaker: '화자 1', text: '큰 파일 테스트' });
    });

    it('File API 업로드 실패 시 에러를 throw한다', async () => {
      const big = Buffer.alloc(16 * 1024 * 1024, 0);
      const { mock } = mockFetchFileApiFlow({ uploadOk: false, uploadStatus: 400 });
      vi.stubGlobal('fetch', mock);

      await expect(
        new GeminiAudioProvider().transcribe(big, { contentType: 'audio/mpeg' })
      ).rejects.toThrow(/업로드 실패|upload failed/i);
    });

    it('File API resumable 시작 실패 시 에러를 throw한다', async () => {
      const big = Buffer.alloc(16 * 1024 * 1024, 0);
      const { mock } = mockFetchFileApiFlow({ startOk: false });
      vi.stubGlobal('fetch', mock);

      await expect(
        new GeminiAudioProvider().transcribe(big, { contentType: 'audio/mpeg' })
      ).rejects.toThrow(/resumable 시작 실패|start failed/i);
    });

    it('File API 폴링이 FAILED 상태면 에러를 throw한다', async () => {
      const big = Buffer.alloc(16 * 1024 * 1024, 0);
      const { mock } = mockFetchFileApiFlow({
        pollState: 'FAILED',
      });
      vi.stubGlobal('fetch', mock);

      await expect(
        new GeminiAudioProvider().transcribe(big, { contentType: 'audio/mpeg' })
      ).rejects.toThrow(/FAILED|파일 처리 실패/);
    });

    it('15MB 이하 오디오는 inlineData 경로를 유지한다 (회귀)', async () => {
      // 14MB — inlineData 임계(15MB) 이하 → 업로드 없이 inlineData 직행.
      const small = Buffer.alloc(14 * 1024 * 1024, 0);
      const fetchMock = mockFetchOk(makeGeminiResponse('화자 1: 작은 파일'));
      vi.stubGlobal('fetch', fetchMock);

      await new GeminiAudioProvider().transcribe(small, { contentType: 'audio/mp3' });

      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
      // 단일 generateContent 호출만 있어야 (업로드/폴링 없음)
      expect(calls).toHaveLength(1);
      const calledUrl = String(calls[0][0]);
      expect(calledUrl).toContain(':generateContent');
      const body = JSON.parse(calls[0][1].body);
      const inlinePart = body.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData);
      expect(inlinePart).toBeTruthy();
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
