// Paddle 웹훅 수신. requireUser 없음 — Paddle이 호출하며 서명검증이 인증 역할.
// 계정을 다른 서비스와 공유하므로 우리 Price ID가 아닌 이벤트는 무시(200).
// DB 오류는 5xx로 돌려 Paddle이 재시도하게 한다(권한 지급 유실 방지). 멱등: 구독은 upsert, 결제는 payment_id unique.
import { NextRequest, NextResponse } from 'next/server';
import { cancelPaddleSubscription, kindForPrice, verifyPaddleSignature, verifyUserSig } from '@/lib/paddle';
import { isPlanId } from '@/lib/plans';
import {
  applyPaddleSubscription,
  getSubscription,
  getUserIdByCustomer,
  logWebhookEvent,
  recordPayment,
  revokeByTransaction,
  type Subscription,
} from '@/lib/subscriptionStore';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_MAP: Record<string, Subscription['status']> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  paused: 'past_due',
  canceled: 'canceled',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: NextRequest) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Paddle 미설정' }, { status: 503 });

  // 서명은 원본 바이트 기준 — 문자열 변환 전 버퍼에서 디코딩.
  const rawBody = Buffer.from(await request.arrayBuffer()).toString('utf8');
  if (!verifyPaddleSignature(rawBody, request.headers.get('paddle-signature'), secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  try {
    const res = await handleEvent(event, secret);
    await logWebhookEvent(event, event, null);
    return res;
  } catch (error) {
    const e = error as Error & { code?: string };
    // FK 위반(존재하지 않는 유저)은 재시도해도 안 낫는다 → 기록만 하고 200.
    if (e.code === '23503') {
      console.error('[billing/webhook] 존재하지 않는 유저, 폐기:', event.event_type, event.event_id);
      await logWebhookEvent(event, event, `dropped: ${e.message}`);
      return NextResponse.json({ ok: true, dropped: true });
    }
    // 그 외 DB 오류는 5xx → Paddle이 재시도. 수신 기록에 실패를 남겨 사람이 찾을 수 있게 한다.
    console.error('[billing/webhook] 처리 실패(재시도 요청):', event.event_type, event.event_id, e.message);
    await logWebhookEvent(event, event, e.message);
    return NextResponse.json({ error: 'retry' }, { status: 500 });
  }
}

// 이 유저가 이미 다른 Paddle 구독으로 유료 이용 중인가(= 이번 구독은 중복).
async function isDuplicateSubscription(userId: string, subscriptionId: string): Promise<boolean> {
  const cur = await getSubscription(userId);
  return (
    !!cur &&
    cur.plan !== 'free' &&
    ['active', 'past_due'].includes(cur.status) &&
    !!cur.paddle_subscription_id &&
    cur.paddle_subscription_id !== subscriptionId
  );
}

// 중복 구독은 즉시 해지(청구 중단). 이미 결제된 건은 환불 대상이므로 로그로 남긴다.
async function cancelDuplicate(userId: string, subscriptionId: string) {
  console.error('[billing/webhook] 중복 구독 감지 → 즉시 해지(환불 확인 필요):', userId, subscriptionId);
  try {
    await cancelPaddleSubscription(subscriptionId, 'immediately');
  } catch (e) {
    console.error('[billing/webhook] 중복 구독 해지 실패(수동 해지 필요):', subscriptionId, e);
  }
}

async function handleEvent(event: any, secret: string) {
  const type: string = event.event_type;
  const eventAt: string = event.occurred_at ?? new Date().toISOString();
  const data: any = event.data ?? {};

  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    // 전액 환불/차지백이 승인된 경우만 권한 회수(부분환불·승인대기는 무시). payments에 없으면 무시.
    const refunded = data.status === 'approved' && data.type === 'full' && ['refund', 'chargeback'].includes(data.action);
    if (refunded && data.transaction_id) await revokeByTransaction(data.transaction_id);
    return NextResponse.json({ ok: true });
  }

  const priceId: string | undefined = data.items?.[0]?.price?.id;
  const kind = kindForPrice(priceId);
  if (!kind) return NextResponse.json({ ok: true, ignored: true });

  // custom_data는 체크아웃을 연 브라우저가 정하는 값 → 서버가 서명한 userId만 신뢰한다.
  // 서명이 없거나 틀리면 이미 알려진 Paddle customer로만 복구(타인의 userId를 붙여 결제하는 공격 차단).
  const cd = data.custom_data ?? {};
  let userId: string | null = UUID_RE.test(cd.userId ?? '') && verifyUserSig(cd.userId, cd.sig, secret) ? cd.userId : null;
  if (!userId && data.customer_id) userId = await getUserIdByCustomer(data.customer_id);
  if (!userId) {
    console.error('[billing/webhook] 유저 식별 불가(서명 없음/불일치, 수동 확인 필요):', type, data.id, data.customer_id);
    return NextResponse.json({ ok: true });
  }

  if (type === 'transaction.completed') {
    await recordPayment({
      userId,
      paymentId: data.id,
      plan: isPlanId(kind) ? kind : 'free',
      amount: Number(data.details?.totals?.total ?? 0),
      status: 'paid',
      raw: { kind, subscription_id: data.subscription_id ?? null, currency: data.currency_code },
    });
    // 구독 갱신 결제: 결제 기간으로 period 연장(첫 결제·매월 갱신 공통).
    const period = data.billing_period;
    if (isPlanId(kind) && data.subscription_id && period) {
      if (await isDuplicateSubscription(userId, data.subscription_id)) {
        await cancelDuplicate(userId, data.subscription_id);
        return NextResponse.json({ ok: true, duplicate: true });
      }
      await applyPaddleSubscription({
        userId,
        plan: kind,
        status: 'active',
        subscriptionId: data.subscription_id,
        customerId: data.customer_id ?? null,
        periodStart: period.starts_at,
        periodEnd: period.ends_at,
        cancelAtPeriodEnd: false,
        eventAt,
      });
    }
    // ponytail: pass/extra(단건)는 결제 이력만 기록. 프로젝트 잔액 지급은 credits 테이블 도입 후.
    return NextResponse.json({ ok: true });
  }

  if (type.startsWith('subscription.') && isPlanId(kind)) {
    const status = STATUS_MAP[data.status];
    if (!status) return NextResponse.json({ ok: true });
    if (status !== 'canceled' && (await isDuplicateSubscription(userId, data.id))) {
      await cancelDuplicate(userId, data.id);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    await applyPaddleSubscription({
      userId,
      plan: kind,
      status,
      subscriptionId: data.id,
      customerId: data.customer_id ?? null,
      periodStart: data.current_billing_period?.starts_at ?? null,
      periodEnd: data.current_billing_period?.ends_at ?? null,
      cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel',
      eventAt,
    });
  }

  return NextResponse.json({ ok: true });
}
