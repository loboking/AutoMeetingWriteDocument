// 현재 유저 구독 상태(클라 표시용). plan/status/기간/취소예약 여부.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { getSubscription } from '@/lib/subscriptionStore';
import { PLANS } from '@/lib/plans';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const sub = await getSubscription(auth.user.id);
  // 구독 없으면 free로 응답(테이블에 row 없는 신규 유저).
  if (!sub) {
    return NextResponse.json({ plan: 'free', status: 'active', limit: PLANS.free.monthlyMeetings });
  }
  return NextResponse.json({
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    limit: PLANS[sub.plan]?.monthlyMeetings ?? PLANS.free.monthlyMeetings,
  });
}
