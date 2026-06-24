import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { getPRDPrompt } from '@/lib/prdTemplate';
import { getApiSpecPrompt } from '@/lib/apiSpecTemplate';
import { getDeploymentPrompt } from '@/lib/deploymentTemplate';
import { getTestCasePrompt } from '@/lib/testCaseTemplate';
import { getDatabasePrompt } from '@/lib/databaseTemplate';
import { getWireframePrompt } from '@/lib/wireframeTemplate';
import { getUserStoryPrompt } from '@/lib/userStoryTemplate';
import { getFeatureListPrompt } from '@/lib/featureListTemplate';
import { getScreenListPrompt } from '@/lib/screenListTemplate';
import { getIaPrompt } from '@/lib/iaTemplate';
import { getFlowchartPrompt } from '@/lib/flowchartTemplate';
import { getStoryboardPrompt } from '@/lib/storyboardTemplate';
import { getWBSPrompt } from '@/lib/wbsTemplate';
import { getTestPlanPrompt } from '@/lib/testPlanTemplate';
import type { MeetingSummary } from '@/types';
import { llmComplete, resolveProvider } from '@/lib/llm';

export const runtime = 'nodejs';
// Vercel Hobby 플랜 상한 = 300초.
export const maxDuration = 300;

// 한국어 출력 강제 시스템 프롬프트 (GLM-5는 한/영/중 혼합 출력 경향 있음)
const KOREAN_OUTPUT_SYSTEM_PROMPT =
  '당신은 한국 기업의 시니어 PM/기획자입니다. 모든 출력은 반드시 한국어(한글)로 작성합니다. ' +
  '영어 단어는 고유명사(제품명, 회사명, 기술 스택명 - 예: React, Next.js, AWS), ' +
  '업계 표준 약어(API, DB, UI, UX, KPI, MAU, PRD, CRUD 등), 코드/명령어/식별자에만 허용합니다. ' +
  '그 외 일반 명사, 동사, 형용사, 설명문은 모두 한국어로 작성하세요. ' +
  '예: "user" → "사용자", "feature" → "기능", "implement" → "구현", "process" → "처리", "manage" → "관리". ' +
  '문장은 자연스러운 한국어 어순과 어미를 사용하고, 어색한 직역체나 중국어식 표현을 피하세요. ' +
  '마크다운 표/제목/리스트의 항목명도 한국어로 작성합니다.';

type DocType =
  | 'prd'
  | 'feature-list'
  | 'screen-list'
  | 'ia'
  | 'flowchart'
  | 'wireframe'
  | 'storyboard'
  | 'user-story'
  | 'wbs'
  | 'api-spec'
  | 'test-case'
  | 'database'
  | 'deployment'
  | 'test-plan';

interface DocLevel {
  level: number;
  docTypes: DocType[];
  dependsOn?: DocType[];
}

const DOCUMENT_DEPENDENCIES: DocLevel[] = [
  { level: 1, docTypes: ['prd'] },
  { level: 2, docTypes: ['feature-list', 'screen-list', 'ia', 'flowchart'], dependsOn: ['prd'] },
  { level: 3, docTypes: ['wireframe', 'storyboard', 'user-story'], dependsOn: ['feature-list', 'screen-list', 'ia'] },
  { level: 4, docTypes: ['wbs', 'api-spec', 'database'], dependsOn: ['feature-list', 'user-story'] },
  { level: 5, docTypes: ['test-plan', 'test-case', 'deployment'], dependsOn: ['wbs', 'api-spec', 'database'] },
];

const DOCUMENT_TITLES: Record<DocType, string> = {
  prd: 'PRD',
  'feature-list': '기능 목록',
  'screen-list': '화면 목록',
  ia: 'IA',
  flowchart: '플로우차트',
  wireframe: '와이어프레임',
  storyboard: '스토리보드',
  'user-story': '사용자 스토리',
  wbs: 'WBS',
  'api-spec': 'API 명세',
  'test-case': '테스트 케이스',
  database: 'DB 설계',
  deployment: '배포 가이드',
  'test-plan': '테스트 계획',
};

