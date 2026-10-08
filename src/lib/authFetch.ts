// 클라이언트 fetch에 로그인 토큰(Authorization: Bearer)을 자동 주입.
// store(React 밖)와 컴포넌트 양쪽에서 동일하게 동작하도록 getSession() 직접 호출.
import { supabase } from '@/lib/supabase';
import { RequestMemo } from './requestMemo';

// 토큰 획득 단계를 별도 함수로 분리(Codex 진단) — getSession 내부의 자동 리프레시
// POST가 모바일에서 죽으면 generic "Failed to fetch"로 몰려 원인이 가려졌다.
// 단계별 오류로 노출해 범인을 즉시 식별하게 한다.
async function getAccessToken(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`AUTH_SESSION_ERROR: ${error.message}`);
  }
  if (!session?.access_token) {
    throw new Error('로그인이 필요합니다.');
  }
  // 만료 임계(60s 이내)면 선제 갱신 — 실패 시 명확한 에러로.
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt && expiresAt - Date.now() < 60_000) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session?.access_token) {
      throw new Error(`AUTH_SESSION_REFRESH_FAILED: ${refreshError?.message || '갱신 실패'}`);
    }
    return refreshed.session.access_token;
  }
  return session.access_token;
}

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  // FormData 전송 시 Content-Type은 브라우저가 자동 설정하므로 기존 헤더만 보존하고
  // Authorization만 추가한다. fetch 실패는 어떤 URL에서 죽었는지 붙여 노출.
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  }).catch((e) => {
    throw new Error(`NETWORK_FETCH_FAILED (${url.slice(0, 60)}): ${e instanceof Error ? e.message : String(e)}`);
  });
}

// Reuse only identical successful generation requests in this signed-in browser session.
// Token rotation/account changes produce different hashes. No meeting data is written to storage.
const generationMemo = new RequestMemo<{ status: number; body: string }>();
export async function cachedGenerationFetch(url: '/api/summarize' | '/api/generate-doc', init: RequestInit, force = false): Promise<Response> {
  const token = await getAccessToken();
  if (init.signal?.aborted) throw new DOMException('취소됨', 'AbortError');
  const requestBody = typeof init.body === 'string' ? init.body : '';
  if (!globalThis.crypto?.subtle || !requestBody) return authedFetch(url, init);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${token}\n${url}\nv1\n${requestBody}`));
  const key = Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  const result = await generationMemo.run(key, async () => {
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.text() };
  }, {
    force,
    // A request with its own cancellation must never cancel another caller's request.
    sharePending: !init.signal,
    size: result => result.body.length * 2,
    valid: result => {
      if (result.status !== 200) return false;
      try {
        const body = JSON.parse(result.body);
        if (body.error || body.partial) return false;
        return url === '/api/summarize'
          ? !!body.summary?.overview && Array.isArray(body.summary?.decisions) && Array.isArray(body.summary?.keyPoints) && Array.isArray(body.summary?.actionItems)
          : typeof body.content === 'string' && !!body.content.trim() && !body.content.includes('생성 실패');
      } catch { return false; }
    },
  });
  if (init.signal?.aborted) throw new DOMException('취소됨', 'AbortError');
  return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
}
