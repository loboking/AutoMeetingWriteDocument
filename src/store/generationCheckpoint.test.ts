import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/authFetch', () => ({ cachedGenerationFetch: vi.fn() }));
import { cachedGenerationFetch } from '@/lib/authFetch';
import { useMeetingStore, type ActiveGenerationJob } from './meetingStore';
import { PRD_SECTIONS } from '@/lib/prd/prdSections';
import { getSectionLevels } from '@/lib/prd/sectionDependencies';
import type { Meeting } from '@/types';

const meeting: Meeting = {
  id: 'checkpoint-meeting', title: '복구 테스트', createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'), step: 'done',
  summary: { overview: '개요', keyPoints: [], decisions: [], actionItems: [] },
};
const job = (): ActiveGenerationJob => ({
  projectId: meeting.id, sourceNoteIds: [meeting.id], order: ['prd'],
  completedDocs: [], status: 'running', updatedAt: Date.now(),
});
async function resume(manual = false) {
  const result = useMeetingStore.getState().resumeGeneration(manual);
  await vi.runAllTimersAsync();
  await result;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', {});
  vi.mocked(cachedGenerationFetch).mockReset();
  useMeetingStore.setState({ meetings: [structuredClone(meeting)], projects: [], activeJob: job(),
    isGenerating: false, generationProgress: null, currentMeeting: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PRD 로컬 체크포인트', () => {
  it('실패 후 저장된 성공 섹션과 메타데이터를 재사용한다', async () => {
    const failedId = getSectionLevels().at(-1)![0].id;
    let fail = true;
    const requested: string[] = [];
    vi.mocked(cachedGenerationFetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.prdPhase) return Response.json({ metadata: {} });
      requested.push(body.prdSection);
      if (fail && body.prdSection === failedId) return Response.json({}, { status: 503 });
      return Response.json({ content: `## ${body.prdSection}\n완성된 본문` });
    });
    await resume();
    const saved = useMeetingStore.getState().activeJob!;
    expect(saved.status).toBe('error');
    expect(Object.keys(saved.prdCheckpoint!.sections)).toHaveLength(PRD_SECTIONS.length - 1);
    // 페이지 종료/재방문처럼 JSON 직렬화한 체크포인트를 복원한다.
    useMeetingStore.setState({ activeJob: JSON.parse(JSON.stringify(saved)) });
    fail = false;
    requested.length = 0;
    vi.mocked(cachedGenerationFetch).mockClear();
    await resume(true);
    expect(requested).toEqual([failedId]);
    expect(cachedGenerationFetch).toHaveBeenCalledTimes(1);
    expect(useMeetingStore.getState().activeJob).toBeNull();
    expect(useMeetingStore.getState().meetings[0].prd).toContain('완성된 본문');
  });

  it('입력이 바뀌면 이전 섹션을 재사용하지 않고 새로 생성한다', async () => {
    useMeetingStore.setState({ activeJob: { ...job(), resumeAttempts: 3,
      prdCheckpoint: { input: '이전 입력', metadata: {}, sections: { [PRD_SECTIONS[0].id]: '이전 본문' } } } as ActiveGenerationJob });
    vi.mocked(cachedGenerationFetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      return Response.json(body.prdPhase ? { metadata: {} } : { content: '## 새 본문' });
    });
    await resume();
    expect(cachedGenerationFetch).not.toHaveBeenCalled();
    expect(useMeetingStore.getState().activeJob).not.toBeNull();
    await resume(true);
    expect(cachedGenerationFetch).toHaveBeenCalledTimes(PRD_SECTIONS.length + 1);
    expect(useMeetingStore.getState().meetings[0].prd).not.toContain('이전 본문');
  });
  it('취소 뒤 늦게 온 응답은 체크포인트와 문서를 되살리지 않는다', async () => {
    const deliveries: ((response: Response) => void)[] = [];
    vi.mocked(cachedGenerationFetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.prdPhase) return Response.json({ metadata: {} });
      return new Promise<Response>((resolve) => { deliveries.push(resolve); });
    });
    const pending = useMeetingStore.getState().resumeGeneration();
    // 첫 섹션의 요청이 시작될 때까지 microtask만 진행한다.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(deliveries.length).toBeGreaterThan(0);
    useMeetingStore.getState().cancelGeneration();
    deliveries.forEach(deliver => deliver(Response.json({ content: '늦게 도착한 본문' })));
    await vi.runAllTimersAsync();
    await pending;
    expect(useMeetingStore.getState().activeJob).toBeNull();
    expect(useMeetingStore.getState().meetings[0].prd).toBeUndefined();
    expect(useMeetingStore.getState().isGenerating).toBe(false);
  });

});
