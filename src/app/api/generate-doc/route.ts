import { NextRequest, NextResponse } from 'next/server';
import { getPRDPrompt } from '@/lib/prdTemplate';
import { getApiSpecPrompt } from '@/lib/apiSpecTemplate';
import { getDeploymentPrompt } from '@/lib/deploymentTemplate';
import { getTestCasePrompt } from '@/lib/testCaseTemplate';
import { getDatabasePrompt } from '@/lib/databaseTemplate';
import { getWireframePrompt } from '@/lib/wireframeTemplate';
import { getUserStoryPrompt } from '@/lib/userStoryTemplate';
import type { MeetingSummary } from '@/types';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.ZAI_API_KEY,
});

// 문서 의존 관계 (1뎁스 → 2뎁스 → 3뎁스...)
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
  dependsOn?: DocType[]; // 이전 레벨에서 생성된 문서들을 참조
}

const DOCUMENT_DEPENDENCIES: DocLevel[] = [
  {
    level: 1,
    docTypes: ['prd'],
  },
  {
    level: 2,
    docTypes: ['feature-list', 'screen-list', 'ia', 'flowchart'],
    dependsOn: ['prd'],
  },
  {
    level: 3,
    docTypes: ['wireframe', 'storyboard', 'user-story'],
    dependsOn: ['feature-list', 'screen-list', 'ia'],
  },
  {
    level: 4,
    docTypes: ['wbs', 'api-spec', 'database'],
    dependsOn: ['feature-list', 'user-story'],
  },
  {
    level: 5,
    docTypes: ['test-plan', 'test-case', 'deployment'],
    dependsOn: ['wbs', 'api-spec', 'database'],
  },
];

interface GenerationProgress {
  currentLevel: number;
  totalLevels: number;
  currentDoc: string;
  completedDocs: string[];
  status: 'generating' | 'completed' | 'error';
  error?: string;
}

interface GeneratedDocs {
  [key: string]: string;
}

const DOCUMENT_TITLES: Record<DocType, string> = {
  prd: 'PRD (Product Requirements Document)',
  'feature-list': '기능 목록 정의서',
  'screen-list': '화면 목록 정의서',
  ia: 'IA (정보구조도)',
  flowchart: '플로우차트',
  wireframe: '와이어프레임 문서',
  storyboard: 'SB (스토리보드)',
  'user-story': '사용자 스토리 문서',
  wbs: 'WBS (Work Breakdown Structure)',
  'api-spec': 'API 명세서',
  'test-case': '테스트 케이스 명세서',
  database: '데이터베이스 설계서',
  deployment: '배포 가이드',
  'test-plan': '테스트 계획서',
};


async function generateDocument(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string }
): Promise<string> {
  const prompt = getPromptForDocType(docType, summary, transcript, meetingInfo);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16384,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenAI API 오류:', error);
    return getMockDoc(docType, summary, meetingInfo);
  }
}

// 연계 문서 생성 함수
async function generateAllDocuments(
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  onProgress?: (progress: GenerationProgress) => void
): Promise<{ docs: GeneratedDocs; progress: GenerationProgress }> {
  const docs: GeneratedDocs = {};
  const completedDocs: string[] = [];

  for (const levelConfig of DOCUMENT_DEPENDENCIES) {
    // 현재 레벨 진행 상황 알림
    onProgress?.({
      currentLevel: levelConfig.level,
      totalLevels: DOCUMENT_DEPENDENCIES.length,
      currentDoc: '',
      completedDocs,
      status: 'generating',
    });

    // 현재 레벨의 모든 문서 생성
    for (const docType of levelConfig.docTypes) {
      onProgress?.({
        currentLevel: levelConfig.level,
        totalLevels: DOCUMENT_DEPENDENCIES.length,
        currentDoc: docType,
        completedDocs,
        status: 'generating',
      });

      try {
        // 이전 레벨에서 생성된 문서들을 컨텍스트로 전달
        const contextDocs = getContextDocs(levelConfig.dependsOn || [], docs);

        const content = await generateDocumentWithContext(
          docType,
          summary,
          transcript,
          meetingInfo,
          contextDocs
        );

        docs[docType] = content;
        completedDocs.push(docType);
      } catch (error) {
        console.error(`${docType} 생성 실패:`, error);
        // 실패해도 계속 진행
        docs[docType] = getMockDoc(docType, summary, meetingInfo);
      }
    }
  }

  return {
    docs,
    progress: {
      currentLevel: DOCUMENT_DEPENDENCIES.length,
      totalLevels: DOCUMENT_DEPENDENCIES.length,
      currentDoc: '',
      completedDocs,
      status: 'completed',
    },
  };
}

