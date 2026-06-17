// API 라우트 인증 가드. share 라우트의 검증된 패턴을 헬퍼로 추출.
// getUser(token)은 stateless라 anon 클라 공유로도 서버리스 동시요청 안전.
import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type AuthResult =
  | { user: User; response?: undefined }
  | { user?: undefined; response: NextResponse };

// 라우트 진입부에서:
//   const auth = await requireUser(request);
//   if (auth.response) return auth.response;
//   // auth.user 사용 가능
export async function requireUser(request: NextRequest): Promise<AuthResult> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return { response: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) };
  }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { response: NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 }) };
  }
  return { user };
}
