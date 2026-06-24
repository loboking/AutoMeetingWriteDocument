import { llmComplete, resolveProvider } from '@/lib/llm';
import { PRD_SECTIONS, PRDChunkProgress, PRDGenerationResult } from './prdSections';
import { SECTION_PROMPTS } from './sectionPrompts';
import { mapWithConcurrency, withRetry } from '@/lib/concurrency';
import { sanitizeSectionContent } from './sanitizeSection';
import { postProcessGeneratedDocument } from './advancedGuards';
import type { MeetingSummary, MeetingMetadata } from '@/types';

// Re-export types
export type { PRDChunkProgress, PRDGenerationResult };

// 섹션 출력 토큰: GLM은 reasoning에 토큰을 많이 써 16384, 그 외(gpt-4o 등)는 8192
function sectionMaxTokens(): number {
  return resolveProvider().id === 'zai' ? 16384 : 8192;
}

// PRD 섹션 system 프롬프트 (한국어 출력 강제)
const PRD_SECTION_SYSTEM =
  '당신은 한국 기업의 시니어 PM입니다. 모든 출력은 반드시 한국어(한글)로 작성합니다. ' +
  '영어 단어는 고유명사(제품명, 회사명, 기술 스택명 - 예: React, Next.js, AWS), ' +
  '업계 표준 약어(API, DB, UI, UX, KPI, MAU, PRD 등), 코드/명령어에만 허용합니다. ' +
  '그 외 일반 명사, 동사, 형용사, 설명문은 모두 한국어로 작성하세요. ' +
  '예: "user" → "사용자", "feature" → "기능", "implement" → "구현", "process" → "처리". ' +
  '문장은 자연스러운 한국어 어순과 어미를 사용하고, 어색한 직역체를 피하세요. ' +
  '절대 중국어 한자나 일본어 가나를 섞지 마세요. ' +
  '예: "上述"(X) → "위에서 언급한"(O), "心理"(X) → "심리"(O), "該当"(X) → "해당"(O). ' +
  '모든 한자어는 반드시 한글로만 표기합니다.';

