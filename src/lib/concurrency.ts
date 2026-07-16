// 동시성 제어 + 재시도 유틸 (z.ai rate limit + transient 오류 대응)
// z.ai 코딩플랜 제약 (준 재현 2026-07-16):
//   - 동시 요청 5개 이상 → 429 rate limit(즉시 reject)
//   - 동시 heavy 요청 3개 → 500 "操作失败"(operation failed, 238초 만에 실패)
//   - 단일 heavy 간헐적 응답 없음(300s+) → openai SDK timeout throw
// 이 셋 모두 재시도로 회복 가능 → withRetry가 모두 잡도록 확장.

type ErrorLike = {
  status?: number;
  code?: string | number;
  message?: string;
  error?: { code?: string | number; message?: string };
} | null | undefined;

// z.ai rate limit / HTTP 429 오류 판별
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as ErrorLike;
  if (e?.status === 429) return true;
  const code = e?.code ?? e?.error?.code;
  if (code === '1302' || code === 1302 || code === 429 || code === '429') return true;
  const msg = e?.message ?? e?.error?.message ?? '';
  if (typeof msg === 'string' && (msg.includes('速率限制') || msg.toLowerCase().includes('rate limit'))) {
    return true;
  }
  return false;
}

// z.ai 간헐 실패 / transient 오류 판별 (재시도 회복 가능)
//  - HTTP 500/502/503/504 (gateways, upstream 일시 장애)
//  - 메시지 "操作失败" (z.ai 500 본문, 준 재현 확정)
//  - openai SDK timeout/abort (간헐 응답 없음)
export function isTransientError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as ErrorLike;
  if (e?.status === 500 || e?.status === 502 || e?.status === 503 || e?.status === 504) return true;
  const msg = e?.message ?? e?.error?.message ?? '';
  if (typeof msg === 'string') {
    if (msg.includes('操作失败')) return true;
    if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out')) return true;
  }
  const name = (err as { name?: string })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  retries?: number;      // 추가 재시도 횟수 (최초 1회는 별도)
  baseDelayMs?: number;  // 지수 backoff 기준 지연
}

// transient 오류(429/5xx/timeout/abort)에 한해 지수 backoff로 재시도. 그 외 오류는 즉시 throw.
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 1000 }: RetryOptions = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === retries) {
        throw err;
      }
      // 지수 backoff: baseDelay * 2^attempt
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

// 동시 실행 수를 limit로 제한하며 items를 처리. 입력 순서대로 결과 배열 반환.
// 개별 작업이 throw하면 해당 인덱스는 null (전체 reject 방지).
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
