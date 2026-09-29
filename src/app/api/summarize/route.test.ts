import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const { llm } = vi.hoisted(() => ({ llm: vi.fn() }));
vi.mock('@/lib/llm', () => ({ llmComplete: llm }));
vi.mock('@/lib/apiAuth', () => ({ requireUser: vi.fn(async () => ({ user: { id: 'user-test' } })) }));
vi.mock('@/lib/tokenUsage', () => ({ recordTokenUsage: vi.fn() }));

const KEYS = ['OPENAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER'];
function request() {
  return new NextRequest('http://localhost/api/summarize', {
    method: 'POST', body: JSON.stringify({ text: '야간 예약은 보류한다.' }),
    headers: { 'Content-Type': 'application/json' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of KEYS) vi.stubEnv(key, '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('모델 교체 시 요약 계약', () => {
  it.each(KEYS)('%s 설정 상태의 실패를 가짜 요약으로 대체하지 않는다', async key => {
    vi.stubEnv(key, 'test-configuration');
    llm.mockRejectedValue(new Error('provider failed'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('summary');
  });

  it('키가 하나도 없을 때만(데모) mock 요약을 허용한다', async () => {
    llm.mockRejectedValue(new Error('no key'));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('summary');
  });
});
