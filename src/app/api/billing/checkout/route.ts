// Paddle 체크아웃 파라미터 발급. Price ID와 userId(custom_data)를 서버가 결정 — 클라 신뢰 금지.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { isPlanId, PAID_PLAN_IDS } from '@/lib/plans';
import { PADDLE_ENV, priceIdForPlan, signUserId } from '@/lib/paddle';
import { effectivePlan, getSubscription } from '@/lib/subscriptionStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const { plan } = await request.json();
  if (!isPlanId(plan) || !PAID_PLAN_IDS.includes(plan)) {
    return NextResponse.json({ error: '유효한 유료 플랜이 아닙니다.' }, { status: 400 });
  }
  const priceId = priceIdForPlan(plan);
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!priceId || !token || !secret) {
    return NextResponse.json({ error: '결제가 아직 설정되지 않았습니다.' }, { status: 503 });
  }

  // 진행 중인 유료 구독(활성·결제 재시도 중)이 있으면 새로 결제하지 못하게 막는다:
  // 한 유저 행에 구독 2개가 덮어써지면 옛 구독이 계속 과금된다(플랜 변경은 해지 후 재구독).
  const sub = await getSubscription(auth.user.id);
  if (sub && effectivePlan(sub) !== 'free' && (sub.status === 'active' || sub.status === 'past_due')) {
    const msg = sub.status === 'past_due'
      ? '결제 재시도 중인 구독이 있습니다. 결제 수단을 확인해 주세요.'
      : '이미 구독 중입니다. 해지 후 다시 구독해 주세요.';
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  return NextResponse.json({
    env: PADDLE_ENV,
    token,
    priceId,
    email: auth.user.email ?? null,
    customData: { userId: auth.user.id, sig: signUserId(auth.user.id, secret) },
  });
}
