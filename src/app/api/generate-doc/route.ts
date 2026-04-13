import { NextRequest, NextResponse } from 'next/server';
import type { MeetingSummary } from '@/types';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// OpenAI 클라이언트 초기화 함수 (빌드 시 실행 방지)
function createOpenAIClient() {
  const API_BASE = process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4';
  const API_KEY = process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!API_KEY) {
    throw new Error('API_KEY가 필요합니다. ZAI_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
  }

  return new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE,
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
  | 'test-plan'
  | 'deployment';

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
  'test-plan': '테스트 계획서',
  deployment: '배포 가이드',
};

async function generateDocument(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string }
): Promise<string> {
  const prompt = getPromptForDocType(docType, summary, transcript, meetingInfo) ||
                 `회의 내용을 바탕으로 ${docType} 문서를 작성해주세요.\n\n${transcript}`;

  try {
    const openai = createOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'glm-5',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 16384,
    });

    // 코딩 플랜 추론 모델은 content 또는 reasoning_content를 확인
    const message = response.choices[0]?.message as any;
    const content = message?.content || message?.reasoning_content || '';

    return content;
  } catch (error) {
    console.error('코딩 플랜 API 오류:', error);
    return getMockDoc(docType, summary, meetingInfo);
  }
}

function getPromptForDocType(
  docType: DocType,
  summary: MeetingSummary,
  transcript: string,
  meetingInfo: { title: string; date: string }
) {
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
    return `당신은 UI/UX 디자이너입니다. 다음 회의 내용을 바탕으로 **상세한 와이어프레임 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 화면, 기능, 요소들을 **추출**하여 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 내용을 바탕으로 구조화하세요.

### 1. 화면 구성도 (Screen Map)
회의에서 논의된 화면들을 표로 정리하세요:
| 화면ID | 화면명 | 목적 | 주요 기능 |

### 2. 사용자 플로우 (User Flow)
회의에서 논의된 주요 시나리오를 Mermaid flowchart로 표현하세요:
\`\`\`mermaid
flowchart TD
    A[시작] --> B[첫 번째 화면]
    ...
\`\`\`

### 3. 주요 화면 상세
각 화면별로 회의에서 언급된 요소들을 배치하세요:

#### 3.1 [화면명]
- **목적**: 화면의 용도
- **레이아웃**:
  - 헤더: (구체적 요소)
  - 본문: (구체적 요소)
  - 사이드바/풋터: (구체적 요소)
- **주요 요소**: 버튼, 입력폼, 카드 등
- **상태별 UI**: normal, hover, active, disabled, error, empty

### 4. 컴포넌트 명세
\`\`\`
App
├── Layout (Header, Sidebar, Footer)
├── [페이지1]
│   └── [컴포넌트들]
└── [페이지2]
\`\`\`

### 5. 디자인 시스템
- 색상: Primary, Secondary, Success, Warning, Error (구체적 hex 코드 추천)
- 타이포그래피: 제목, 본문, 캡션 (폰트 사이즈 포함)
- 간격: 4px, 8px, 16px, 24px, 32px 기준
- 라운드: sm(4px), md(8px), lg(12px)
- 그림자: elevation 단계별

### 6. 반응형 대응
- Desktop (1280px+)
- Tablet (768px - 1279px)
- Mobile (< 768px)

회의 내용을 바탕으로 구체적이고 실제 개발에 바로 사용할 수 있도록 작성하세요.`;
  }

  if (docType === 'user-story') {
    return `당신은 애자일 코치입니다. 다음 회의 내용을 바탕으로 **사용자 스토리 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 기능, 사용자 유형, 시나리오를 **추출**하여 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 내용을 바탕으로 구조화하세요.

### 1. 사용자 페르소나 정의
회의에서 언급된 타겟 사용자별로 정의:

#### 페르소나 1: [이름]
- **인구통계**: 연령, 성별, 직업
- **기술 수준**: 높음/중간/낮음
- **목표**: 사용자가 달성하고자 하는 것
- **페인 포인트**: 현재 겪고 있는 문제
- **동기**: 왜 이 서비스를 이용하는가

### 2. 에픽 (Epic)
회의에서 논의된 기능들을 그룹화하여 대규모 에픽으로 정의:

#### Epic 1: [에픽명]
- **설명**: 에픽의 목적과 범위
- **관련 스토리**: US-XXX, US-XXX

### 3. 사용자 스토리 (User Story)
각 기능별로 Given-When-Then 형식으로 작성:

#### US-001: [스토리명]
- **As a** [사용자 페르소나]
- **I want** [원하는 행동/기능]
- **So that** [얻고자 하는 가치/목적]
- **스토리 포인트**: 1, 2, 3, 5, 8, 13 중 하나
- **우선순위**: P0 / P1 / P2

**수용 조건 (Acceptance Criteria):**
- **Given** [전제 조건]
- **When** [행동]
- **Then** [기대 결과]
- **And** [추가 조건]

### 4. 스토리별 요약 표

| US ID | 스토리명 | 페르소나 | 포인트 | 우선순위 | 에픽 |
|-------|---------|---------|--------|----------|------|
| US-001 | [스토리명] | [페르소나] | 3 | P0 | Epic 1 |
| US-002 | [스토리명] | [페르소나] | 5 | P1 | Epic 1 |

### 5. 스토리 포인트 합계
- **Epic 1**: N포인트
- **전체 합계**: N포인트

### 6. 우선순위별 분류
- **P0 (MVP 필수)**: US-XXX, US-XXX
- **P1 (초기 릴리스)**: US-XXX, US-XXX
- **P2 (이후 릴리스)**: US-XXX, US-XXX

### 7. 사용자 시나리오 (User Journey)
주요 사용자 경로 단계별 매핑:
1. [단계1] → 2. [단계2] → 3. [단계3]`;
  }

  if (docType === 'api-spec') {
    return `당신은 백엔드 아키텍트입니다. 다음 회의 내용을 바탕으로 **API 명세서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 기능, 데이터, 엔티티를 **추출**하여 API를 설계하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 기능을 바탕으로 API를 구조화하세요.

### 1. API 개요
- **목적**: 회의에서 논의된 기능을 위한 API 설계
- **Base URL**: \`https://api.example.com/v1\`
- **인증 방식**: Bearer Token (JWT) / API Key / Session Cookie
- **데이터 포맷**: JSON

### 2. 엔드포인트 목록
회의에서 논의된 기능별로 엔드포인트 정의:

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/resources | 리소스 목록 조회 | O |
| POST | /api/resources | 리소스 생성 | O |
| GET | /api/resources/:id | 리소스 상세 조회 | O |
| PUT | /api/resources/:id | 리소스 수정 | O |
| DELETE | /api/resources/:id | 리소스 삭제 | O |

### 3. 상세 명세

#### 3.1 리소스 목록 조회
**GET** \`/api/resources\`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| page | number | X | 페이지 번호 (기본값: 1) |
| limit | number | X | 페이지 크기 (기본값: 20) |
| sort | string | X | 정렬 기준 |

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
\`\`\`

**Error Response:**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "잘못된 파라미터입니다"
  }
}
\`\`\`

#### 3.2 리소스 생성
**POST** \`/api/resources\`

**Request Body:**
\`\`\`json
{
  "name": "string",
  "description": "string",
  "options": {}
}
\`\`\`

**Response (201 Created):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "string",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
\`\`\`

### 4. 데이터 모델

#### Resource
\`\`\`typescript
interface Resource {
  id: string;        // UUID
  name: string;      // 이름
  description?: string; // 설명
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}
\`\`\`

### 5. 에러 코드
| 코드 | 설명 | 해결 방법 |
|------|------|----------|
| 400 | 잘못된 요청 | 파라미터 확인 |
| 401 | 인증 실패 | 토큰 갱신 |
| 403 | 권한 없음 | 권한 확인 |
| 404 | 리소스 없음 | 경로 확인 |
| 409 | 중복 데이터 | 이미 존재하는 데이터 확인 |
| 500 | 서버 오류 | 잠시 후 다시 시도 |

회의에서 논의된 실제 데이터 구조와 기능을 바탕으로 작성하세요.`;
  }

  if (docType === 'test-plan') {
    return `당신은 QA 리드입니다. 다음 회의 내용을 바탕으로 **테스트 계획서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 기능을 **추출**하여 테스트 시나리오를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 기능을 바탕으로 테스트를 설계하세요.

### 1. 테스트 개요
- **테스트 목표**: 회의에서 논의된 기능의 품질 보증
- **테스트 범위**: [논의된 기능 목록]
- **테스트 기간**: X주 (개발 기간의 30%)
- **테스트 리드**: [담당자]

### 2. 테스트 전략
| 테스트 유형 | 도구 | 담당자 | 비고 |
|-------------|------|---------|------|
| 단위 테스트 | Jest, Vitest | 개발자 | 커버리지 80% 목표 |
| 통합 테스트 | Supertest | 개발자 | API 연계 |
| E2E 테스트 | Playwright, Cypress | QA | 주요 시나리오 |
| 성능 테스트 | k6 | QA | 부하 테스트 |
| 보안 테스트 | OWASP ZAP | 보안 | 취약점 점검 |

### 3. 테스트 시나리오
회의에서 논의된 각 기능별 테스트 케이스:

| TC-ID | 기능 | 시나리오 | 전제 조건 | 테스트 단계 | 기대 결과 | 우선순위 |
|-------|------|----------|-----------|-----------|-----------|----------|
| TC-001 | [기능명] | [시나리오] | [조건] | [단계] | [결과] | P0 |

**TC-001 예시:**
- **기능**: 로그인
- **시나리오**: 정상적인 아이디/비밀번호로 로그인
- **전제 조건**: 회원가입 완료된 계정 존재
- **테스트 단계**:
  1. 로그인 페이지 접속
  2. 아이디/비밀번호 입력
  3. 로그인 버튼 클릭
- **기대 결과**: 메인 화면으로 이동, 사용자 정보 표시
- **우선순위**: P0

### 4. 단위 테스트 계획
- **컴포넌트 테스트**: UI 컴포넌트 별 테스트
- **비즈니스 로직 테스트**: 핵심 로직 테스트
- **커버리지 목표**: 80% 이상

### 5. 통합 테스트 계획
- **API 연계 테스트**: 프론트엔드 ↔ 백엔드
- **DB 연계 테스트**: 데이터 CRUD 정상 동작
- **외부 서비스 연계**: 결제, 알림 등

### 6. E2E 테스트 계획
주요 사용자 시나리오:
1. [시나리오 1]: 회원가입 → 로그인 → 첫 이용
2. [시나리오 2]: [회의에서 논의된 주요 흐름]

### 7. 성능 테스트
- **응답 시간 목표**: API < 200ms (p95)
- **동시 사용자**: 1000명 동시 접속
- **부하 테스트**: 1분간 100 req/s

### 8. 테스트 일정
| 단계 | 기간 | 담당자 | 비고 |
|------|------|--------|------|
| 테스트 계획 | 1주 | QA 리드 | |
| 테스트 케이스 작성 | 1주 | QA | |
| 단위/통합 테스트 | 개발 병행 | 개발자 | |
| E2E 테스트 | 1주 | QA | |
| 성능 테스트 | 3일 | QA | |

### 9. 입수 기준 (Definition of Done)
- [ ] 모든 P0 테스트 케이스 통과
- [ ] 버그 0개 (P0, P1)
- [ ] 커버리지 80% 이상
- [ ] 성능 기준 충족
- [ ] 보안 점검 완료`;
  }

  if (docType === 'deployment') {
    return `당신은 DevOps 엔지니어입니다. 다음 회의 내용을 바탕으로 **배포 가이드**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 논의된 기술 스택, 인프라, 환경을 **반영**하여 작성하세요.

### 1. 배포 개요
- **프로젝트**: ${meetingInfo.title}
- **배포 환경**:
  - **Development**: 로컬 개발 환경
  - **Staging**: 사전 테스트 환경 (staging.example.com)
  - **Production**: 운영 환경 (app.example.com)
- **배포 전략**: Blue-Green 배포 (무중단 배포)
- **배포 주기**: 주 1회 정기 배포 (핫픽스 제외)

### 2. 사전 요구사항

#### 서버 사양
| 환경 | CPU | 메모리 | 디스크 | 비고 |
|------|-----|--------|--------|------|
| Staging | 2 Core | 4GB | 40GB | 테스트용 |
| Production | 4 Core | 8GB | 100GB | 운영용 |

#### 소프트웨어 요구사항
- **Node.js**: v18 이상
- **npm**: v9 이상
- **Git**: 버전 관리

#### 외부 서비스
- **데이터베이스**: PostgreSQL / MongoDB (회의 내용 반영)
- **CDN**: Cloudflare / AWS CloudFront
- **Storage**: AWS S3 / Firebase Storage

#### 환경 변수 목록
\`\`\`bash
# API
API_URL=https://api.example.com
API_KEY=your-api-key

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Auth
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx

# 외부 서비스
AWS_S3_BUCKET=your-bucket
AWS_ACCESS_KEY=xxx
AWS_SECRET_KEY=xxx
\`\`\`

### 3. 빌드 절차
\`\`\`bash
# 1. 최신 코드 가져오기
git pull origin main

# 2. 의존성 설치
npm ci

# 3. 환경 변수 설정
cp .env.example .env.production
# .env.production에 실제 값 입력

# 4. 타입 체크
npm run type-check

# 5. 테스트
npm run test

# 6. 빌드
npm run build

# 7. 빌드 결과 확인
ls -la .next
\`\`\`

### 4. 배포 절차

#### Vercel 배포 (권장)
\`\`\`bash
# Vercel CLI 설치
npm i -g vercel

# 프로젝트 연결
vercel link

# Staging 배포
vercel

# Production 배포
vercel --prod
\`\`\`

### 5. 배포 후 점검 Checklist
- [ ] 서비스 상태 확인 (\`curl https://app.example.com/api/health\`)
- [ ] 헬스 체크 API 정상 응답
- [ ] 주요 기능 동작 테스트
- [ ] 로그 확인 (에러 없는지)
- [ ] 모니터링 대시보드 확인
- [ ] 알림 설정 동작 확인

### 6. 롤백 절차
\`\`\`bash
# Vercel 롤백
vercel rollback

# 이전 버전 지정
vercel rollback <deployment-url>
\`\`\`

### 7. 모니터링

#### 모니터링 항목
- **서버**: CPU, 메모리, 디스크 사용량
- **애플리케이션**: 응답 시간, 에러율, 트래픽
- **비즈니스**: DAU, PV, 전환율

#### 알림 조건
- **Critical**: 서버 다운, 에러율 5% 이상
- **Warning**: 응답 시간 2초 이상, 디스크 80% 이상

### 8. 유지보수
- **정기 점검**: 월 1회 (로그, 성능, 보안)
- **백업**: 매일 새벽 2시간 (DB 전체 백업)
- **보안 패치**: 취약점 발견 시 즉시 적용`;
  }

  if (docType === 'feature-list') {
    return `당신은 기획자입니다. 다음 회의 내용을 바탕으로 **기능 목록 정의서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 기능들을 **추출**하여 구조화하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 기능을 바탕으로 작성하세요.

### 1. 기능 개요
- **총 기능 수**: N개
- **기능 분류**: 회원, 커뮤니티, 콘텐츠, 관리자 등

### 2. 기능 목록 (기능 ID: 기능명)

| 기능 ID | 기능명 | 카테고리 | 우선순위 | 설명 |
|---------|--------|----------|----------|------|
| F-001 | [기능명] | [카테고리] | P0 | [간단 설명] |

### 3. 상세 기능 명세

#### F-001: [기능명]
- **카테고리**: 회원 / 커뮤니티 / 콘텐츠 / 관리자 / 기타
- **우선순위**: P0 (MVP 필수) / P1 (중요) / P2 (추가)
- **설명**: 기능의 목적과 제공하는 가치
- **주요 기능**:
  - 세부 기능 1
  - 세부 기능 2
- **연관 기능**: F-002, F-003
- **전제 조건**: 선행되어야 할 기능
- **비고**: 특이사항

### 4. 기능별 화면 연계
| 기능 ID | 관련 화면 | 설명 |
|---------|-----------|------|
| F-001 | 로그인, 회원가입 | 회원 관련 |

회의에서 논의된 기능들을 빠짐없이 추출하여 목록화하세요.`;
  }

  if (docType === 'screen-list') {
    return `당신은 UI/UX 기획자입니다. 다음 회의 내용을 바탕으로 **화면 목록 정의서(페이지별 상세 기획안)**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 화면들을 **추출**하여 페이지별 상세 기획안을 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 화면을 바탕으로 작성하세요.

### 1. 화면 개요
- **총 화면 수**: N개
- **화면 분류**: 메인, 회원, 커뮤니티, 마이페이지, 관리자 등

### 2. 화면 목록

| 화면 ID | 화면명 | 경로 | 비고 |
|---------|--------|------|------|
| S-001 | [화면명] | /path | 설명 |

### 3. 화면별 상세 기획

#### S-001: [화면명]
- **경로**: /path/to/page
- **화면 목적**: 이 화면을 통해 사용자가 무엇을 할 수 있는가
- **접근 권한**: 비회원 / 회원 / 관리자
- **레이아웃 구성**:
  - 헤더: (구체적 요소)
  - 네비게이션: (구체적 요소)
  - 본문: (구체적 요소)
  - 사이드바: (구체적 요소)
  - 풋터: (구체적 요소)

- **주요 영역**:
  1. **영역1**: 설명
  2. **영역2**: 설명

- **UI 요소**:
  - 버튼: [버튼명] - 동작 설명
  - 입력폼: [필드명] - 설명
  - 리스트: [항목] - 설명
  - 카드/박스: [내용] - 설명

- **인터랙션**:
  - 클릭: [동작]
  - 드래그: [동작]
  - 스크롤: [동작]

- **상태별 UI**:
  - 초기 상태:
  - 로딩 중:
  - 데이터 있음:
  - 데이터 없음:
  - 에러 상태:

- **연관 화면**: S-002, S-003
- **관련 기능**: F-001, F-002

### 4. 네비게이션 구조
\`\`\`mermaid
graph TD
    A[홈] --> B[화면1]
    A --> C[화면2]
    B --> D[화면3]
    C --> D
\`\`\`

### 5. 공통 컴포넌트 목록
- **헤더**: 전역 사용
- **네비게이션**: 전역 사용
- **풋터**: 전역 사용
- **모달**: 공통
- **토스트**: 공통

회의에서 논의된 화면들을 빠짐없이 추출하여 상세히 기획하세요.`;
  }

  if (docType === 'ia') {
    return `당신은 IA(정보구조) 전문가입니다. 다음 회의 내용을 바탕으로 **정보구조도 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 정보 구조를 **추출**하여 IA를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 구조를 바탕으로 작성하세요.

### 1. 정보구조 개요
- **깊이**: 최대 N단계
- **넓이**: 상위 카테고리 N개
- **구조 원칙**: 사용자 중심, 직관적 탐색

### 2. 사이트맵 (전체 구조)

#### Level 1 (최상위)
- 홈
- 카테고리1
- 카테고리2
- 마이페이지
- 고객센터

#### Level 2
각 카테고리별 하위 구조:

**카테고리1**
- 서브메뉴 1-1
- 서브메뉴 1-2
- 서브메뉴 1-3

#### Level 3
필요시 3단계 구조

### 3. 정보구조 다이어그램 (Mermaid)

\`\`\`mermaid
graph TD
    Root[홈] --> Cat1[카테고리1]
    Root --> Cat2[카테고리2]
    Root --> Mypage[마이페이지]

    Cat1 --> Sub1[서브메뉴1]
    Cat1 --> Sub2[서브메뉴2]

    Mypage --> Profile[프로필]
    Mypage --> History[이용내역]
    Mypage --> Settings[설정]
\`\`\`

### 4. 사용자 시나리오별 경로

#### 시나리오 1: [시나리오명]
1. 홈 → 카테고리1 → 상세페이지 → 장바구니 → 결제
2. 흐름에 대한 설명

### 5. 메뉴 구성

| 메뉴명 | 경로 | 하위 메뉴 수 | 비고 |
|--------|------|--------------|------|
| 홈 | / | - | |
| 카테고리1 | /cat1 | 3개 | |
| 마이페이지 | /mypage | 3개 | 회원 전용 |

### 6. 템플릿 구조

#### 메인 레이아웃
- 헤더 (GNB)
- 풋터
- 사이드바 (있는 경우)

#### 서브 레이아웃
- 로컬 네비게이션
- 브래드크럼
- 페이지 타이틀

### 7. 라벨링 가이드라인
- **카테고리명**: 명확하고 직관적인 용어 사용
- **버튼 텍스트**: 행동을 유도하는 동사 사용
- **에러 메시지**: 친절하고 해결책 제시

회의에서 논의된 정보 구조를 바탕으로 작성하세요.`;
  }

  if (docType === 'flowchart') {
    return `당신은 프로세스 설계 전문가입니다. 다음 회의 내용을 바탕으로 **사용자 플로우차트 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 사용자 플로우와 프로세스를 **추출**하여 플로우차트를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 흐름을 바탕으로 작성하세요.

### 1. 플로우차트 개요
- **목적**: 사용자 경로 및 시스템 프로세스 시각화
- **대상**: [주요 사용자 플로우]

### 2. 주요 사용자 플로우

#### 플로우 1: [플로우명]
- **설명**: 사용자가 [목표]를 달성하기 위한 과정
- **시작 조건**: [전제 조건]
- **종료 조건**: [완료 조건]

**Mermaid 플로우차트:**
\`\`\`mermaid
flowchart TD
    Start([시작]) --> A[사용자 액션]
    A --> B{조건 분기}
    B -->|예| C[경로1]
    B -->|아니오| D[경로2]
    C --> E([종료])
    D --> E
\`\`\`

**상세 설명:**
1. **시작**: [설명]
2. **사용자 액션**: [설명]
3. **조건 분기**: [설명]
4. **경로1**: [설명]
5. **경로2**: [설명]
6. **종료**: [설명]

### 3. 예외 플로우

#### 예외 1: [예외 상황]
- **발생 조건**: [언제 발생하는가]
- **처리 방안**: [어떻게 처리하는가]

\`\`\`mermaid
flowchart TD
    A[정상 플로우] --> B{에러 발생}
    B -->|에러| C[에러 메시지 표시]
    C --> D[이전 단계로]
    B -->|정상| E[다음 단계로]
\`\`\`

### 4. 시스템 간 연계 플로우

#### 연계 1: [시스템명]
- **관련 시스템**: [프론트엔드 ↔ 백엔드 ↔ 외부 API]

\`\`\`mermaid
flowchart LR
    User[사용자] --> Frontend[프론트엔드]
    Frontend --> API[백엔드 API]
    API --> DB[(데이터베이스)]
    API --> External[외부 서비스]
    DB --> API
    External --> API
    API --> Frontend
    Frontend --> User
\`\`\`

### 5. 플로우별 요구사항

| 플로우 ID | 플로우명 | 관련 화면 | 우선순위 | 비고 |
|----------|---------|-----------|----------|------|
| FC-001 | [플로우명] | S-001, S-002 | P0 | 필수 |

### 6. 플로우차트 작성 규칙
- **노드 타입**:
  - (둥근 사각형): 시작/종료
  - [사각형]: 프로세스/액션
  - {다이아몬드}: 조건 분기
  - (평행사변형): 입출력
  - (데이터베이스): 데이터 저장
- **화살표 라벨**: 조건을 명확히 표시
- **색상 구분**: 정상(파랑), 에러(빨강), 경고(노랑)

회의에서 논의된 플로우를 빠짐없이 추출하여 작성하세요.`;
  }

  if (docType === 'storyboard') {
    return `당신은 UX 디자이너입니다. 다음 회의 내용을 바탕으로 **스토리보드**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 사용자 시나리오를 **추출**하여 스토리보드를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 시나리오를 바탕으로 작성하세요.

### 1. 스토리보드 개요
- **목적**: 사용자 경험 매핑
- **대상 시나리오**: [주요 시나리오명]

### 2. 시나리오별 스토리보드

#### 시나리오 1: [시나리오명]
- **페르소나**: [타겟 사용자]
- **목표**: 사용자가 달성하고자 하는 것
- **시작 조건**: [전제 조건]

**스토리보드 (화면 순서):**

| 단계 | 화면명 | 설명 | UI 요소 | 사용자 행동 | 시스템 응답 |
|------|--------|------|---------|-------------|-------------|
| 1 | [화면] | 진입 시 | [요소] | [행동] | [응답] |
| 2 | [화면] | 상세 보기 | [요소] | [행동] | [응답] |
| 3 | [화면] | 완료 | [요소] | [행동] | [응답] |

**상세 흐름:**

1. **[단계1] - [화면명]**
   - **상황**: 사용자가 처음 접하는 상황
   - **UI**: 화면에 표시되는 주요 요소
   - **행동**: 사용자가 취하는 행동
   - **결과**: 행동 후 결과

2. **[단계2] - [화면명]**
   - **상황**:
   - **UI**:
   - **행동**:
   - **결과**:

### 3. 주요 사용자 경로

#### 경로 1: [경로명]
[화면] → [화면] → [화면]

**상세 설명:**
- 각 단계에서 사용자의 목적과 행동을 기술

### 4. 예외 상황 처리

#### 에러 상황
| 상황 | 화면 | 메시지 | 대응 |
|------|------|--------|------|
| 로그인 실패 | 로그인 | 아이디/비밀번호 확인 | 재시도 유도 |

### 5. 와이어프레임 참조
- 관련 화면: 와이어프레임 문서의 S-XXX 참조
- 관련 기능: 기능 목록의 F-XXX 참조

회의에서 논의된 시나리오를 바탕으로 작성하세요.`;
  }

  if (docType === 'wbs') {
    return `당신은 프로젝트 관리자입니다. 다음 회의 내용을 바탕으로 **WBS(Work Breakdown Structure)**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 작업들을 **추출**하여 WBS를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 작업을 바탕으로 작성하세요.

### 1. 프로젝트 개요
- **프로젝트명**: ${meetingInfo.title}
- **시작일**: [예정일]
- **종료일**: [예정일]
- **총 기간**: X주
- **팀 구성**: [역할별 인원]

### 2. 작업 분류 구조 (WBS)

#### Level 1: 단계
1. 기획
2. 디자인
3. 개발
4. 테스트
5. 배포

#### Level 2: 주요 작업

**1. 기획**
- 1.1 요구사항 분석
- 1.2 기획서 작성
- 1.3 디자인 가이드 작성

**2. 디자인**
- 2.1 UI/UX 디자인
- 2.2 와이어프레임 작성
- 2.3 프로토타입 제작

**3. 개발**
- 3.1 프론트엔드 개발
- 3.2 백엔드 개발
- 3.3 DB 설계
- 3.4 API 개발

**4. 테스트**
- 4.1 단위 테스트
- 4.2 통합 테스트
- 4.3 사용자 테스트

**5. 배포**
- 5.1 스테이징 배포
- 5.2 프로덕션 배포

### 3. 상세 작업 목록

| WBS ID | 작업명 | 담당자 | 기간 | 시작일 | 종료일 | 선행 작업 | 비고 |
|--------|--------|--------|------|--------|--------|-----------|------|
| 1.1 | 요구사항 분석 | 김기획 | 1주 | D-1 | D-5 | - | |
| 1.2 | 기획서 작성 | 김기획 | 2주 | D-6 | D-12 | 1.1 | |
| 2.1 | UI/UX 디자인 | 박디자인 | 2주 | D-6 | D-12 | 1.2 | 병행 |
| 3.1 | 프론트엔드 개발 | 이개발 | 3주 | D-13 | D-26 | 2.1 | |
| 3.2 | 백엔드 개발 | 이개발 | 3주 | D-13 | D-26 | 1.2 | |

### 4. 마일스톤

| 마일스톤 | 날짜 | 완료 조건 | 비고 |
|----------|------|-----------|------|
| 기획 완료 | D-X | 기획서 승인 | |
| 디자인 완료 | D-X | 디자인 시안 확정 | |
| 개발 완료 | D-X | 기능 구현 완료 | |
| 테스트 완료 | D-X | P0 버그 0 | |
| 정식 릴리스 | D-X | 프로덕션 배포 | |

### 5. Gantt Chart 개요

\`\`\`mermaid
gantt
    title 프로젝트 일정
    dateFormat YYYY-MM-DD
    section 기획
    요구사항 분석    :a1, 2024-01-01, 5d
    기획서 작성      :a2, after a1, 7d
    section 디자인
    UI/UX 디자인     :b1, after a2, 10d
    section 개발
    프론트엔드       :c1, after b1, 15d
    백엔드          :c2, after a2, 15d
    section 테스트
    통합 테스트      :d1, after c1, 7d
\`\`\`

### 6. 리스크 관리

| 리스크 | 영향 | 대응 방안 | 담당자 |
|--------|------|----------|--------|
| 일정 지연 | 높음 | 우선순위 조정, 인력 추가 | PM |
| 요구 변경 | 중간 | 변경 절차 확립, 범위 관리 | PM |

회의에서 논의된 작업들을 바탕으로 WBS를 작성하세요.`;
  }

  // Default: PRD
  if (docType === 'prd') {
    return `당신은 시니어 기획자입니다. 다음 회의 내용을 바탕으로 **상세한 PRD**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 비즈니스, 사용자, 기능을 **추출**하여 구조화하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 내용을 바탕으로 작성하세요.

## PRD 구조

### 1. 문서 정보
- **PRD 버전**: v1.0
- **작성일**: ${meetingInfo.date}
- **작성자**: [작성자]
- **검토자**: [검토자]
- **변경 이력**:
  - v1.0: 초기 작성 (${meetingInfo.date})

### 2. 개요 (Executive Summary)

#### 2.1 프로젝트 배경 및 동기
회의에서 논의된 프로젝트 배경과 시작 동기를 상세히 기술하세요.

#### 2.2 비즈니스 문제 정의
현재 해결하려는 비즈니스 문제를 명확히 정의하세요.

#### 2.3 해결 방안 개요
제품/서비스를 통해 어떻게 문제를 해결할지 기술하세요.

#### 2.4 기대 효과 및 성공 지표 (KPI)
| 지표 | 현재 | 목표 | 측정 시점 |
|------|------|------|----------|
| 사용자 수 | - | X명 | X개월 후 |
| 전환율 | - | X% | X개월 후 |

### 3. 문제 정의 (Problem Statement)

#### 3.1 현재 문제 상황
사용자가 현재 겪고 있는 구체적인 문제를 기술하세요.

#### 3.2 사용자 페인 포인트
- **페인 포인트 1**: [구체적 내용]
- **페인 포인트 2**: [구체적 내용]

#### 3.3 시장 분석 및 경쟁사 현황
유사 제품/서비스와의 차별점을 기술하세요.

### 4. 목표 (Goals)

#### 4.1 비즈니스 목표
- 목표 1: [구체적 목표]
- 목표 2: [구체적 목표]

#### 4.2 사용자 경험 목표
- 목표 1: [구체적 목표]
- 목표 2: [구체적 목표]

#### 4.3 기술적 목표
- 목표 1: [구체적 목표]
- 목표 2: [구체적 목표]

#### 4.4 성공 지표 (SMART)
| 지표 | 구체적(S) | 측정가능(M) | 달성가능(A) | 관련성(R) | 시한(T) |
|------|-----------|-------------|-------------|-----------|---------|

### 5. 타겟 사용자 (Target Audience)

#### 5.1 사용자 페르소나

#### 페르소나 1: [이름]
- **인구통계**: 연령, 성별, 직업, 지역
- **기술 수준**: 높음/중간/낮음
- **목표**: 사용자가 달성하고자 하는 것
- **페인 포인트**: 현재 겪는 문제
- **동기**: 왜 이 서비스를 이용하는가

#### 5.2 사용자 시나리오 (User Journey)
1. [단계1] → 2. [단계2] → 3. [단계3]

### 6. 기능 요구사항 (Functional Requirements)

#### 6.1 핵심 기능 (Must-Have) - P0
회의에서 논의된 필수 기능을 상세히 기술하세요:

**기능 1: [기능명]**
- **설명**: 기능의 목적과 동작
- **상세 요구사항**:
  - 요구사항 1
  - 요구사항 2

#### 6.2 추가 기능 (Should-Have) - P1

#### 6.3 향후 기능 (Nice-to-Have) - P2

#### 6.4 비기능 요구사항
- **성능**: API 응답 시간 < 200ms (p95)
- **보안**: JWT 인증, HTTPS, 데이터 암호화
- **확장성**: 동시 사용자 1,000명 지원
- **호환성**: iOS 15+, Android 12+, Chrome 최신 버전

### 7. 기술 요구사항

#### 7.1 기술 스택 상세
| 영역 | 기술 | 사유 |
|------|------|------|
| 프론트엔드 | React, Next.js | SSR, SEO 최적화 |
| 백엔드 | Node.js, Express | 빠른 개발, 생태계 |
| 데이터베이스 | PostgreSQL | 안정성, ACID |
| 인프라 | Vercel, AWS | 무중단 배포 |

#### 7.2 아키텍처 다이어그램
\`\`\`mermaid
graph TD
    A[User] -->|HTTPS| B[Load Balancer]
    B --> C[Next.js Server]
    C -->|API Call| D[Node.js API]
    C -->|SSR| D
    D -->|Query| E[(PostgreSQL)]
    D -->|Upload| F[AWS S3]
\`\`\`

#### 7.3 데이터베이스 설계
주요 테이블과 관계를 기술하세요.

#### 7.4 API 설계
| Method | Path | 설명 |
|--------|------|------|
| GET | /api/resources | 목록 조회 |
| POST | /api/resources | 생성 |

### 8. UI/UX 가이드라인

#### 8.1 디자인 원칙
- **간결성**: 최소한의 클릭으로 목적 달성
- **일관성**: 전체 화면 동일한 패턴 사용
- **피드백**: 모든 동작에 즉시 피드백 제공

#### 8.2 와이어프레임 개요
주요 화면별 구성을 기술하세요.

### 9. 릴리스 계획
| 단계 | 버전 | 기능 | 기간 | 담당자 |
|------|------|------|------|--------|
| 1단계 | v0.1 | [핵심 기능] | X주 | - |
| 2단계 | v0.5 | [추가 기능] | X주 | - |
| 3단계 | v1.0 | [정식 릴리스] | X주 | - |

### 10. 리스크 및 대응
| 리스크 | 영향도 | 발생확률 | 대응 방안 | 담당자 |
|--------|--------|----------|----------|--------|
| [리스크 1] | 높음 | 중간 | [대응] | - |

### 11. 성공 기준
- [ ] P0 기능 100% 구현
- [ ] 성능 기준 충족
- [ ] 보안 점검 통과
- [ ] 베타 테스터 N명 만족도 80% 이상

### 12. 부록
- 참고 자료
- 관련 문서 링크`;
  }
}

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
- **스토리 포인트**: 3
- **우선순위**: P0

