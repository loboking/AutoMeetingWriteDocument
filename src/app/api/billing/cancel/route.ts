// 구독 취소. Paddle에 다음 결제일 해지를 예약하고 로컬도 cancel_at_period_end로 표시.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { cancelPaddleSubscription } from '@/lib/paddle';
import { cancelAtPeriodEnd, getSubscription } from '@/lib/subscriptionStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const sub = await getSubscription(auth.user.id);
  if (!sub || !['active', 'past_due'].includes(sub.status) || !sub.paddle_subscription_id) {
    return NextResponse.json({ error: '활성 구독이 없습니다.' }, { status: 400 });
  }

  try {
    // 결제 재시도 중(past_due)이면 즉시 종료해 더 청구되지 않게 한다.
    await cancelPaddleSubscription(sub.paddle_subscription_id, sub.status === 'past_due' ? 'immediately' : 'next_billing_period');
  } catch (error) {
    console.error('[billing/cancel] Paddle 실패:', error);
    return NextResponse.json({ error: '취소에 실패했습니다.' }, { status: 502 });
  }
  if (sub.status === 'active') await cancelAtPeriodEnd(auth.user.id);
  return NextResponse.json({ ok: true, currentPeriodEnd: sub.current_period_end });
}