// 프롬프트 생성 함수 (기존과 동일)
function getPromptForDocType(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  contextDocs: Record<string, string> = {}
): string {
  let contextSection = '';
  if (Object.keys(contextDocs).length > 0) {
    contextSection = '\n## 이전에 생성된 문서\n\n';
    for (const [key, content] of Object.entries(contextDocs)) {
      const title = DOCUMENT_TITLES[key as DocType] || key;
      // 전체 컨텍스트 전달 (GLM-5의 128K 토큰 활용)
      contextSection += `### ${title}\n\n${content}\n\n---\n\n`;
    }
  }

  const baseInfo = `
## 회의 정보
- 제목: ${meetingInfo.title}
- 날짜: ${meetingInfo.date}

## 회의 요약
- 개요: ${summary.overview}
- 핵심 사항: ${summary.keyPoints.join(', ')}
- 의사결정: ${summary.decisions.join(', ')}
${contextSection}`;

  if (docType === 'prd') return getPRDPrompt(baseInfo, transcript, meetingInfo);
  if (docType === 'feature-list') return getFeatureListPrompt(baseInfo, transcript);
  if (docType === 'screen-list') return getScreenListPrompt(baseInfo, transcript);
  if (docType === 'ia') return getIaPrompt(baseInfo, transcript);
  if (docType === 'flowchart') return getFlowchartPrompt(baseInfo, transcript);
  if (docType === 'wireframe') return getWireframePrompt(baseInfo, transcript);
  if (docType === 'storyboard') return getStoryboardPrompt(baseInfo, transcript);
  if (docType === 'user-story') return getUserStoryPrompt(baseInfo, transcript);
  if (docType === 'wbs') return getWBSPrompt(baseInfo, transcript);
  if (docType === 'api-spec') return getApiSpecPrompt(baseInfo, transcript);
  if (docType === 'test-case') return getTestCasePrompt(baseInfo, transcript);
  if (docType === 'test-plan') return getTestPlanPrompt(baseInfo, transcript);
  if (docType === 'database') return getDatabasePrompt(baseInfo, transcript);
  if (docType === 'deployment') return getDeploymentPrompt(baseInfo, transcript);
  return getPRDPrompt(baseInfo, transcript, meetingInfo);
}

// 문서 생성 함수
async function generateDocument(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  contextDocs: Record<string, string> = {}
): Promise<string> {
  const prompt = getPromptForDocType(docType, summary, transcript, meetingInfo, contextDocs);

  // GLM은 reasoning에 토큰을 많이 써 16384, 그 외(gpt-4o 등)는 12288
  const isGlm = resolveProvider().id === 'zai';

  try {
    const { text } = await llmComplete({
      prompt,
      system: KOREAN_OUTPUT_SYSTEM_PROMPT,
      maxTokens: isGlm ? 16384 : 12288,
      timeoutMs: 600000,
      maxRetries: 1,
    });
    return text;
  } catch (error) {
    console.error(`${docType} 생성 오류:`, error);
    throw error;
  }
}

// POST 요청에 대한 SSE 스트림 (큰 데이터용)
// (구 GET/SSE 핸들러는 무인증 + 쿼리토큰 노출 위험으로 삭제. EventSource 클라 참조 0건.)
export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  const body = await request.json();
  const summary = body.summary as MeetingSummary;
  const transcript = body.transcript || '';
  const title = body.title || '회의';
  const date = body.date || new Date().toLocaleDateString('ko-KR');

  if (!summary) {
    return new Response('summary 파라미터가 필요합니다.', { status: 400 });
  }

  const meetingInfo = { title, date };

  return generateDocumentStream(summary, transcript, meetingInfo);
}

// 공통 스트림 생성 함수
function generateDocumentStream(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string }
): Response {
  // SSE 스트림 생성
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const docs: Record<string, string> = {};
      const totalLevels = DOCUMENT_DEPENDENCIES.length;
      const completedDocs: string[] = [];

      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for (const levelConfig of DOCUMENT_DEPENDENCIES) {
          // 레벨 시작 알림
          send({
            type: 'level_start',
            level: levelConfig.level,
            totalLevels,
            docTypes: levelConfig.docTypes,
          });

          // 현재 레벨의 문서들 컨텍스트 수집
          const contextDocs: Record<string, string> = {};
          if (levelConfig.dependsOn) {
            for (const dep of levelConfig.dependsOn) {
              if (docs[dep]) {
                contextDocs[dep] = docs[dep];
              }
            }
          }

          // 각 문서 생성
          for (const docType of levelConfig.docTypes) {
            send({
              type: 'doc_start',
              docType,
              docTitle: DOCUMENT_TITLES[docType],
            });

            try {
              const content = await generateDocument(
                docType,
                summary,
                transcript,
                meetingInfo,
                contextDocs
              );

              docs[docType] = content;
              completedDocs.push(docType);

              send({
                type: 'doc_complete',
                docType,
                docTitle: DOCUMENT_TITLES[docType],
                content,
                progress: {
                  current: completedDocs.length,
                  total: Object.values(DOCUMENT_DEPENDENCIES).reduce((sum, level) => sum + level.docTypes.length, 0),
                },
              });
            } catch (error) {
              console.error(`${docType} 생성 실패:`, error);
              send({
                type: 'doc_error',
                docType,
                docTitle: DOCUMENT_TITLES[docType],
                error: error instanceof Error ? error.message : '알 수 없는 오류',
              });
            }
          }

          // 레벨 완료 알림
          send({
            type: 'level_complete',
            level: levelConfig.level,
            totalLevels,
          });
        }

        // 전체 완료
        send({
          type: 'all_complete',
          docs,
        });
      } catch (error) {
        console.error('스트림 생성 오류:', error);
        send({
          type: 'error',
          error: error instanceof Error ? error.message : '알 수 없는 오류',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
