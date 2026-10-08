import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
import { cachedGenerationFetch } from './authFetch';
let token = 'account1';
let sequence = 0;
const fetchMock = vi.fn();
const init = () => ({ method: 'POST', body: JSON.stringify({ text: '회의', case: ++sequence }) });
beforeEach(() => {
  token = 'account1';
  auth.getSession.mockImplementation(async () => ({ data: { session: { access_token: token } } }));
  fetchMock.mockReset().mockImplementation(async () => Response.json({ content: '완성 문서' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe('authenticated generation cache', () => {
  it('reuses identical success only for the same account and input', async () => {
    const request = init();
    await cachedGenerationFetch('/api/generate-doc', request);
    const again = await cachedGenerationFetch('/api/generate-doc', request);
    expect(await again.json()).toEqual({ content: '완성 문서' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    token = 'account2';
    await cachedGenerationFetch('/api/generate-doc', request);
    await cachedGenerationFetch('/api/generate-doc', init());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('explicit regeneration bypasses a cached result', async () => {
    const request = init();
    await cachedGenerationFetch('/api/generate-doc', request);
    await cachedGenerationFetch('/api/generate-doc', request, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('preserves error status and never caches partial or failed responses', async () => {
    const request = init();
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ content: '중간', partial: true }));
    expect((await cachedGenerationFetch('/api/generate-doc', request)).status).toBe(429);
    await cachedGenerationFetch('/api/generate-doc', request);
    await cachedGenerationFetch('/api/generate-doc', request);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('rejects aborted calls and requires authentication even on a hit', async () => {
    const request = init();
    await cachedGenerationFetch('/api/generate-doc', request);
    await expect(cachedGenerationFetch('/api/generate-doc', { ...request, signal: AbortSignal.abort() })).rejects.toThrow();
    auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(cachedGenerationFetch('/api/generate-doc', request)).rejects.toThrow('로그인');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
