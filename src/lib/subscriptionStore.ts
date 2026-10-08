// 구독/결제 DB 헬퍼. 서버 전용(supabaseAdmin = service_role, RLS 우회). 클라 import 금지.
// 미터링(usageMetering)과 동일 패턴: 키 없으면 best-effort, user_id는 서버 검증값만.
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isPlanId, type PlanId } from '@/lib/plans';

export interface Subscription {
  user_id: string;
  plan: PlanId;
  status: 'active' | 'canceled' | 'past_due';
  billing_key: string | null;
  paddle_subscription_id: string | null;
  paddle_event_at: string | null;
  customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

// 결제 기간 만료 후 유예(갱신 웹훅 지연·past_due 재시도 흡수).
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

// 구독 행 → 실제 적용 플랜(단일 출처: 게이트·상태 API·체크아웃이 모두 이걸 쓴다).
// canceled는 즉시 free. active/past_due는 기간 만료 후에도 유예일 동안 유지:
// 갱신 웹훅 지연·카드 재시도 중에 권한이 끊기지 않게 한다.
export function effectivePlan(row: {
  plan: string;
  status: string;
  current_period_end: string | null;
  granted?: boolean;
}): PlanId {
  // 관리자 제공 계정: 만료/상태 무시하고 유료로. plan이 free면 pro로 승격 취급.
  if (row.granted) return isPlanId(row.plan) && row.plan !== 'free' ? row.plan : 'pro';
  if (row.status === 'canceled') return 'free';
  const graceEnd = row.current_period_end ? new Date(row.current_period_end).getTime() + GRACE_MS : null;
  if (graceEnd !== null && graceEnd < Date.now()) return 'free';
  return isPlanId(row.plan) ? row.plan : 'free';
}

// 유저의 현재 플랜. 구독 없거나 조회 실패 시 'free'(안전 폴백). getMonthlyLimit가 사용.
export async function getUserPlan(userId: string): Promise<PlanId> {
  if (!supabaseAdmin) return 'free';
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, current_period_end, granted')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return 'free';
  return effectivePlan(data);
}

// 관리자 "제공(무제한)" 여부.
export async function isGranted(userId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('granted')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data?.granted;
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as Subscription) ?? null;
}

// 웹훅 경로 DB 오류는 삼키지 않고 throw — 웹훅이 5xx를 돌려줘 Paddle이 재시도하게 한다.
// code는 Postgres 에러코드(예: FK 위반 23503)를 호출부가 구분하도록 보존.
function dbError(message: string, code?: string): Error & { code?: string } {
  return Object.assign(new Error(message), { code });
}

// Paddle 웹훅 반영. paddle_subscription_id = 해지 API용 구독 id.
// - eventAt이 저장된 것보다 오래된 이벤트는 무시(순서 뒤바뀜).
// - 현재와 다른(옛) 구독의 canceled 이벤트는 무시(새 구독을 내리지 않게).
export async function applyPaddleSubscription(params: {
  userId: string;
  plan: PlanId;
  status: Subscription['status'];
  subscriptionId: string;
  customerId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  eventAt: string;
}): Promise<void> {
  if (!supabaseAdmin) throw dbError('supabaseAdmin 미설정');
  const { data: cur, error: readErr } = await supabaseAdmin
    .from('subscriptions')
    .select('paddle_subscription_id, paddle_event_at')
    .eq('user_id', params.userId)
    .maybeSingle();
  if (readErr) throw dbError(readErr.message, readErr.code);
  if (cur?.paddle_event_at && new Date(params.eventAt) < new Date(cur.paddle_event_at)) return;
  const ended = params.status === 'canceled';
  if (ended && cur?.paddle_subscription_id && cur.paddle_subscription_id !== params.subscriptionId) return;

  const { error } = await supabaseAdmin.from('subscriptions').upsert(
    {
      user_id: params.userId,
      plan: ended ? 'free' : params.plan,
      status: params.status,
      paddle_subscription_id: params.subscriptionId,
      paddle_event_at: params.eventAt,
      customer_id: params.customerId,
      current_period_start: params.periodStart,
      current_period_end: params.periodEnd,
      cancel_at_period_end: params.cancelAtPeriodEnd,
    },
    { onConflict: 'user_id' }
  );
  if (error) throw dbError(error.message, error.code);
}

// 환불/차지백(전액): 결제 이력을 canceled로 바꾸고, 그 결제가 유료 플랜의 최신 결제면 권한 회수.
// (과거 달 결제 환불로 현재 구독을 내리지 않기 위해 "최신 결제"일 때만.)
export async function revokeByTransaction(transactionId: string): Promise<void> {
  if (!supabaseAdmin) throw dbError('supabaseAdmin 미설정');
  const { data: pay, error } = await supabaseAdmin
    .from('payments')
    .update({ status: 'canceled' })
    .eq('payment_id', transactionId)
    .select('user_id, plan')
    .maybeSingle();
  if (error) throw dbError(error.message, error.code);
  if (!pay || !isPlanId(pay.plan) || pay.plan === 'free') return;
  const { data: latest } = await supabaseAdmin
    .from('payments')
    .select('payment_id')
    .eq('user_id', pay.user_id)
    .in('plan', ['pro', 'team'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.payment_id !== transactionId) return;
  const { error: subErr } = await supabaseAdmin
    .from('subscriptions')
    .update({ plan: 'free', status: 'canceled' })
    .eq('user_id', pay.user_id);
  if (subErr) throw dbError(subErr.message, subErr.code);
}

// custom_data.userId가 빠진 이벤트 복구: 이미 알려진 Paddle customer → 우리 유저.
export async function getUserIdByCustomer(customerId: string): Promise<string | null> {
  if (!supabaseAdmin) throw dbError('supabaseAdmin 미설정');
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw dbError(error.message, error.code);
  return data?.user_id ?? null;
}

// 취소 예약(기간 끝까지 유지). status는 active 유지, cancel_at_period_end만 true.
export async function cancelAtPeriodEnd(userId: string): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from('subscriptions')
    .update({ cancel_at_period_end: true })
    .eq('user_id', userId);
}

// 결제 이력 기록(멱등 — payment_id unique + ignoreDuplicates).
export async function recordPayment(params: {
  userId: string;
  paymentId: string;
  plan: PlanId;
  amount: number;
  status: 'paid' | 'failed' | 'canceled';
  raw?: unknown;
}): Promise<void> {
  if (!supabaseAdmin) throw dbError('supabaseAdmin 미설정');
  const { error } = await supabaseAdmin.from('payments').upsert(
    {
      user_id: params.userId,
      payment_id: params.paymentId,
      plan: params.plan,
      amount: params.amount,
      status: params.status,
      raw: params.raw ?? null,
    },
    { onConflict: 'payment_id', ignoreDuplicates: true }
  );
  if (error) throw dbError(error.message, error.code);
}

// 웹훅 수신 기록(대사·재처리 판단용). best-effort — 테이블이 없거나 실패해도 웹훅 처리는 계속한다.
export async function logWebhookEvent(event: { event_id?: string; event_type?: string }, payload: unknown, error: string | null): Promise<void> {
  if (!supabaseAdmin || !event.event_id) return;
  const { error: e } = await supabaseAdmin.from('webhook_events').upsert(
    { event_id: event.event_id, type: event.event_type ?? '', payload, error, processed_at: error ? null : new Date().toISOString() },
    { onConflict: 'event_id' }
  );
  if (e) console.error('[subscriptionStore] webhook log error:', e.message);
}
