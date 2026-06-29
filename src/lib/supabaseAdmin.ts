// 서버 전용 Supabase 클라이언트(service_role). RLS를 우회하므로 절대 클라 번들에 넣지 말 것.
// ⚠️ 클라이언트 컴포넌트('use client')에서 import 금지. 서버 라우트/서버 모듈에서만.
// service_role은 모든 행에 접근 가능 → user_id는 반드시 서버가 검증한 값만 주입(클라 입력 신뢰 금지).
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 키 미설정이면 null. 호출부(usageMetering)가 null 가드로 best-effort 스킵.
export const supabaseAdmin = serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
