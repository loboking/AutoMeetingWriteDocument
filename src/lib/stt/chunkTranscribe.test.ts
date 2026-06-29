import { describe, it, expect, vi, afterEach } from 'vitest';
import { canChunk, needsChunking, transcribeChunked } from './chunkTranscribe';

const CHUNK_BYTES = 20 * 1024 * 1024;

describe('needsChunking', () => {
  it('20MB 이하는 분할 불필요', () => {
    expect(needsChunking(CHUNK_BYTES)).toBe(false);
    expect(needsChunking(1024)).toBe(false);
  });
  it('20MB 초과는 분할 필요', () => {
    expect(needsChunking(CHUNK_BYTES + 1)).toBe(true);
    expect(needsChunking(40 * 1024 * 1024)).toBe(true);
  });
});

describe('canChunk', () => {
  it('mp3/mpeg 계열만 바이트 슬라이스 허용', () => {
    expect(canChunk('audio/mpeg')).toBe(true);
    expect(canChunk('audio/mp3')).toBe(true);
    expect(canChunk('audio/mpga')).toBe(true);
  });
  it('컨테이너 포맷(webm/ogg/m4a/wav)은 불허', () => {
    expect(canChunk('audio/webm')).toBe(false);
    expect(canChunk('audio/ogg')).toBe(false);
    expect(canChunk('audio/mp4')).toBe(false);
    expect(canChunk('audio/wav')).toBe(false);
    expect(canChunk(undefined)).toBe(false);
  });
});

describe('transcribeChunked', () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
    vi.restoreAllMocks();
  });

  it('청크별 segment timestamp를 누적 duration으로 전역 보정하고 텍스트를 이어붙인다', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    // 각 청크 동일 응답(duration 10초, segment 0~10). 병렬 완료 순서와 무관하게 결정적.
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'chunk',
        duration: 10,
        language: 'korean',
        segments: [{ start: 0, end: 10, text: 'chunk' }],
      }),
    })) as unknown as typeof fetch;

    // 2청크가 되도록 20MB+ buffer (mpeg)
    const buffer = Buffer.alloc(CHUNK_BYTES + 1024);
    const result = await transcribeChunked(buffer, { language: 'ko', contentType: 'audio/mpeg' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('chunk chunk');
    expect(result.duration).toBe(20);
    // 두 번째 청크 segment는 offset 10 적용
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ start: 0, end: 10 });
    expect(result.segments[1]).toMatchObject({ start: 10, end: 20 });
  });
});
