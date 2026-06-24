import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveProvider } from './resolveProvider';

// resolveProvider는 process.env를 읽어 활성 provider 1개를 결정한다.
// 핵심: z.ai 회귀 안전(기존 OPENAI>ZAI 보존) + 새 키 추가 시 우선순위.
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

describe('resolveProvider', () => {
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
  });

  it('키가 하나도 없으면 throw', () => {
    expect(() => resolveProvider()).toThrow(/API 키가 없습니다/);
  });

  it('ZAI만 있으면 zai/glm-5-turbo (현행 메인)', () => {
    process.env.ZAI_API_KEY = 'zk';
    process.env.ZAI_MODEL = 'glm-5-turbo';
    const r = resolveProvider();
    expect(r.id).toBe('zai');
    expect(r.model).toBe('glm-5-turbo');
    expect(r.baseURL).toContain('coding/paas/v4');
  });

  it('ZAI_MODEL 미설정 시 zai 기본값 glm-5-turbo', () => {
    process.env.ZAI_API_KEY = 'zk';
    expect(resolveProvider().model).toBe('glm-5-turbo');
  });

  it('OPENAI+ZAI면 OpenAI 우선 (현행 호환 — 회귀 방지)', () => {
    process.env.OPENAI_API_KEY = 'ok';
    process.env.ZAI_API_KEY = 'zk';
    const r = resolveProvider();
    expect(r.id).toBe('openai');
    expect(r.model).toBe('gpt-4o');
  });

  it('ANTHROPIC가 최우선', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.OPENAI_API_KEY = 'ok';
    process.env.ZAI_API_KEY = 'zk';
    const r = resolveProvider();
    expect(r.id).toBe('anthropic');
    expect(r.model).toBe('claude-opus-4-8');
    expect(r.baseURL).toBeUndefined();
  });

  it('GEMINI는 OpenAI보다 위, ANTHROPIC보다 아래', () => {
    process.env.GEMINI_API_KEY = 'gk';
    process.env.OPENAI_API_KEY = 'ok';
    const r = resolveProvider();
    expect(r.id).toBe('gemini');
    expect(r.baseURL).toContain('generativelanguage.googleapis.com');
  });

  it('모델 환경변수 오버라이드 적용', () => {
    process.env.ANTHROPIC_API_KEY = 'ak';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
    expect(resolveProvider().model).toBe('claude-sonnet-4-6');
  });
});
