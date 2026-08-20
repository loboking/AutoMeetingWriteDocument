// 클라이언트 fetch에 로그인 토큰(Authorization: Bearer)을 자동 주입.
// store(React 밖)와 컴포넌트 양쪽에서 동일하게 동작하도록 getSession() 직접 호출.
import { supabase } from '@/lib/supabase';

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
