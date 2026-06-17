// 클라이언트 fetch에 로그인 토큰(Authorization: Bearer)을 자동 주입.
// store(React 밖)와 컴포넌트 양쪽에서 동일하게 동작하도록 getSession() 직접 호출.
import { supabase } from '@/lib/supabase';

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('로그인이 필요합니다.');
  }
  // FormData 전송 시 Content-Type은 브라우저가 자동 설정하므로 기존 헤더만 보존하고
  // Authorization만 추가한다.
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}
