// 생성 진행률(%) 계산. 문서 완료수(done/total)에 현재 문서 내부 세부진행(PRD 섹션 등)을
// 분수로 blend → 진행바가 매끄럽게 움직여 '0% 프리징'을 해소한다.
// 세부진행 blend는 아직 완료 문서가 없을 때(done===0)만 적용(단일 core=PRD 시나리오 기준).
// 생성 중에는 100% 직전(99%)에서 멈춰 '완료'와 시각적으로 구분한다(완료는 호출측에서 100%).
export function genProgressPct(
  done: number,
  total: number,
  sub?: { done: number; total: number },
): number {
  if (total <= 0) return 0;
  const fractional = sub && sub.total > 0 && done === 0 ? sub.done / sub.total : 0;
  return Math.min(99, Math.round(((done + fractional) / total) * 100));
}
