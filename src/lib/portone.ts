// 서버 전용 PortOne V2 래퍼. @portone/server-sdk 사용. 클라 import 금지.
// 결제 금액은 항상 plans.ts에서 서버가 결정 — 호출부가 amount를 넘기지 않는다(위변조 방지).
import { PortOneClient, Webhook } from '@portone/server-sdk';
import { getPlanPrice, PLANS, type PlanId } from '@/lib/plans';

const apiSecret = process.env.PORTONE_API_SECRET;
const channelKey = process.env.PORTONE_CHANNEL_KEY;
const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;

// 키 없으면 null → 호출부가 503/스킵. (테스트 키 미설정 환경에서 import만으로 죽지 않게)
const client = apiSecret ? PortOneClient({ secret: apiSecret }) : null;

export function isPortOneConfigured(): boolean {
  return !!client && !!channelKey && !!webhookSecret;
}

// 빌링키로 즉시 결제. 금액은 plan으로 서버가 결정. paymentId는 멱등/추적 키(호출부 생성).
export async function payWithBillingKey(params: {
  paymentId: string;
  billingKey: string;
  plan: PlanId;
  customer: { id: string; email?: string };
}) {
  if (!client) throw new Error('PortOne 미설정(PORTONE_API_SECRET)');
  const amount = getPlanPrice(params.plan);
  return client.payment.payWithBillingKey({
    paymentId: params.paymentId,
    billingKey: params.billingKey,
    ...(channelKey ? { channelKey } : {}),
    orderName: `MeetingAutoDocs ${PLANS[params.plan].name} 구독`,
    customer: { id: params.customer.id, email: params.customer.email },
    amount: { total: amount },
    currency: 'KRW',
  });
}

// 웹훅 서명 검증. 실패 시 throw(WebhookVerificationError). 성공 시 디코딩된 페이로드.
export async function verifyWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
) {
  if (!webhookSecret) throw new Error('PortOne 미설정(PORTONE_WEBHOOK_SECRET)');
  return Webhook.verify(webhookSecret, rawBody, headers);
}
