import { describe, expect, it, vi } from 'vitest';
import { resolveCoreMetrics } from './resolveCoreMetrics';

const { llm } = vi.hoisted(() => ({ llm: vi.fn() }));
vi.mock('@/lib/llm', () => ({ llmComplete: llm }));
const summary = { overview: '과거 요약', keyPoints: [], decisions: [], actionItems: [] };

describe('핵심 수치 추출', () => {
  it('공통 모델 경로에 긴 원문의 마지막 정정까지 보낸다', async () => {
    const transcript = '기존 계획 논의. '.repeat(1_000) + '최종 결정: 예산은 237만원으로 정정.';
    llm.mockResolvedValue({ text: '{"예산":"237만원 (최종 결정)"}' });
    expect(await resolveCoreMetrics(summary, transcript)).toEqual({ 예산: '237만원 (최종 결정)' });
    expect(llm.mock.lastCall?.[0].prompt).toContain('최종 결정: 예산은 237만원으로 정정.');
  });

  it('모델이 제외한 미확정 수치를 휴리스틱 시드에서 복원하지 않는다', async () => {
    llm.mockResolvedValue({ text: '{}' });
    expect(await resolveCoreMetrics(summary, 'ARPU는 자료가 없어 미확정.', { ARPU: '19450원' })).toEqual({});
  });

  it('추출 실패를 확정 수치로 전파하지 않는다', async () => {
    llm.mockRejectedValue(new Error('network'));
    expect(await resolveCoreMetrics(summary, '원문', { 예산: '이전 값' })).toEqual({});
  });
});
