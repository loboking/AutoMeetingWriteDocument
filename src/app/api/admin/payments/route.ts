import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 결제 내역. ?status=failed 로 실패만 필터 가능. raw(PortOne 원본)는 반환 안 함(용량/민감).
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status'); // paid | failed | canceled | null(전체)

  let query = supabaseAdmin
    .from('payments')
    .select('user_id,payment_id,plan,amount,status,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) query = query.eq('status', status);

  const { data: payments, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const emailById: Record<string, string> = {};
  for (const u of usersData?.users ?? []) emailById[u.id] = u.email ?? '(없음)';

  const rows = (payments ?? []).map((p) => ({
    email: emailById[p.user_id] ?? '(알 수 없음)',
    paymentId: p.payment_id,
    plan: p.plan,
    amount: p.amount,
    status: p.status,
    createdAt: p.created_at,
  }));

  return NextResponse.json({ payments: rows });
}
