import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({ default: class { chat = { completions: { create } }; } }));
import { openaiCompatAdapter } from './openaiCompatAdapter';
const ctx = { id: 'openai' as const, model: 'gpt-6-luna', apiKey: 'test', baseURL: 'https://api.openai.com/v1' };
beforeEach(() => { create.mockReset(); vi.stubEnv('OPENAI_REASONING_EFFORT', 'low'); });
afterEach(() => vi.unstubAllEnvs());
describe('GPT 문서 응답 검증', () => {
 it('GPT 추론 모델 요청과 실제 응답 모델을 보존한다', async () => {
  create.mockResolvedValue({ model: 'gpt-6-luna', choices: [{ finish_reason: 'stop', message: { content: '완료 본문' } }], usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } });
  const result = await openaiCompatAdapter.complete({ prompt: '문서', maxTokens: 500, temperature: 0.7 }, ctx);
  expect(create.mock.lastCall?.[0]).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 1000, reasoning_effort: 'low' });
  expect(create.mock.lastCall?.[0]).not.toHaveProperty('temperature');
  expect(create.mock.lastCall?.[0]).not.toHaveProperty('max_tokens');
  expect(result).toMatchObject({ text: '완료 본문', model: 'gpt-6-luna', provider: 'openai', usage: { totalTokens: 46 } });
 });
 it.each(['length', 'content_filter'])('미완료 응답 %s를 성공으로 반환하지 않는다', async reason => {
  create.mockResolvedValue({ choices: [{ finish_reason: reason, message: { content: '중간까지만 생성된 본문' } }] });
  await expect(openaiCompatAdapter.complete({ prompt: '문서', maxTokens: 500 }, ctx)).rejects.toThrow('미완료');
 });
 it('본문 없이 추론만 있는 응답은 저장하지 않는다', async () => {
  create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '내부 추론' } }] });
  await expect(openaiCompatAdapter.complete({ prompt: '문서', maxTokens: 500 }, ctx)).rejects.toThrow('본문이 비어');
 });
});
describe('cache boundaries and usage accounting', () => {
 it('marks the shared source only and records cache/reasoning counts', async () => {
  create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '본문' } }], usage: { prompt_tokens: 2000, completion_tokens: 100, total_tokens: 2100, prompt_tokens_details: { cached_tokens: 1500, cache_write_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 40 } } });
  const result = await openaiCompatAdapter.complete({ system: '공통 지침', sharedContext: '원문 전체', prompt: '문서별 작업', maxTokens: 500 }, ctx);
  expect(create.mock.lastCall?.[0]).toMatchObject({ prompt_cache_options: { mode: 'explicit', ttl: '30m' }, messages: [{ role: 'system', content: '공통 지침' }, { role: 'user', content: [{ type: 'text', text: '원문 전체', prompt_cache_breakpoint: { mode: 'explicit' } }] }, { role: 'user', content: '문서별 작업' }] });
  expect(result.usage).toMatchObject({ inputTokens: 2000, outputTokens: 100, totalTokens: 2100, cachedInputTokens: 1500, cacheWriteInputTokens: 100, reasoningTokens: 40 });
 });
 it.each(['gpt-5.4', 'gemini-2.5-flash'])('omits explicit cache fields for %s', async model => {
  create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '본문' } }] });
  await openaiCompatAdapter.complete({ sharedContext: '원문', prompt: '작업', maxTokens: 500 }, { ...ctx, model });
  expect(create.mock.lastCall?.[0]).not.toHaveProperty('prompt_cache_options');
  expect(create.mock.lastCall?.[0].messages[0].content).toBe('원문');
 });
});
