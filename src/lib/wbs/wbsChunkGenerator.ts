import { llmComplete, resolveProvider } from '@/lib/llm';
import { WBS_SECTIONS, WBSChunkProgress, WBSGenerationResult } from './wbsSections';
import { SECTION_PROMPTS } from './sectionPrompts';
import { postProcessGeneratedDocument } from './advancedGuards';
import type { MeetingSummary, MeetingMetadata } from '@/types';

// Re-export types
export type { WBSChunkProgress, WBSGenerationResult };

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
  onProgress?: (progress: WBSChunkProgress) => void
): Promise<{ sectionId: string; content: string }> {
  const section = WBS_SECTIONS.find(s => s.id === sectionId);
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
    console.log(`[WBS Chunk] 섹션 생성 시작: ${sectionId} (maxTokens=${maxTokens})`);

    const { text } = await llmComplete({
      prompt,
      maxTokens,
      temperature: 0.7,
      timeoutMs: 120000,
    });

    let content = text || `## ${section.title}\n\n내용 생성 실패`;

    // 후처리
    content = postProcessGeneratedDocument(content, metadata);

    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'completed',
      content,
    });

    return { sectionId, content };
  } catch (error) {
    console.error(`[WBS Chunk] 섹션 생성 실패: ${sectionId}`, error);
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

// 전체 WBS 생성 (섹션별 청킹)
export async function generateWBSByChunks(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  metadata?: MeetingMetadata,
  onProgress?: (progress: WBSChunkProgress) => void
): Promise<WBSGenerationResult> {
  const sections: Record<string, string> = {};
  const progressList: WBSChunkProgress[] = [];

  // 의존성 순서대로 섹션 정렬
  const sortedSections = [...WBS_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    // 의존하는 섹션들을 컨텍스트로 전달
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

  // 전체 문서 조립
  const fullDocument = assembleWBS(sections, meetingInfo);

  return {
    fullDocument,
    sections,
    progress: progressList,
  };
}

// WBS 문서 조립
function assembleWBS(
  sections: Record<string, string>,
  meetingInfo: { title: string; date: string }
): string {
  const parts: string[] = [];

  // 헤더
  parts.push(`# WBS (Work Breakdown Structure)`);
  parts.push(``);
  parts.push(`> 회의: ${meetingInfo.title}`);
  parts.push(`> 작성일: ${meetingInfo.date}`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  // 섹션 순서대로 조립
  const sortedSections = [...WBS_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const content = sections[section.id];
    if (content) {
      parts.push(content);
      parts.push(``);
      parts.push(`---`);
      parts.push(``);
    }
  }

  // 푸터
  parts.push(``);
  parts.push(`---`);
  parts.push(``);
  parts.push(`*이 문서는 회의 녹음을 바탕으로 AI가 자동 생성했습니다.*`);

  return parts.join('\n');
}

// 섹션 재시도 (실패한 섹션만)
export async function retryFailedSections(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  sections: Record<string, string>,
  failedSectionIds: string[],
  onProgress?: (progress: WBSChunkProgress) => void
): Promise<Record<string, string>> {
  const updatedSections = { ...sections };

  for (const sectionId of failedSectionIds) {
    const section = WBS_SECTIONS.find(s => s.id === sectionId);
    if (!section) continue;

    const context: Record<string, string> = {};
    if (section.dependsOn) {
      for (const depId of section.dependsOn) {
        if (updatedSections[depId]) {
          context[depId] = updatedSections[depId];
        }
      }
    }

    const result = await generateSection(
      sectionId,
      summary,
      transcript,
      meetingInfo,
      context,
      undefined,
      onProgress
    );

    updatedSections[result.sectionId] = result.content;
  }

  return updatedSections;
}