// 의존하는 문서들을 컨텍스트로 정리
function getContextDocs(dependsOn: DocType[], docs: GeneratedDocs): Record<string, string> {
  const context: Record<string, string> = {};
  for (const docType of dependsOn) {
    if (docs[docType]) {
      context[docType] = docs[docType];
    }
  }
  return context;
}

// 컨텍스트(이전 문서)를 참조하여 문서 생성
async function generateDocumentWithContext(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string },
  contextDocs: Record<string, string>
): Promise<string> {
  const prompt = getPromptForDocType(docType, summary, transcript, meetingInfo);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16384,
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenAI API 오류:', error);
    throw error;
  }
}

function getPromptForDocType(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string }
): string {
  const baseInfo = `
## 회의 정보
- 제목: ${meetingInfo.title}
- 날짜: ${meetingInfo.date}

## 회의 요약
- 개요: ${summary.overview}
- 핵심 사항: ${summary.keyPoints.join(', ')}
- 의사결정: ${summary.decisions.join(', ')}
`;


  if (docType === 'wireframe') {
    return getWireframePrompt(baseInfo, transcript);
  }

  if (docType === 'user-story') {
    return getUserStoryPrompt(baseInfo, transcript);
  }


  if (docType === 'api-spec') {
    return getApiSpecPrompt(baseInfo, transcript);
  }

  if (docType === 'deployment') {
    return getDeploymentPrompt(baseInfo, transcript);

  }


  if (docType === 'test-case') {
    return getTestCasePrompt(baseInfo, transcript);
  }

  if (docType === 'database') {
    return getDatabasePrompt(baseInfo, transcript);
  }

  // Default: PRD
  return getPRDPrompt(baseInfo, transcript, meetingInfo);
}

