// 요금제 단일 출처. 가격·한도·좌석을 여기서만 정의 — usageMetering/결제/UI 모두 이걸 참조.
// 한나 원가 산출·z.ai 한도 확인 후 이 파일의 숫자만 수정하면 전 시스템에 반영된다.
export type PlanId = 'free' | 'pro' | 'team';

export interface Plan {
  id: PlanId;
  name: string;
  priceKRW: number; // 월 구독료(원). 0 = 무료.
  monthlyMeetings: number; // 월 회의 처리 건수 한도(= 미터링 주축).
  seats: number; // 동시 협업 좌석(보조축, 현재 UI 미구현).
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', name: 'Free', priceKRW: 0, monthlyMeetings: 1, seats: 1 },
  pro: { id: 'pro', name: 'Pro', priceKRW: 9900, monthlyMeetings: 10, seats: 1 },
  team: { id: 'team', name: 'Team', priceKRW: 49900, monthlyMeetings: 55, seats: 5 },
};

// 결제 가능한(유료) 플랜만. UI 구독 버튼/금액 검증에 사용.
export const PAID_PLAN_IDS: PlanId[] = ['pro', 'team'];

export function isPlanId(v: string): v is PlanId {
  return v === 'free' || v === 'pro' || v === 'team';
}

// 관리자 "제공(grant)" 계정의 사실상 무제한 한도. (실수치 상한이 필요한 미터링용 큰 값)
export const GRANTED_LIMIT = 999999;

// 플랜의 월 회의 한도. 미터링 getMonthlyLimit가 호출. 알 수 없으면 free로 안전 폴백.
export function getPlanLimit(planId: string): number {
  return (isPlanId(planId) ? PLANS[planId] : PLANS.free).monthlyMeetings;
}

// 결제 금액(원). 서버가 이 값으로 결제 — 클라가 보낸 금액 신뢰 금지(위변조 방지).
export function getPlanPrice(planId: PlanId): number {
  return PLANS[planId].priceKRW;
}
