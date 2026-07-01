import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getCurrentPeriod } from '@/lib/usageMetering';
import { PLANS, type PlanId } from '@/lib/plans';

export const runtime = 'nodejs';

// 관리자 대시보드 핵심 지표. service_role로 전 테이블 집계.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const period = getCurrentPeriod();

  // 병렬 집계
  const [
    usersRes,
    meetingsCount,
    subsRes,
    paymentsRes,
    usageThisPeriod,
    tokenThisPeriod,
  ] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 1 }), // total만 필요
    supabaseAdmin.from('meetings').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('subscriptions').select('plan,status'),
    supabaseAdmin.from('payments').select('amount,status,created_at'),
    supabaseAdmin.from('usage_events').select('id', { count: 'exact', head: true }).eq('period', period),
    supabaseAdmin.from('token_usage').select('input_tokens,output_tokens,total_tokens,provider,model').eq('period', period),
  ]);

  const totalUsers = (usersRes.data as { total?: number } | null)?.total ?? usersRes.data?.users?.length ?? 0;

  // 구독: 유료 활성 + 플랜별 분포
  const subs = subsRes.data ?? [];
  const paidActive = subs.filter((s) => s.plan !== 'free' && s.status === 'active');
  const planCounts: Record<string, number> = {};
  for (const s of subs) planCounts[s.plan] = (planCounts[s.plan] ?? 0) + 1;
  // MRR = 활성 유료 구독의 월요금 합
  const mrr = paidActive.reduce((sum, s) => sum + (PLANS[s.plan as PlanId]?.priceKRW ?? 0), 0);

  // 결제: 이번 달 매출/실패
  const payments = paymentsRes.data ?? [];
  const paidThisMonth = payments.filter(
    (p) => p.status === 'paid' && (p.created_at ?? '').slice(0, 7) === period
  );
  const revenueThisMonth = paidThisMonth.reduce((s, p) => s + (p.amount ?? 0), 0);
  const failedPayments = payments.filter((p) => p.status === 'failed').length;

  // 토큰: 이번 달 총량 (원가 추정은 P1에서 단가표 붙여 계산 — 지금은 토큰만)
  const tokens = tokenThisPeriod.data ?? [];
  const totalInput = tokens.reduce((s, t) => s + (t.input_tokens ?? 0), 0);
  const totalOutput = tokens.reduce((s, t) => s + (t.output_tokens ?? 0), 0);

  return NextResponse.json({
    period,
    totalUsers,
    paidSubscribers: paidActive.length,
    planCounts,
    mrr,
    meetingsTotal: meetingsCount.count ?? 0,
    meetingsThisPeriod: usageThisPeriod.count ?? 0,
    revenueThisMonth,
    failedPayments,
    tokens: { input: totalInput, output: totalOutput, total: totalInput + totalOutput, calls: tokens.length },
  });
}