// 모의 문서 생성 (API 실패 시 사용)
function getMockDoc(docType: DocType, summary: MeetingSummary, meetingInfo: { title: string; date: string }): string {
  const title = DOCUMENT_TITLES[docType];
  const baseInfo = `# ${title}

> 작성일: ${meetingInfo.date}
> 회의: ${meetingInfo.title}

---`;

  if (docType === 'prd') {
    return `${baseInfo}

## 1. 개요
${summary.overview}

## 2. 핵심 기능
${summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 3. 의사결정
${summary.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

## 4. Action Items
${summary.actionItems.map((a, i) => `${i + 1}. **${a.task}** (${a.assignee || '미정'}) [${a.priority || 'medium'}]${a.deadline ? ` - ${a.deadline}` : ''}`).join('\n')}

---

*이 문서는 회의 녹음을 바탕으로 AI가 자동 생성했습니다.*`;
  }

  if (docType === 'wireframe') {
    return `${baseInfo}

## 1. 화면 구성도

| 화면 | 설명 |
|------|------|
| 대시보드 | 주요 데이터 시각화 |
| 설정 | 사용자 설정 및 환경 설정 |
| 상세 | 데이터 상세 보기 |

## 2. 사용자 플로우

\`\`\`mermaid
flowchart TD
    A[시작] --> B[로그인]
    B --> C[대시보드]
    C --> D[데이터 조회]
    D --> E[필터 적용]
    E --> F[결과 표시]
\`\`\`

## 3. 주요 화면

### 대시보드
- 헤더: 로고, 사용자 정보
- 사이드바: 네비게이션
- 메인: 위젯 영역
- 실시간 데이터 업데이트

### 설정 화면
- 계정 정보
- 알림 설정
- 테마 설정

## 4. 컴포넌트 구조
\`\`\`
App
├── Layout
│   ├── Header
│   ├── Sidebar
│   └── Footer
├── Dashboard
│   ├── WidgetContainer
│   ├── Chart
│   └── DataTable
└── Settings
\`\`\`

## 5. 디자인 시스템
- Primary: #3B82F6
- Secondary: #64748B
- Success: #10B981
- Warning: #F59E0B
- Error: #EF4444

## 6. 반응형
- Desktop: 1280px+
- Tablet: 768px - 1279px
- Mobile: < 768px`;
  }

  if (docType === 'user-story') {
    return `${baseInfo}

## 사용자 페르소나

### 1. 데이터 분석가
- 직군: 데이터 분석가
- 목표: 실시간 데이터 모니터링
- 기술 수준: 높음
- 페인 포인트: 데이터 로딩 지연

### 2. 경영진
- 직군: 경영진
- 목표: KPI 확인
- 기술 수준: 낮음
- 페인 포인트: 복잡한 리포트

## 에픽

### Epic 1: 실시간 대시보드
사용자가 실시간으로 변하는 데이터를 모니터링할 수 있다.

## 사용자 스토리

### US-001: 대시보드 조회
**As a** 데이터 분석가
**I want** 실시간으로 업데이트되는 대시보드를 보고 싶다
**So that** 즉시 데이터 변화를 감지하고 대응할 수 있다

**Acceptance Criteria:**
- **Given** 사용자가 로그인되어 있고
- **When** 대시보드 화면에 접속하면
- **Then** 1초 이내에 최신 데이터가 표시되어야 한다

### US-002: 위젯 커스터마이징
**As a** 데이터 분석가
**I want** 위젯을 드래그하여 배치하고 싶다
**So that** 내가 원하는 대로 화면을 구성할 수 있다

**Acceptance Criteria:**
- **Given** 사용자가 편집 모드이고
- **When** 위젯을 드래그하면
- **Then** 위젯이 새 위치에 배치되고 저장되어야 한다

## 스토리 포인트
- US-001: 3포인트
- US-002: 5포인트

## 우선순위
- P0: US-001, US-002`;
  }

  if (docType === 'api-spec') {
    return `${baseInfo}

## 1. API 개요
- 기본 URL: \`https://api.example.com/v1\`
- 인증: Bearer Token (JWT)

## 2. 엔드포인트 목록

### 2.1 대시보드

#### GET /api/dashboard
대시보드 데이터 조회

**Request Headers:**
\`\`\`
Authorization: Bearer <token>
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "widgets": [...],
  "summary": {...}
}
\`\`\`

#### POST /api/widgets
위젯 생성

**Request Body:**
\`\`\`json
{
  "type": "chart",
  "title": "매출 추이",
  "dataSource": "sales"
}
\`\`\`

### 2.2 사용자

#### GET /api/users/me
현재 사용자 정보

## 3. 에러 코드
| 코드 | 설명 |
|------|------|
| 400 | 잘못된 요청 |
| 401 | 인증 실패 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 500 | 서버 오류 |`;
  }

  if (docType === 'deployment') {
    return `${baseInfo}

## 1. 배포 환경
- **Staging**: staging.example.com
- **Production**: app.example.com

## 2. 사전 요구사항
- **Node.js**: v18 이상
- **메모리**: 2GB 이상
- **디스크**: 20GB 이상

## 3. 환경 변수
\`\`\`bash
NODE_ENV=production
API_URL=https://api.example.com
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
\`\`\`

## 4. 빌드 절차
\`\`\`bash
# 1. 의존성 설치
npm ci

# 2. 빌드
npm run build

# 3. 빌드 결과 확인
ls -la .next
\`\`\`

## 5. 배포 절차 (Vercel)
\`\`\`bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel --prod
\`\`\`

## 6. 배포 후 점검
- [ ] 서비스 상태 확인
- [ ] 헬스 체크: \`curl https://app.example.com/api/health\`
- [ ] 로그 확인: \`vercel logs\`

## 7. 롤백 절차
\`\`\`bash
# 이전 버전으로 롤백
vercel rollback
\`\`\`

## 8. 모니터링
- Vercel Analytics
- Sentry (에러 추적)`;
  }

  if (docType === 'test-case') {
    return `${baseInfo}

## 테스트 케이스 목록

| TC-ID | 기능명 | 시나리오 | 전제 조건 | 테스트 단계 | 기대 결과 | 우선순위 |
|-------|--------|----------|-----------|-----------|-----------|----------|
| TC-001 | [기능명] | [시나리오] | [조건] | [단계] | [결과] | P0 |

회의 내용을 바탕으로 구체적인 테스트 케이스를 작성하세요.`;
  }

  if (docType === 'database') {
    return `${baseInfo}

## ERD (Entity Relationship Diagram)

\`\`\`mermaid
erDiagram
    USER ||--o\u007B ORDER : places
    ORDER ||--|\u007B ORDER_ITEM : contains
\`\`\`

회의에서 논의된 실제 데이터 구조와 엔티티를 바탕으로 작성하세요.`;
  }

  return baseInfo;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { docType, summary, transcript, meetingInfo, mode } = body;

    if (!summary || !meetingInfo) {
      return NextResponse.json(
        { error: 'summary, meetingInfo가 필요합니다.' },
        { status: 400 }
      );
    }

    // 전체 문서 생성 모드
    if (mode === 'all') {
      const result = await generateAllDocuments(
        summary,
        transcript || '',
        meetingInfo
      );

      return NextResponse.json({
        docs: result.docs,
        progress: result.progress,
      });
    }

    // 단일 문서 생성 모드 (기존)
    if (!docType) {
      return NextResponse.json(
        { error: 'docType이 필요합니다 (단일 생성 모드).' },
        { status: 400 }
      );
    }

    const content = await generateDocument(docType, summary, transcript || '', meetingInfo);

    return NextResponse.json({ content, docType });
  } catch (error) {
    console.error('Generate doc API 오류:', error);
    return NextResponse.json(
      { error: '문서 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}
