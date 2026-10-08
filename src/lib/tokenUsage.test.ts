import { beforeEach, it, expect, vi } from 'vitest';
const insert = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: { from: () => ({ insert }) } }));
vi.mock('@/lib/usageMetering', () => ({ getCurrentPeriod: () => '2026-10' }));
import { recordTokenUsage } from './tokenUsage';
const params = { userId: 'user', op: 'doc-generate' as const, provider: 'openai' as const, model: 'gpt-6-luna', usage: { inputTokens: 2000, outputTokens: 100, totalTokens: 2100, cachedInputTokens: 1500, cacheWriteInputTokens: 100, reasoningTokens: 40 } };
beforeEach(() => insert.mockReset().mockResolvedValue({ error: null }));
it('persists cache details without adding reasoning tokens to the total', async () => {
 await recordTokenUsage(params);
 expect(insert).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 2000, output_tokens: 100, total_tokens: 2100, cached_input_tokens: 1500, cache_write_input_tokens: 100, reasoning_tokens: 40 }));
});
it('retains legacy accounting until the additive migration is applied', async () => {
 insert.mockResolvedValueOnce({ error: { code: 'PGRST204', message: 'Missing column' } });
 await recordTokenUsage(params);
 expect(insert).toHaveBeenCalledTimes(2);
 expect(insert.mock.calls[1][0]).toMatchObject({ input_tokens: 2000, output_tokens: 100 });
 expect(insert.mock.calls[1][0]).not.toHaveProperty('cached_input_tokens');
});