// 단일 섹션 생성
async function generateSection(
  sectionId: string,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  previousSections: Record<string, string>,
  onProgress?: (progress: PRDChunkProgress) => void,
  metadata?: MeetingMetadata
): Promise<{ sectionId: string; content: string }> {
  const section = PRD_SECTIONS.find(s => s.id === sectionId);
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
    console.log(`[PRD Chunk] 섹션 생성 시작: ${sectionId} (maxTokens=${maxTokens})`);

    // 429(rate limit) 발생 시 지수 backoff 재시도 (withRetry 유지, 내부 호출만 llmComplete로)
    const { text: extracted } = await withRetry(
      () =>
        llmComplete({
          prompt,
          system: PRD_SECTION_SYSTEM,
          maxTokens,
          temperature: 0.7,
          timeoutMs: 240000, // 섹션당 4분 (Vercel 300초 함수 한계 내)
        }),
      { retries: 3, baseDelayMs: 2000 }
    );
    // 프롬프트 누출 제거 + 중국어(한자) 정리 → 일관성/비용/과장 후처리
    const cleaned = sanitizeSectionContent(extracted);
    const processed = cleaned ? postProcessGeneratedDocument(cleaned, metadata) : cleaned;
    const content = processed || `## ${section.title}\n\n내용 생성 실패`;

    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'completed',
      content,
    });

    return { sectionId, content };
  } catch (error) {
    console.error(`[PRD Chunk] 섹션 생성 실패: ${sectionId}`, error);
    onProgress?.({
      sectionId,
      sectionTitle: section.title,
      status: 'error',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });

    // 실패 시 기본 형식 반환
    return {
      sectionId,
      content: `## ${section.title}\n\n생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
    };
  }
}

// z.ai 코딩플랜 제약:
//  ① 단일 요청 ~300초(5분) 서버 리밋 → 무거운 PRD를 한 번에 못 끝냄 (섹션 분할 필요)
//  ② 동시 요청 ~4개 한계 → 그 이상 병렬 시 429(code 1302) rate limit 발생
// → 섹션을 CONCURRENCY=3으로 동시 실행 + 429 시 재시도. 순차 18분 → ~3분.
const CONCURRENCY = 3;

// 전체 PRD 생성 (섹션별 동시성 제한 병렬 청킹)
export async function generatePRDByChunks(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  onProgress?: (progress: PRDChunkProgress) => void,
  metadata?: MeetingMetadata
): Promise<PRDGenerationResult> {
  const sections: Record<string, string> = {};
  const progressList: PRDChunkProgress[] = [];

  const sortedSections = [...PRD_SECTIONS].sort((a, b) => a.order - b.order);

  // 모든 섹션을 독립적으로 생성 (유기성은 공통 컨텍스트 summary+transcript로 확보).
  // 동시 실행 수를 CONCURRENCY로 제한해 z.ai rate limit(429) 회피.
  const results = await mapWithConcurrency(sortedSections, CONCURRENCY, (section) =>
    generateSection(section.id, summary, transcript, meetingInfo, {}, (progress) => {
      progressList.push(progress);
      onProgress?.(progress);
    }, metadata)
  );

  for (const result of results) {
    if (result) {
      sections[result.sectionId] = result.content;
    }
  }

  // 전체 문서 조립
  const fullDocument = assemblePRD(sections, meetingInfo);

  return {
    fullDocument,
    sections,
    progress: progressList,
  };
}

// 섹션 H2 대제목(## N. 제목) 보장
// GLM이 ### N.1 부터 출력해 H2를 누락하면 뷰어가 해당 섹션을 못 찾아 공백으로 보임 → 자동 보정
function ensureSectionHeading(content: string, sectionTitle: string): string {
  const trimmed = content.trimStart();
  // 섹션 번호 추출 (예: "9. 기술 요구사항" → "9")
  const num = sectionTitle.match(/^(\d+)\./)?.[1];
  // 이미 올바른 H2(## N.)로 시작하면 그대로 둠
  if (num) {
    const h2Pattern = new RegExp(`^##\\s+${num}\\.`, 'm');
    // 본문 첫 헤딩이 ## N. 이면 OK
    if (new RegExp(`^##\\s+${num}\\.`).test(trimmed)) return content;
    // ### N.x 등 H3로 시작하거나 H2가 빠진 경우 → H2 대제목을 앞에 삽입
    if (!h2Pattern.test(content)) {
      return `## ${sectionTitle}\n\n${trimmed}`;
    }
  }
  // 번호 패턴이 없으면 첫 헤딩이 H2인지만 확인, 아니면 삽입
  if (!/^##\s/.test(trimmed)) {
    return `## ${sectionTitle}\n\n${trimmed}`;
  }
  return content;
}

// PRD 문서 조립
function assemblePRD(
  sections: Record<string, string>,
  meetingInfo: { title: string; date: string }
): string {
  const parts: string[] = [];

  // 헤더
  parts.push(`# PRD (Product Requirements Document)`);
  parts.push(``);
  parts.push(`> 회의: ${meetingInfo.title}`);
  parts.push(`> 작성일: ${meetingInfo.date}`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  // 섹션 순서대로 조립
  const sortedSections = [...PRD_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const content = sections[section.id];
    if (content) {
      parts.push(ensureSectionHeading(content, section.title));
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
  onProgress?: (progress: PRDChunkProgress) => void
): Promise<Record<string, string>> {
  const updatedSections = { ...sections };

  for (const sectionId of failedSectionIds) {
    // 의존성 확인
    const section = PRD_SECTIONS.find(s => s.id === sectionId);
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
      onProgress
    );

    updatedSections[result.sectionId] = result.content;
  }

  return updatedSections;
}
