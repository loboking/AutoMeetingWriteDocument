// 정기 재결제 cron(Vercel Cron 1일 1회). 만료된 active 구독을 빌링키로 재결제.
// 취소예약(cancel_at_period_end) 구독은 만료 시 free로 전환(재결제 안 함).
// 인증: CRON_SECRET 헤더(Vercel Cron이 Authorization: Bearer 로 보냄).
import { NextRequest, NextResponse } from 'next/server';
import { payWithBillingKey, isPortOneConfigured } from '@/lib/portone';
import {
  getRenewable,
  expireCanceled,
  renewSubscription,
  markStatus,
  recordPayment,
} from '@/lib/subscriptionStore';
import { getPlanPrice } from '@/lib/plans';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Vercel Cron은 'Authorization: Bearer <CRON_SECRET>'로 호출. 수동 호출은 x-cron-secret도 허용.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const manual = request.headers.get('x-cron-secret');
  if (!secret || (auth !== `Bearer ${secret}` && manual !== secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isPortOneConfigured()) {
    return NextResponse.json({ error: 'PortOne 미설정' }, { status: 503 });
  }

  const now = new Date();
  // 1) 취소예약 만료분 → free 강등(재결제 대상에서 빠지도록 먼저).
  await expireCanceled(now);

  // 2) 만료된 active(취소예약 아님) 재결제.
  const targets = await getRenewable(now);
  let renewed = 0;
  let failed = 0;

  for (const sub of targets) {
    if (!sub.billing_key) {
      await markStatus(sub.user_id, 'past_due');
      failed++;
      continue;
    }
    const paymentId = `renew_${sub.user_id}_${sub.plan}_${now.getTime()}`;
    try {
      const res = await payWithBillingKey({
        paymentId,
        billingKey: sub.billing_key,
        plan: sub.plan,
        customer: { id: sub.user_id },
      });
      await recordPayment({
        userId: sub.user_id,
        paymentId,
        plan: sub.plan,
        amount: getPlanPrice(sub.plan),
        status: 'paid',
        raw: res,
      });
      await renewSubscription(sub.user_id, now);
      renewed++;
    } catch (error) {
      console.error('[cron/renew] 재결제 실패:', sub.user_id, error);
      await markStatus(sub.user_id, 'past_due'); // 다음날 재시도
      await recordPayment({
        userId: sub.user_id,
        paymentId,
        plan: sub.plan,
        amount: getPlanPrice(sub.plan),
        status: 'failed',
        raw: { message: error instanceof Error ? error.message : String(error) },
      });
      failed++;
    }
  }

  return NextResponse.json({ ok: true, renewed, failed, total: targets.length });
}