**Acceptance Criteria:**
- **Given** 사용자가 로그인되어 있고
- **When** 대시보드 화면에 접속하면
- **Then** 1초 이내에 최신 데이터가 표시되어야 한다

### US-002: 위젯 커스터마이징
**As a** 데이터 분석가
**I want** 위젯을 드래그하여 배치하고 싶다
**So that** 내가 원하는 대로 화면을 구성할 수 있다
- **스토리 포인트**: 5
- **우선순위**: P1

**Acceptance Criteria:**
- **Given** 사용자가 편집 모드이고
- **When** 위젯을 드래그하면
- **Then** 위젯이 새 위치에 배치되고 저장되어야 한다

## 스토리별 요약 표

| US ID | 스토리명 | 페르소나 | 포인트 | 우선순위 | 에픽 |
|-------|---------|---------|--------|----------|------|
| US-001 | 대시보드 조회 | 데이터 분석가 | 3 | P0 | Epic 1 |
| US-002 | 위젯 커스터마이징 | 데이터 분석가 | 5 | P1 | Epic 1 |

## 스토리 포인트 합계
- Epic 1: 8포인트
- 전체 합계: 8포인트

## 우선순위별 분류
- P0 (MVP 필수): US-001
- P1 (초기 릴리스): US-002`;
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

  if (docType === 'test-plan') {
    return `${baseInfo}

