import { llmComplete, resolveProvider } from '@/lib/llm';
import { TESTPLAN_SECTIONS, TestPlanChunkProgress, TestPlanGenerationResult } from './testPlanSections';
import { SECTION_PROMPTS } from './sectionPrompts';
import { postProcessGeneratedDocument } from './advancedGuards';
import type { MeetingSummary, MeetingMetadata } from '@/types';

// Re-export types
export type { TestPlanChunkProgress, TestPlanGenerationResult };

// 섹션 출력 토큰: GLM 8192, 그 외(gpt-4o 등) 4096
function sectionMaxTokens(): number {
  return resolveProvider().id === 'zai' ? 8192 : 4096;
}

// 단일 섹션 생성
async function generateSection(
  sectionId: string,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  previousSections: Record<string, string>,
  metadata?: MeetingMetadata,
  onProgress?: (progress: TestPlanChunkProgress) => void
): Promise<{ sectionId: string; content: string }> {
  const section = TESTPLAN_SECTIONS.find(s => s.id === sectionId);
  if (!section) {
    throw new Error(`섹션을 찾을 수 없습니다: ${sectionId}`);
  }

  onProgress?.({
    sectionId,
    sectionTitle: section.title,
    status: 'generating',
  });

  try {
    const promptFn = SECTION_PROMPTS[sectionId];
    if (!promptFn) {
      throw new Error(`섹션 프롬프트를 찾을 수 없습니다: ${sectionId}`);
    }

    const prompt = promptFn.getPrompt({
      summary,
      transcript,
      meetingInfo,
      previousSections,
      metadata,
    });

    const maxTokens = sectionMaxTokens();
    console.log(`[TestPlan Chunk] 섹션 생성 시작: ${sectionId} (maxTokens=${maxTokens})`);

    const { text } = await llmComplete({
      prompt,
      maxTokens,
      temperature: 0.7,
      timeoutMs: 120000,
    });

    let content = text || `## ${section.title}\n\n내용 생성 실패`;

    content = postProcessGeneratedDocument(content);

    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'completed',
      content,
    });

    return { sectionId, content };
  } catch (error) {
    console.error(`[TestPlan Chunk] 섹션 생성 실패: ${sectionId}`, error);
    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'error',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });

    return {
      sectionId,
      content: `## ${section.title}\n\n생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
    };
  }
}

// 전체 테스트 계획 생성
export async function generateTestPlanByChunks(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  metadata?: MeetingMetadata,
  onProgress?: (progress: TestPlanChunkProgress) => void
): Promise<TestPlanGenerationResult> {
  const sections: Record<string, string> = {};
  const progressList: TestPlanChunkProgress[] = [];

  const sortedSections = [...TESTPLAN_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const context: Record<string, string> = {};
    if (section.dependsOn) {
      for (const depId of section.dependsOn) {
        if (sections[depId]) {
          context[depId] = sections[depId];
        }
      }
    }

    const result = await generateSection(
      section.id,
      summary,
      transcript,
      meetingInfo,
      context,
      metadata,
      (progress) => {
        progressList.push(progress);
        onProgress?.(progress);
      }
    );

    sections[result.sectionId] = result.content;
  }

  const fullDocument = assembleTestPlan(sections, meetingInfo);

  return {
    fullDocument,
    sections,
    progress: progressList,
  };
}

// 테스트 계획 문서 조립
function assembleTestPlan(
  sections: Record<string, string>,
  meetingInfo: { title: string; date: string }
): string {
  const parts: string[] = [];

  parts.push(`# 테스트 계획서 (Test Plan)`);
  parts.push(``);
  parts.push(`> 회의: ${meetingInfo.title}`);
  parts.push(`> 작성일: ${meetingInfo.date}`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  const sortedSections = [...TESTPLAN_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const content = sections[section.id];
    if (content) {
      parts.push(content);
      parts.push(``);
      parts.push(`---`);
      parts.push(``);
    }
  }

  parts.push(``);
  parts.push(`---`);
  parts.push(``);
  parts.push(`*이 문서는 회의 녹음을 바탕으로 AI가 자동 생성했습니다.*`);

  return parts.join('\n');
}
