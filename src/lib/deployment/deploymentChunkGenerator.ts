import OpenAI from 'openai';
import { DEPLOYMENT_SECTIONS, DeploymentChunkProgress, DeploymentGenerationResult } from './deploymentSections';
import { SECTION_PROMPTS } from './sectionPrompts';
import { postProcessGeneratedDocument } from './advancedGuards';
import type { MeetingSummary, MeetingMetadata } from '@/types';

// Re-export types
export type { DeploymentChunkProgress, DeploymentGenerationResult };

// API 클라이언트 생성
function createOpenAIClient() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasZai = !!process.env.ZAI_API_KEY;

  const useZai = !hasOpenAI && hasZai;
  const API_KEY = hasOpenAI ? process.env.OPENAI_API_KEY! : process.env.ZAI_API_KEY!;
  const API_BASE = useZai
    ? (process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4')
    : 'https://api.openai.com/v1';

  if (!API_KEY) {
    throw new Error('API_KEY가 필요합니다. ZAI_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
  }

  return new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE,
    timeout: 120000,
  });
}

// 모델 설정
function getModelConfig() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const useZai = !hasOpenAI && !!process.env.ZAI_API_KEY;
  const model = useZai ? (process.env.ZAI_MODEL || 'glm-5') : 'gpt-4o';
  const maxTokens = model.includes('glm') ? 8192 : 4096;
  return { model, maxTokens, useZai };
}

// 단일 섹션 생성
async function generateSection(
  sectionId: string,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  previousSections: Record<string, string>,
  metadata?: MeetingMetadata,
  onProgress?: (progress: DeploymentChunkProgress) => void
): Promise<{ sectionId: string; content: string }> {
  const section = DEPLOYMENT_SECTIONS.find(s => s.id === sectionId);
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

    const { model, maxTokens } = getModelConfig();
    const openai = createOpenAIClient();

    console.log(`[Deployment Chunk] 섹션 생성 시작: ${sectionId} (${model}, maxTokens=${maxTokens})`);

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    let content = response.choices[0]?.message?.content || `## ${section.title}\n\n내용 생성 실패`;

    content = postProcessGeneratedDocument(content);

    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'completed',
      content,
    });

    return { sectionId, content };
  } catch (error) {
    console.error(`[Deployment Chunk] 섹션 생성 실패: ${sectionId}`, error);
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

// 전체 배포 가이드 생성
export async function generateDeploymentByChunks(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  metadata?: MeetingMetadata,
  onProgress?: (progress: DeploymentChunkProgress) => void
): Promise<DeploymentGenerationResult> {
  const sections: Record<string, string> = {};
  const progressList: DeploymentChunkProgress[] = [];

  const sortedSections = [...DEPLOYMENT_SECTIONS].sort((a, b) => a.order - b.order);

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

  const fullDocument = assembleDeployment(sections, meetingInfo);

  return {
    fullDocument,
    sections,
    progress: progressList,
  };
}

// 배포 가이드 문서 조립
function assembleDeployment(
  sections: Record<string, string>,
  meetingInfo: { title: string; date: string }
): string {
  const parts: string[] = [];

  parts.push(`# 배포 가이드 (Deployment Guide)`);
  parts.push(``);
  parts.push(`> 회의: ${meetingInfo.title}`);
  parts.push(`> 작성일: ${meetingInfo.date}`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  const sortedSections = [...DEPLOYMENT_SECTIONS].sort((a, b) => a.order - b.order);

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
