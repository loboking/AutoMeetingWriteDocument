import { NextRequest } from 'next/server';
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
import OpenAI from 'openai';

export const runtime = 'nodejs';

// Z.ai GLM 모델 설정
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-4-plus';

// OpenAI 클라이언트 초기화
function createOpenAIClient() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasZai = !!process.env.ZAI_API_KEY;

  const useZai = !hasOpenAI && hasZai;
  const API_KEY = hasOpenAI ? process.env.OPENAI_API_KEY! : process.env.ZAI_API_KEY!;
  const API_BASE = useZai ? (process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4') : 'https://api.openai.com/v1';

  if (!API_KEY) {
    throw new Error('API_KEY가 필요합니다.');
  }

  return new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE,
    timeout: 120000,
  });
}

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

// 텍스트 자르기
const MAX_TRANSCRIPT_LENGTH = 20000;
function truncateTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_LENGTH) return text;
  return text.substring(0, MAX_TRANSCRIPT_LENGTH) + '\n\n[녹취록이 너무 길어서 잘렸습니다.]';
}

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
      const truncatedContent = content.length > 6000
        ? content.substring(0, 6000) + '\n\n... (생략) ...'
        : content;
      contextSection += `### ${title}\n\n${truncatedContent}\n\n---\n\n`;
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
  const truncatedTranscript = truncateTranscript(transcript);
  const prompt = getPromptForDocType(docType, summary, truncatedTranscript, meetingInfo, contextDocs);

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const useZai = !hasOpenAI && !!process.env.ZAI_API_KEY;
  const MODEL = useZai ? ZAI_MODEL : 'gpt-4o';

  try {
    const openai = createOpenAIClient();
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16384,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error(`${docType} 생성 오류:`, error);
    throw error;
  }
}

// GET 요청에 대한 SSE 스트림
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const summaryParam = searchParams.get('summary');
  const transcript = searchParams.get('transcript') || '';
  const title = searchParams.get('title') || '회의';
  const date = searchParams.get('date') || new Date().toLocaleDateString('ko-KR');

  if (!summaryParam) {
    return new Response('summary 파라미터가 필요합니다.', { status: 400 });
  }

  const summary: MeetingSummary = JSON.parse(summaryParam);
  const meetingInfo = { title, date };

  // SSE 스트림 생성
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const docs: Record<string, string> = {};
      const totalLevels = DOCUMENT_DEPENDENCIES.length;
      let completedDocs: string[] = [];

      const send = (data: any) => {
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
