import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePRDByChunks } from './prdChunkGenerator';
import { PRD_SECTIONS } from './prdSections';
import { SECTION_PROMPTS } from './sectionPrompts';

const { llm } = vi.hoisted(() => ({ llm: vi.fn() }));
vi.mock('@/lib/llm', () => ({ llmComplete: llm }));

const summary = { overview: '대시보드', keyPoints: [], decisions: [], actionItems: [] };
const info = { title: '검증 회의', date: '2026-09-08' };
afterEach(() => vi.restoreAllMocks());

function identifySections() {
  for (const section of PRD_SECTIONS) {
    vi.spyOn(SECTION_PROMPTS[section.id], 'getPrompt').mockImplementation(({ previousSections }) =>
      JSON.stringify({ id: section.id, previousSections }));
  }
}

describe('PRD 의존 생성', () => {
  it('선행 결과를 기다린 뒤 전달하며 동시 2개 이하로 모든 섹션을 생성한다', async () => {
    identifySections();
    let active = 0;
    let peak = 0;
    const completed = new Set<string>();
    llm.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const { id, previousSections } = JSON.parse(prompt.split('\n')[0]);
      const section = PRD_SECTIONS.find((s) => s.id === id)!;
      for (const dep of section.dependsOn ?? []) {
        expect(completed.has(dep)).toBe(true);
        expect(previousSections[dep]).toContain(`생성 결과 ${dep}`);
      }
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      completed.add(id);
      return { text: `생성 결과 ${id}` };
    });
    const result = await generatePRDByChunks(summary, '원문', info);
    expect(completed.size).toBe(PRD_SECTIONS.length);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    expect(result.progress.filter((p) => p.status === 'completed')).toHaveLength(PRD_SECTIONS.length);
  });

  it('선행 개요가 실패하면 의존 섹션을 모델에 보내지 않고 미완성으로 남긴다', async () => {
    identifySections();
    const called: string[] = [];
    llm.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const { id } = JSON.parse(prompt.split('\n')[0]);
      called.push(id);
      return { text: id === 'overview' ? '' : `생성 결과 ${id}` };
    });
    const result = await generatePRDByChunks(summary, '원문', info);
    expect(called).not.toContain('problem');
    expect(called).not.toContain('functional-req');
    expect(result.progress.find((p) => p.sectionId === 'problem')?.status).toBe('error');
    expect(result.sections.problem).toContain('선행 섹션 확인 필요');
    expect(result.sections.appendix).toContain('생성 결과 appendix');
  });
});
