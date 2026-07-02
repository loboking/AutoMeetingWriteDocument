// 사용량 미터링: "월 회의 처리 건수" 카운팅/조회/한도. 서버 전용(supabaseAdmin 사용).
// 결제 전 단계라 ENFORCE_LIMIT=false(기록만)가 기본. 결제 붙으면 true로 켠다.
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getPlanLimit, GRANTED_LIMIT } from '@/lib/plans';
import { getUserPlan, isGranted } from '@/lib/subscriptionStore';

// 차단 스위치: 결제 붙는 순간 'true'로. 기본 꺼둠(지금은 숫자만 쌓음).
export const ENFORCE_LIMIT = process.env.ENFORCE_LIMIT === 'true';

// KST(Asia/Seoul) 기준 'YYYY-MM'. period 경계를 서버 단일 기준으로 고정.
export function getCurrentPeriod(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC+9
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 이 회의가 이미 차감됐는지(= 진행 중 회의의 나머지 문서인지). unique(user_id, meeting_id) 기준.
export async function isMeetingCounted(userId: string, meetingId: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin
    .from('usage_events')
    .select('id')
    .eq('user_id', userId)
    .eq('meeting_id', meetingId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[usageMetering] isMeetingCounted error:', error.message);
    return false;
  }
  return !!data;
}

// 이번 period의 신규 차감 건수.
export async function countThisPeriod(userId: string, period: string): Promise<number> {
  if (!supabaseAdmin) return 0;
  const { count, error } = await supabaseAdmin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('period', period);
  if (error) {
    console.error('[usageMetering] countThisPeriod error:', error.message);
    return 0;
  }
  return count ?? 0;
}

// 월 한도. 유저의 구독 플랜(subscriptions)을 읽어 plans.ts의 한도 반환. 구독 없으면 free.
// 관리자 "제공(grant)" 계정은 사실상 무제한(GRANTED_LIMIT).
export async function getMonthlyLimit(userId: string): Promise<number> {
  if (await isGranted(userId)) return GRANTED_LIMIT;
  const plan = await getUserPlan(userId);
  return getPlanLimit(plan);
}

// 첫 문서 생성 성공 시 1건 기록(멱등). best-effort — 실패해도 문서 응답은 막지 않음.
export async function recordUsage(
  userId: string,
  meetingId: string,
  period: string,
  docType: string
): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin
    .from('usage_events')
    .upsert(
      { user_id: userId, meeting_id: meetingId, period, doc_type: docType },
      { onConflict: 'user_id,meeting_id', ignoreDuplicates: true }
    );
  if (error) {
    console.error('[usageMetering] recordUsage error:', error.message);
  }
}
