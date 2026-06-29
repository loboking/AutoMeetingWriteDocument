// 구독 취소. 기간 끝까지 유지 + 다음 달 자동재결제만 중단(cancel_at_period_end=true).
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { cancelAtPeriodEnd, getSubscription } from '@/lib/subscriptionStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const sub = await getSubscription(auth.user.id);
  if (!sub || sub.status !== 'active') {
    return NextResponse.json({ error: '활성 구독이 없습니다.' }, { status: 400 });
  }

  await cancelAtPeriodEnd(auth.user.id);
  return NextResponse.json({ ok: true, currentPeriodEnd: sub.current_period_end });
}
