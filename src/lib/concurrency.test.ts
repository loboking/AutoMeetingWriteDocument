import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency, withRetry, isRateLimitError, isTransientError } from './concurrency';

describe('mapWithConcurrency', () => {
  it('모든 항목을 입력 순서대로 처리하여 결과를 반환한다', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('동시 실행 수가 limit를 절대 초과하지 않는다', async () => {
    let running = 0;
    let maxRunning = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n;
    });

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(maxRunning).toBeGreaterThan(1); // 실제로 병렬 실행됨
  });

  it('일부 작업이 throw해도 다른 작업 결과는 보존된다 (reject되지 않음)', async () => {
    const items = [1, 2, 3];
    const result = await mapWithConcurrency(items, 2, async (n) => {
      if (n === 2) throw new Error('fail');
      return n;
    });
    // 실패한 항목은 null, 나머지는 정상
    expect(result[0]).toBe(1);
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(3);
  });

  it('빈 배열은 빈 결과를 반환한다', async () => {
    const result = await mapWithConcurrency([], 3, async (n) => n);
    expect(result).toEqual([]);
  });
});

describe('isRateLimitError', () => {
  it('HTTP 429 상태를 rate limit으로 인식한다', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it('z.ai code 1302를 rate limit으로 인식한다', () => {
    expect(isRateLimitError({ code: '1302' })).toBe(true);
    expect(isRateLimitError({ error: { code: '1302' } })).toBe(true);
  });

  it('메시지에 速率限制(rate limit)가 있으면 인식한다', () => {
    expect(isRateLimitError({ message: '您的账户已达到速率限制' })).toBe(true);
  });

  it('일반 오류는 rate limit이 아니다', () => {
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(new Error('timeout'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('isTransientError', () => {
  it('rate limit은 transient로 분류된다 (429 포함)', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ code: '1302' })).toBe(true);
  });

  it('5xx 서버 오류는 transient로 분류된다 (준 재현: z.ai 500 操作失败)', () => {
    expect(isTransientError({ status: 500, message: '操作失败' })).toBe(true);
    expect(isTransientError({ status: 502 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 504 })).toBe(true);
  });

  it('timeout/abort 오류는 transient로 분류된다', () => {
    expect(isTransientError(new Error('Request timed out'))).toBe(true);
    const abort = new Error('aborted'); abort.name = 'AbortError';
    expect(isTransientError(abort)).toBe(true);
  });

  it('클라이언트 오류(4xx)와 일반 오류는 transient가 아니다', () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError(new Error('bad request'))).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe('withRetry', () => {
  it('첫 시도 성공 시 재시도하지 않는다', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rate limit 오류 시 재시도 후 성공하면 결과를 반환한다', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw { status: 429, message: '速率限制' };
      return 'recovered';
    });
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('transient가 아닌 오류(4xx 등)는 즉시 throw하고 재시도하지 않는다', async () => {
    const fn = vi.fn(async () => {
      throw { status: 400, message: 'bad request' };
    });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('5xx transient 오류는 재시도 후 성공하면 결과를 반환한다 (준: z.ai 500 회복)', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw { status: 500, message: '操作失败' };
      return 'recovered';
    });
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('재시도 횟수를 모두 소진하면 마지막 오류를 throw한다', async () => {
    const fn = vi.fn(async () => {
      throw { status: 429, message: '速率限制' };
    });
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toMatchObject({ status: 429 });
    // 최초 1회 + 재시도 2회 = 3회
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
