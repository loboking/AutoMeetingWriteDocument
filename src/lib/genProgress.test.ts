import { describe, it, expect } from 'vitest';
import { genProgressPct } from './genProgress';

describe('genProgressPct — 회의록→PRD-only 진행률', () => {
  // 회귀 방지: composite full은 total=CORE_DOCS.length(=1)이어야 섹션 진행이 0→~100%로 채워진다.
  // (버그: total=order.length(14)면 15섹션 다 돌아도 최대 7%에서 '완료'로 끝났음)
  it('total=1에서 PRD 섹션 진행이 0→99%까지 매끄럽게 오른다', () => {
    expect(genProgressPct(0, 1, { done: 0, total: 15 })).toBe(0);
    expect(genProgressPct(0, 1, { done: 1, total: 15 })).toBe(7); // 첫 섹션 완료 → 0% 탈출
    expect(genProgressPct(0, 1, { done: 8, total: 15 })).toBe(53);
    expect(genProgressPct(0, 1, { done: 15, total: 15 })).toBe(99); // 생성 중엔 100% 직전에 hold
  });

  it('total=14(잘못된 분모)면 15섹션 다 돌아도 7%에서 멈춘다 — 회귀 감시', () => {
    // 이 값이 바뀌면(=7 아님) 분모 처리가 달라진 것. 스토어 displayTotal 수정과 함께 유지.
    expect(genProgressPct(0, 14, { done: 15, total: 15 })).toBe(7);
  });

  it('세부진행 없음: done/total 그대로(단 100% 직전 hold)', () => {
    expect(genProgressPct(0, 1, undefined)).toBe(0);
    expect(genProgressPct(1, 1, undefined)).toBe(99); // 완료 100%는 호출측(isDone)에서 별도 처리
    expect(genProgressPct(3, 14, undefined)).toBe(21);
  });

  it('total<=0 방어', () => {
    expect(genProgressPct(0, 0, { done: 5, total: 15 })).toBe(0);
  });
});
