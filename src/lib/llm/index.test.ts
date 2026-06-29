import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveProvider, llmComplete } from './index';

// index의 가드: implemented:true인 첫 provider를 선택, 미구현은 건너뛰며 warn.
// 2026-06-29 anthropicAdapter 구현 완료 → 이제 4개 provider 모두 implemented:true.
//   (과거: anthropic 미구현 시 zai로 폴백하던 버그 방어 테스트였음.)
// 가드 자체는 유지 — 향후 새 미구현 어댑터가 추가되면 동일하게 건너뛴다.
const LLM_KEYS = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ZAI_API_KEY',
  'ANTHROPIC_MODEL',
  'GEMINI_MODEL',
  'OPENAI_MODEL',
  'ZAI_MODEL',
  'ZAI_BASE_URL',
  'GEMINI_BASE_URL',
  'LLM_PROVIDER',
];

describe('llm index — 미구현 어댑터 폴백 가드', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of LLM_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of LLM_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  it('ANTHROPIC+ZAI 둘 다 있으면 anthropic 최우선 선택(이제 구현됨)', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.ZAI_API_KEY = 'zk';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = resolveProvider();

    expect(r.id).toBe('anthropic'); // 구현 완료라 더는 폴백 안 함
    expect(warn).not.toHaveBeenCalled();
  });

  it('ANTHROPIC만 있으면 anthropic 선택(구현 완료)', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveProvider().id).toBe('anthropic');
  });

  it('OPENAI(구현됨)만 있으면 폴백 없이 openai 선택, warn 미발생', () => {
    process.env.OPENAI_API_KEY = 'ok';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = resolveProvider();

    expect(r.id).toBe('openai');
    expect(warn).not.toHaveBeenCalled();
  });

  it('키가 하나도 없으면 throw (env 결정 단계)', () => {
    expect(() => resolveProvider()).toThrow(/API 키가 없습니다/);
  });

  it('llmComplete가 선택된 provider 어댑터로 위임한다(실호출 직전까지)', async () => {
    process.env.OPENAI_API_KEY = 'ok';
    process.env.ZAI_API_KEY = 'zk';
    process.env.LLM_PROVIDER = 'zai'; // z.ai 메인 강제

    // 실제 호출은 막고, 위임된 provider만 확인.
    const adapters = await import('./openaiCompatAdapter');
    const spy = vi
      .spyOn(adapters.openaiCompatAdapter, 'complete')
      .mockResolvedValue({ text: 'ok', provider: 'zai', model: 'glm-5-turbo' });

    const res = await llmComplete({ prompt: 'hi', maxTokens: 16 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].id).toBe('zai'); // LLM_PROVIDER가 고른 provider
    expect(res.text).toBe('ok');
  });

  it('LLM_PROVIDER=anthropic면 anthropic 어댑터로 위임', async () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.ZAI_API_KEY = 'zk';
    process.env.LLM_PROVIDER = 'anthropic';

    const { anthropicAdapter } = await import('./anthropicAdapter');
    const spy = vi
      .spyOn(anthropicAdapter, 'complete')
      .mockResolvedValue({ text: 'claude', provider: 'anthropic', model: 'claude-opus-4-8' });

    const res = await llmComplete({ prompt: 'hi', maxTokens: 16 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].id).toBe('anthropic');
    expect(res.text).toBe('claude');
  });
});
