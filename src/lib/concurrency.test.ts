import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency, withRetry, isRateLimitError } from './concurrency';

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

  it('rate limit이 아닌 오류는 즉시 throw하고 재시도하지 않는다', async () => {
    const fn = vi.fn(async () => {
      throw { status: 500, message: 'server error' };
    });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(1);
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
