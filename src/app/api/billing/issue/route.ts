// 빌링키 발급 후 첫 결제 + 구독 활성화. 프론트가 requestIssueBillingKey로 받은 billingKey를 전달.
// 금액·플랜한도는 서버가 plans.ts로 결정(클라 신뢰 금지).
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { isPlanId, getPlanPrice, PAID_PLAN_IDS } from '@/lib/plans';
import { payWithBillingKey, isPortOneConfigured } from '@/lib/portone';
import { activateSubscription, recordPayment } from '@/lib/subscriptionStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  if (!isPortOneConfigured()) {
    return NextResponse.json({ error: 'PortOne 미설정' }, { status: 503 });
  }

  const { billingKey, plan } = await request.json();
  if (!billingKey || typeof billingKey !== 'string') {
    return NextResponse.json({ error: 'billingKey가 필요합니다.' }, { status: 400 });
  }
  if (!isPlanId(plan) || !PAID_PLAN_IDS.includes(plan)) {
    return NextResponse.json({ error: '유효한 유료 플랜이 아닙니다.' }, { status: 400 });
  }

  // paymentId: 멱등/추적 키. user+plan+시각으로 구성(서버 시각, 충돌 없음).
  const paymentId = `sub_${auth.user.id}_${plan}_${Date.now()}`;

  try {
    const res = await payWithBillingKey({
      paymentId,
      billingKey,
      plan,
      customer: { id: auth.user.id, email: auth.user.email },
    });

    await recordPayment({
      userId: auth.user.id,
      paymentId,
      plan,
      amount: getPlanPrice(plan),
      status: 'paid',
      raw: res,
    });
    await activateSubscription({
      userId: auth.user.id,
      plan,
      billingKey,
      customerId: auth.user.id,
    });

    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    console.error('[billing/issue] 결제 실패:', error);
    await recordPayment({
      userId: auth.user.id,
      paymentId,
      plan,
      amount: getPlanPrice(plan),
      status: 'failed',
      raw: { message: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '결제에 실패했습니다.' }, { status: 402 });
  }
}
