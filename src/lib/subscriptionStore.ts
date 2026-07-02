// 구독/결제 DB 헬퍼. 서버 전용(supabaseAdmin = service_role, RLS 우회). 클라 import 금지.
// 미터링(usageMetering)과 동일 패턴: 키 없으면 best-effort, user_id는 서버 검증값만.
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isPlanId, type PlanId } from '@/lib/plans';

export interface Subscription {
  user_id: string;
  plan: PlanId;
  status: 'active' | 'canceled' | 'past_due';
  billing_key: string | null;
  customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

// 한 달 뒤(ISO). 재결제 주기. Date 직접 생성은 워크플로 제약과 무관(런타임 서버).
function oneMonthLater(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d;
}

// 유저의 현재 플랜. 구독 없거나 조회 실패 시 'free'(안전 폴백). getMonthlyLimit가 사용.
// granted(관리자 제공)=true면 결제 상태와 무관하게 유료 취급(무제한은 getMonthlyLimit이 처리).
export async function getUserPlan(userId: string): Promise<PlanId> {
  if (!supabaseAdmin) return 'free';
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, current_period_end, granted')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return 'free';
  // 관리자 제공 계정: 만료/상태 무시하고 유료로. plan이 free면 pro로 승격 취급.
  if (data.granted) return isPlanId(data.plan) && data.plan !== 'free' ? data.plan : 'pro';
  // 만료됐거나 active 아니면 free 취급(cron이 갱신 전이거나 결제 실패 상태)
  const expired = data.current_period_end && new Date(data.current_period_end) < new Date();
  if (data.status !== 'active' || expired) return 'free';
  return isPlanId(data.plan) ? data.plan : 'free';
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

// 구독 활성화(첫 결제 성공 또는 cron 재결제 성공). period를 한 달 뒤로 설정.
export async function activateSubscription(params: {
  userId: string;
  plan: PlanId;
  billingKey: string;
  customerId: string;
  from?: Date;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const start = params.from ?? new Date();
  const { error } = await supabaseAdmin.from('subscriptions').upsert(
    {
      user_id: params.userId,
      plan: params.plan,
      status: 'active',
      billing_key: params.billingKey,
      customer_id: params.customerId,
      current_period_start: start.toISOString(),
      current_period_end: oneMonthLater(start).toISOString(),
      cancel_at_period_end: false,
    },
    { onConflict: 'user_id' }
  );
  if (error) console.error('[subscriptionStore] activate error:', error.message);
}

// 기간 갱신(cron 재결제 성공). period만 한 달 더 연장.
export async function renewSubscription(userId: string, from: Date): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: from.toISOString(),
      current_period_end: oneMonthLater(from).toISOString(),
    })
    .eq('user_id', userId);
}

// 취소 예약(기간 끝까지 유지). status는 active 유지, cancel_at_period_end만 true.
export async function cancelAtPeriodEnd(userId: string): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from('subscriptions')
    .update({ cancel_at_period_end: true })
    .eq('user_id', userId);
}

// 결제 상태 표시(cron 재결제 실패 등).
export async function markStatus(userId: string, status: Subscription['status']): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('subscriptions').update({ status }).eq('user_id', userId);
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
  if (!supabaseAdmin) return;
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
  if (error) console.error('[subscriptionStore] recordPayment error:', error.message);
}

// cron: 재결제 대상(active, 만료, 취소예약 아님).
export async function getRenewable(now: Date): Promise<Subscription[]> {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .lt('current_period_end', now.toISOString());
  return (data as Subscription[]) ?? [];
}

// cron: 취소예약 구독이 만료되면 free로 전환.
export async function expireCanceled(now: Date): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from('subscriptions')
    .update({ plan: 'free', status: 'canceled', billing_key: null })
    .eq('cancel_at_period_end', true)
    .lt('current_period_end', now.toISOString());
}
