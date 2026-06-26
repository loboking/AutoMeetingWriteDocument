import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveProvider, llmComplete } from './index';

// 2026-06-26 운영버그 재현·방어:
// ANTHROPIC_API_KEY가 셋(.env.local) 다 SET일 때 resolveProvider가 anthropic 최우선 반환 →
// anthropicAdapter(미구현)가 complete()에서 throw → 문서생성 100% 실패였다.
// index의 가드(implemented:true인 첫 provider 선택)로, anthropic은 건너뛰고 zai가 실제 선택돼야 한다.
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

  it('ANTHROPIC+ZAI 둘 다 있을 때, anthropic 미구현이므로 실제 선택은 zai (오늘 버그 방어)', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.ZAI_API_KEY = 'zk';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = resolveProvider();

    expect(r.id).toBe('zai'); // anthropic이 아니라 폴백된 zai
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("provider 'anthropic'")
    );
  });

  it('ANTHROPIC만 있으면(구현된 어댑터 없음) throw — 침묵 실패 금지', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => resolveProvider()).toThrow(/구현된 어댑터가 없습니다/);
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

  it('llmComplete도 미구현 anthropic을 건너뛰고 구현 어댑터로 위임한다(실호출 직전까지)', async () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.OPENAI_API_KEY = 'ok';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 실제 OpenAI 호출은 막고, 위임된 provider만 확인한다.
    const adapters = await import('./openaiCompatAdapter');
    const spy = vi
      .spyOn(adapters.openaiCompatAdapter, 'complete')
      .mockResolvedValue({ text: 'ok', provider: 'openai', model: 'gpt-4o' });

    const res = await llmComplete({ prompt: 'hi', maxTokens: 16 });

    expect(spy).toHaveBeenCalledTimes(1);
    // 위임 시 ctx.id가 anthropic이 아니라 openai여야 한다(가드가 골랐으므로)
    expect(spy.mock.calls[0][1].id).toBe('openai');
    expect(res.text).toBe('ok');
  });
});