## 1. 테스트 개요
- 목적: 신규 대시보드 기능 품질 보증
- 범위: 전체 기능
- 기간: 4주

## 2. 테스트 시나리오

| TC-ID | 시나리오 | 전제 조건 | 테스트 단계 | 기대 결과 | 우선순위 |
|-------|----------|-----------|-----------|-----------|----------|
| TC-001 | 대시보드 접속 | 로그인 완료 | 대시보드 메뉴 클릭 | 대시보드 표시 | P0 |
| TC-002 | 위젯 드래그 | 위젯 2개 존재 | 위젯 드래그 이동 | 위치 변경됨 | P0 |
| TC-003 | 실시간 업데이트 | 웹소켓 연결 | 데이터 변경 | 1초 내 반영 | P0 |

## 3. 단위 테스트
- 컴포넌트별 테스트
- 커버리지 목표: 80%

## 4. 통합 테스트
- API 연계 테스트
- 데이터 흐름 테스트

## 5. E2E 테스트
- Cypress로 주요 시나리오 자동화

## 6. 입수 기준
- 모든 P0 테스트 케이스 통과
- 버그 0개
- 성능 기준 충족`;
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

  // 기본 응답 (처리되지 않은 문서 타입)
  return baseInfo + '\n\n## 원본 회의 내용\n\n위 회의 내용을 바탕으로 ' + docType + ' 문서를 작성해주세요.';
}

export async function POST(request: NextRequest) {
  try {
    const { docType, summary, transcript, meetingInfo } = await request.json();

    if (!docType || !summary || !meetingInfo) {
      return NextResponse.json(
        { error: 'docType, summary, meetingInfo가 필요합니다.' },
        { status: 400 }
      );
    }

    const content = await generateDocument(docType, summary, transcript || '', meetingInfo);

    return NextResponse.json({ content });
  } catch (error) {
    console.error('Generate doc API 오류:', error);
    return NextResponse.json(
      { error: '문서 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}
