import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 구독 목록 + 이메일 매핑. billing_key/customer_id 같은 민감값은 반환 안 함(존재 여부만).
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { data: subs, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id,plan,status,current_period_end,cancel_at_period_end,created_at,billing_key')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 이메일 매핑 (한 페이지분 — 소규모 가정)
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const emailById: Record<string, string> = {};
  for (const u of usersData?.users ?? []) emailById[u.id] = u.email ?? '(없음)';

  const rows = (subs ?? []).map((s) => ({
    userId: s.user_id,
    email: emailById[s.user_id] ?? '(알 수 없음)',
    plan: s.plan,
    status: s.status,
    currentPeriodEnd: s.current_period_end,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    hasBillingKey: !!s.billing_key, // 값은 노출 안 함
    createdAt: s.created_at,
  }));

  return NextResponse.json({ subscriptions: rows });
}
