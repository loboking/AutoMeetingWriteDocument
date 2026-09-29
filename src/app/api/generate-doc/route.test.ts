import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const { llm, tokenUsage, projectUsage } = vi.hoisted(() => ({
  llm: vi.fn(), tokenUsage: vi.fn(), projectUsage: vi.fn(),
}));
vi.mock('@/lib/llm', () => ({ llmComplete: llm }));
vi.mock('@/lib/apiAuth', () => ({ requireUser: vi.fn(async () => ({ user: { id: 'user-test' } })) }));
vi.mock('@/lib/tokenUsage', () => ({ recordTokenUsage: tokenUsage }));
vi.mock('@/lib/usageMetering', () => ({
  ENFORCE_LIMIT: false, getCurrentPeriod: () => '2026-09', recordUsage: projectUsage,
}));

const input = {
  docType: 'prd', projectId: 'project-test', review: false,
  summary: { overview: '개요', keyPoints: [], decisions: [], actionItems: [] },
  transcript: '야간 예약은 보류하고 결제를 미리 잡지 않는다.',
  meetingInfo: { title: '회의', date: '2026-09-15' },
};
function request(extra: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/generate-doc', {
    method: 'POST', body: JSON.stringify({ ...input, ...extra }),
    headers: { 'Content-Type': 'application/json' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['OPENAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER']) vi.stubEnv(key, '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('모델 교체 시 문서 생성 계약', () => {
  it('브라우저에서 전달한 선행 본문이 실제 모델 프롬프트까지 도달한다', async () => {
    llm.mockResolvedValue({ text: '문제 정의 본문', provider: 'openai', model: 'gpt-5-mini' });
    const response = await POST(request({ prdSection: 'problem', previousSections: { overview: '합의: 요청형 코스 12곳' } }));
    expect(response.status).toBe(200);
    expect(llm.mock.lastCall?.[0].prompt).toContain('합의: 요청형 코스 12곳');
    expect(await response.json()).toMatchObject({ content: '문제 정의 본문' });
    expect(projectUsage).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, [], { overview: 123 }, { overview: '생성 실패: 네트워크' }])(
    '선행 본문이 누락/실패이면 유료 호출 전에 거절한다 (%j)', async previousSections => {
      const response = await POST(request({ prdSection: 'problem', previousSections }));
      expect(response.status).toBe(400);
      expect(llm).not.toHaveBeenCalled();
      expect(projectUsage).not.toHaveBeenCalled();
    });

  it('빈 모델 응답을 성공 본문이나 프로젝트 처리 완료로 기록하지 않는다', async () => {
    llm.mockResolvedValue({ text: '', provider: 'openai', model: 'gpt-5-mini' });
    const response = await POST(request({ prdSection: 'overview' }));
    expect(response.status).toBe(502);
    expect(await response.json()).not.toHaveProperty('content');
    expect(projectUsage).not.toHaveBeenCalled();
  });

  it.each(['OPENAI_API_KEY', 'ZAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER'])(
    '%s 설정 상태의 실패를 샘플 문서로 대체하지 않는다', async key => {
      vi.stubEnv(key, 'test-configuration');
      llm.mockRejectedValue(new Error('provider failed'));
      const response = await POST(request({ docType: 'feature-list' }));
      expect(response.status).toBe(500);
      expect(await response.json()).not.toHaveProperty('content');
      expect(projectUsage).not.toHaveBeenCalled();
    });

  it('핵심 수치 추출도 공통 모델 경로와 토큰 기록을 사용한다', async () => {
    const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
    llm.mockResolvedValue({ text: '{"코스 수":"12곳 (회의 결정)"}', provider: 'openai', model: 'gpt-5-mini', usage });
    const response = await POST(request({ prdPhase: 'prepare' }));
    expect(response.status).toBe(200);
    expect(tokenUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai', model: 'gpt-5-mini', usage }));
    expect(projectUsage).not.toHaveBeenCalled();
  });
});
