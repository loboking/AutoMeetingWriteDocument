import { MeetingSummary } from '@/types';

interface SectionPromptParams {
  summary: MeetingSummary;
  transcript: string;
  meetingInfo: { title: string; date: string };
  previousSections?: Record<string, string>;
}

export interface SectionPrompt {
  getPrompt: (params: SectionPromptParams) => string;
  estimatedTokens: number;
}

// 공통 헤더
function getCommonHeader(meetingInfo: { title: string; date: string }, summary: MeetingSummary): string {
  return `## 회의 정보
- 제목: ${meetingInfo.title}
- 날짜: ${meetingInfo.date}

## 회의 요약
- 개요: ${summary.overview}
- 핵심 사항: ${summary.keyPoints.join(', ')}
- 의사결정: ${summary.decisions.join(', ')}

---
`;
}

// 섹션 1: 문서 정보
export const docInfoPrompt: SectionPrompt = {
  getPrompt: ({ meetingInfo }) => {
    return `
## 작성 가이드

다음 형식으로 문서 정보를 작성하세요:

### 1. 문서 정보
- **PRD 버전**: v1.0
- **작성일**: ${meetingInfo.date}
- **작성자**: 기획팀
- **검토자**: -
- **문서 상태**: 초안
- **변경 이력**:
  | 버전 | 날짜 | 변경 내용 | 작성자 |
  |------|------|----------|--------|
  | v1.0 | ${meetingInfo.date} | 초기 작성 | 기획팀 |

위 형식을 그대로 출력하세요. 추가 내용 없이 위 내용만 출력하세요.
`;
  },
  estimatedTokens: 200,
};

// 섹션 2: 개요 (Executive Summary)
export const overviewPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 2. 개요 (Executive Summary)

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

다음 4개 소섹션을 **매우 상세하게** 작성하세요:

### 2.1 프로젝트 배경 및 동기
**최소 3문단 이상 작성:**
- 프로젝트가 시작된 배경 (시장 상황, 회사 상황 등)
- 프로젝트의 필요성과 시급성
- 관련된 경영진의 의지나 전략적 방향성

### 2.2 비즈니스 문제 정의
**최소 2문단 이상 작성:**
- 현재 해결하려는 핵심 비즈니스 문제
- 문제가 발생하는 원인 분석
- 문제로 인한 비즈니스 영향(매출, 고객 이탈 등)

### 2.3 해결 방안 개요
**최소 2문단 이상 작성:**
- 제품/서비스를 통한 문제 해결 방법
- 기존 해결방안과의 차별점
- 핵심 가치 제안(Value Proposition)

### 2.4 기대 효과 및 성공 지표 (KPI)
**반드시 테이블 형식으로 작성:**
- **MAU 목표**: 10,000명 (첫해 기준)
- **전환율 목표**: 15%
- **측정 시점**: 1년 후

| 지표 분류 | 지표명 | 현재 | 목표 | 측정 시점 | 담당자 |
|-----------|--------|------|------|----------|--------|
| 비즈니스 | MAU | 0 | 10,000명 | 1년 후 | -
| 비즈니스 | 전환율 | - | 15% | 6개월 후 | -
| 비즈니스 | 운영 비용 절감 | - | 80% | 1년 후 | -
| 제품 | 기능 완료도 | 0% | 100% | 출시 시 | 개발팀 |
| 제품 | 버그률 | - | 1% 이하 | 출시 1개월 후 | QA팀 |

**중요**: 회의에서 언급된 구체적인 수치가 있다면 위 기본값을 대체하여 작성하세요.
`;
  },
  estimatedTokens: 4000,
};

// 섹션 3: 문제 정의
export const problemPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const overviewContext = previousSections?.['overview'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${overviewContext ? `## 이전 섹션 참고
${overviewContext}

---` : ''}

## 작성 섹션: 3. 문제 정의 (Problem Statement)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 3개 소섹션을 **매우 상세하게** 작성하세요:

### 3.1 현재 문제 상황
**최소 3문단 이상 작성:**
- 사용자가 겪고 있는 구체적인 문제 상황
- 문제 발생 빈도와 영향 범위
- 문제 해결의 시급성

### 3.2 사용자 페인 포인트
**반드시 5개 이상 작성:**

| 페인 포인트 ID | 페인 포인트명 | 심각도(H/M/L) | 발생 빈도 | 영향 대상 |
|----------------|--------------|---------------|-----------|-----------|
| PP-001 | [구체적 페인 포인트] | H | 항상 | 모든 사용자 |
| PP-002 | [구체적 페인 포인트] | M | 주간 | 신규 사용자 |

### 3.3 시장 분석 및 경쟁사 현황
**최소 2개 경쟁사 분석:**

| 경쟁사 | 강점 | 약점 | 우리의 차별점 |
|--------|------|------|---------------|
| A사 | - | - | - |
| B사 | - | - | - |
`;
  },
  estimatedTokens: 3000,
};

// 섹션 4: 목표
export const goalsPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const context = previousSections?.['overview'] || previousSections?.['problem'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## 이전 섹션 참고
${context}

---` : ''}

## 작성 섹션: 4. 목표 (Goals)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 3개 소섹션을 작성하세요:

### 4.1 비즈니스 목표
**최소 3개 이상 작성:**
- [ ] 목표 1 (구체적인 수치와 기한 포함)
- [ ] 목표 2
- [ ] 목표 3

### 4.2 사용자 목표
**최소 3개 이상 작성:**
- [ ] 사용자가 달성하고자 하는 목표 1
- [ ] 사용자가 달성하고자 하는 목표 2
- [ ] 사용자가 달성하고자 하는 목표 3

### 4.3 제품 목표
**최소 3개 이상 작성:**
- [ ] 제품이 달성해야 할 기술적 목표 1
- [ ] 제품이 달성해야 할 기술적 목표 2
- [ ] 제품이 달성해야 할 기술적 목표 3
`;
  },
  estimatedTokens: 2000,
};

// 섹션 5: 대상 사용자
export const targetUsersPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 5. 대상 사용자 (Target Users)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 2개 소섹션을 **매우 상세하게** 작성하세요:

### 5.1 사용자 페르소나
**최소 2개 이상 상세히 작성:**

**페르소나 1: [이름]**
- **연령**: 00대
- **직업/직군**:
- **기술 수준**: (초급/중급/고급)
- **목표**:
- **페인 포인트**:
- **행동 패턴**:
- **인용구**: "사용자의 실제 목소리"

| 페르소나 | 연령 | 직업 | 기술 수준 | 주요 목표 | 주요 페인 포인트 |
|---------|------|------|-----------|-----------|-----------------|
| [이름] | 00대 | [직업] | [수준] | [목표] | [페인 포인트] |
| [이름] | 00대 | [직업] | [수준] | [목표] | [페인 포인트] |

### 5.2 사용자 시나리오
**최소 2개 시나리오 작성:**

**시나리오 1: [시나리오명]**
- **배경**: 사용자가 처한 상황
- **행동**: 사용자가 취하는 행동
- **목표**: 사용자가 달성하고자 하는 것
- **결과**: 우리 제품을 통해 얻는 결과
`;
  },
  estimatedTokens: 3000,
};

// 섹션 6: 기능 요구사항
export const functionalReqPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const context = Object.values(previousSections || {}).join('\n\n');
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## 이전 섹션 참고
${context}

---` : ''}

## 작성 섹션: 6. 기능 요구사항 (Functional Requirements)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 논의된 모든 기능을 빠짐없이 추출하세요.

### 6.1 필수 기능 (Must-have, P0)
**최소 5개 이상 작성:**

| 기능 ID | 기능명 | 설명 | 우선순위 | 예상 개발 기간 |
|---------|--------|------|----------|----------------|
| F-001 | [기능명] | [상세 설명] | P0 | [기간] |
| F-002 | [기능명] | [상세 설명] | P0 | [기간] |

**F-001: [기능 상세 설명]**
- **기술적 세부사항**:
- **의존 기능**:
- **제약 사항**:

### 6.2 선택 기능 (Nice-to-have, P1-P2)
**최소 3개 이상 작성:**

| 기능 ID | 기능명 | 설명 | 우선순위 | 예상 개발 기간 |
|---------|--------|------|----------|----------------|
| F-101 | [기능명] | [상세 설명] | P1 | [기간] |
`;
  },
  estimatedTokens: 4000,
};

// 섹션 7: 비기능 요구사항
export const nonFunctionalReqPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 7. 비기능 요구사항 (Non-functional Requirements)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 3개 소섹션을 작성하세요:

### 7.1 성능 요구사항
**구체적인 수치 기준:**
- 페이지 로딩 시간: 2초 이내
- API 응답 시간: 200ms 이하 (p95)
- 동시 접속자 수: 1,000명 이상 지원
- 가용성: 99.9% (월간 다운타임 43분 이내)

### 7.2 보안 요구사항
**최소 5개 이상 작성:**
- [ ] 이메일 인증 기반 회원가입
- [ ] JWT 기반 인증/인가
- [ ] **세션 만료: 로그인 후 30분**
- [ ] HTTPS 통신 (TLS 1.3 이상)
- [ ] 민감 데이터 암호화 저장 (AES-256)
- [ ] SQL Injection, XSS 방지
- [ ] 월 1회 취약점 점검

### 7.3 호환성 요구사항
**구체적인 버전 명시:**
- **브라우저**: Chrome 90+, Safari 14+, Firefox 88+, Edge 90+
- **모바일**: iOS 14+, Android 10+
- **화면 크기**: Desktop (1920x1080), Tablet (768px), Mobile (375px)
`;
  },
  estimatedTokens: 2000,
};

// 섹션 8: UI/UX 가이드라인
export const uiUxPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const usersContext = previousSections?.['target-users'] || '';
    const funcContext = previousSections?.['functional-req'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${usersContext ? `## 대상 사용자 참고
${usersContext}

---` : ''}

${funcContext ? `## 기능 요구사항 참고
${funcContext}

---` : ''}

## 작성 섹션: 8. UI/UX 가이드라인

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 2개 소섹션을 작성하세요:

### 8.1 디자인 원칙
- **간결성**: 3번 클릭 내로 주요 기능 도달
- **일관성**: 전체 화면 동일한 패턴, 컴포넌트 재사용
- **피드백**: 모든 동작에 100ms 이내 시각/청각 피드백
- **접근성**: WCAG 2.1 AA 준수, 키보드 네비게이션 지원

### 8.2 주요 화면 구성
**회의에서 논의된 주요 화면을 최소 3개 이상 기술:**

**화면 1: [화면명]**
- **목적**: 사용자가 이 화면에서 하는 일
- **주요 요소**:
  - 헤더: [설명]
  - 본문: [설명]
  - 하단: [설명]
- **인터랙션**: [사용자 동작과 반응]

**화면 2: [화면명 - 예: 대시보드/관리 화면]**
- **목적**: SaaS의 경우 데이터 관리/모니터링
- **주요 요소**:
  - 통계 카드: 주요 지표 표시
  - 데이터 테이블: 목록/관리
  - 필터/검색: 데이터 조회
- **인터랙션**: 실시간 업데이트, 정렬, 페이지네이션
`;
  },
  estimatedTokens: 3000,
};

// 섹션 9: 기술 요구사항
export const technicalReqPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const funcContext = previousSections?.['functional-req'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${funcContext ? `## 기능 요구사항 참고
${funcContext}

---` : ''}

## 작성 섹션: 9. 기술 요구사항

## 원본 회의 내용
${transcript}

---

## 작성 가이드

다음 3개 소섹션을 **매우 상세하게** 작성하세요:

### 9.1 기술 스택
**구체적인 버전과 선택 이유 포함:**

| 분야 | 기술 | 버전 | 선택 이유 |
|------|------|------|-----------|
| 프론트엔드 | Next.js | 14+ | SSR, SEO 최적화 |
| 스타일 | Tailwind CSS | 3+ | 빠른 개발, 일관된 디자인 |
| 상태 관리 | Zustand | - | 가볍고 간단한 API |
| 백엔드 | Node.js | 18+ | - |
| 데이터베이스 | PostgreSQL | 14+ | 안정성, ACID 보장 |
| 배포 | Vercel | - | 간편한 CI/CD |

### 9.2 상세 아키텍처 설계
**최소 3문단 이상 작성:**
- **시스템 컴포넌트**: 각 컴포넌트의 역할과 책임
- **데이터 흐름**: 사용자 요청부터 응답까지의 전체 흐름
- **확장성 전략**: 수평 확장, 수직 확장 계획
- **기술적 선택 사유**: GPU가 필요한 영상 렌더링은 **로컬 워크스테이션에서 처리**하여 비용 절감, 나머지는 클라우드에서 처리

\`\`\`mermaid
graph TB
    subgraph "프론트엔드 / Frontend"
        A[웹 앱]
    end
    subgraph "로컬 워크스테이션 / Local Worker"
        LW[GPU 렌더링 엔진]
        LQ[Task Queue]
    end
    subgraph "API 게이트웨이 / API Gateway"
        C[인증/인가]
        D[로드 밸런싱]
    end
    subgraph "백엔드 서비스 / Backend Services"
        E[사용자 서비스]
        F[비즈니스 서비스]
        G[알림 서비스]
    end
    subgraph "데이터 계층 / Data Layer"
        H[(Primary DB)]
        I[(Cache/Queue)]
        J[(File Storage)]
    end
    subgraph "외부 서비스 / External Services"
        K[결제 gateway]
        L[이메일 서비스]
        M[Gemini API]
        N[ElevenLabs API]
    end

    A --> C
    C --> E
    C --> F
    E --> H
    F --> H
    F --> I
    F --> LQ
    LQ --> LW
    LW --> M
    LW --> N
    LW --> F
    G --> L
    F --> K
\`\`\`

**아키텍처 주의사항**:
- 영상 렌더링(GPU 작업)은 로컬 워크스테이션에서 비동기 Queue 방식으로 처리하여 **클라우드 GPU 비용을 0원**으로 절감
- 크롤링 및 API 통신은 클라우드 백엔드에서 처리
- 렌더링 완료 후 결과물을 S3/Cloud Storage에 업로드

### 9.3 데이터베이스 설계
**테이블별 구조를 작성:**

| 테이블명 | 주요 컬럼 | 관계 | 예상 데이터 수 | 백업 전략 |
|---------|-----------|------|---------------|-----------|
| users | id, email, password_hash, plan_type, created_at | 1:N | 10만건 | 일일 |
| subscriptions | id, user_id, plan_id, status, current_period_start, current_period_end | N:1 | 10만건 | 일일 |
| tasks | id, user_id, product_id, video_render_status, tiktok_upload_status, created_at | N:1 | 100만건 | 주간 |
| products | id, name, source_url, price, category, crawled_at | 1:N | 100만건 | 일일 |
`;
  },
  estimatedTokens: 5000,
};

// 섹션 10: 릴리스 계획
export const releasePlanPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const funcContext = previousSections?.['functional-req'] || '';
    const techContext = previousSections?.['technical-req'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${funcContext ? `## 기능 요구사항 참고
${funcContext}

---` : ''}

${techContext ? `## 기술 요구사항 참고
${techContext}

---` : ''}

## 작성 섹션: 10. 릴리스 계획

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 날짜와 기간**을 반드시 포함하세요.

### 10.1 상세 마일스톤
**회의에서 논의된 구체적 날짜/기간을 모두 포함 (연도: 2026년):**

| 단계 | 작업 항목 | 기간 | 시작일 | 종료일 | 담당자 | 선행 조건 | 산출물 |
|------|----------|------|--------|--------|--------|----------|--------|
| 1단계 | 기획 및 설계 | 4주 | 2026-06-01 | 2026-06-30 | 창업자 | - | PRD/설계서 |
| 2단계 | 개발 | 8주 | 2026-07-01 | 2026-08-31 | 창업자 | PRD 완료 | MVP |
| 3단계 | 베타 테스트 | 4주 | 2026-09-01 | 2026-09-30 | 창업자 | MVP 완료 | 수정사항 |
| 4단계 | 정식 출시 | 2주 | 2026-10-01 | 2026-10-15 | 창업자 | 베타 완료 | v1.0 |

**타임라인 시각화:**
\`\`\`mermaid
gantt
    title 프로젝트 타임라인 / Project Timeline
    dateFormat YYYY-MM-DD
    section 1단계 / Phase 1
    기획 및 설계      :a1, 2026-06-01, 4w
    section 2단계 / Phase 2
    개발             :b1, 2026-07-01, 8w
    section 3단계 / Phase 3
    베타 테스트        :c1, 2026-09-01, 4w
    section 4단계 / Phase 4
    정식 출시         :d1, 2026-10-01, 2w
\`\`\`

### 10.2 롤아웃 계획
**구체적인 일정 포함 (연도: 2026년):**
- **알파 테스트**: 2026-08-01 ~ 2026-08-15, 대상: 내부 10명
- **베타 테스트**: 2026-09-01 ~ 2026-09-30, 대상: 유료 고객 50명
- **소프트 런칭**: 2026-10-01, 대상: 베트남 시장
- **정식 릴리스**: 2026-10-15, 대상: 전체 사용자
`;
  },
  estimatedTokens: 4000,
};

// 섹션 11: 비용 및 리소스
export const costResourcesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 11. 비용 및 리소스 (Cost & Resources)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 비용 관련 정보**를 추출하세요.

### 11.1 개발 비용 산출
**1인 운영 기준, 로컬 GPU 활용으로 영상 합성비 0원:**

| 항목 | 단위 | 단가 | 수량 | 기간 | 총비용 | 비고 |
|------|------|------|------|------|--------|------|
| 인건비 | 인월 | - | - | - | **0원** | 1인 창업자 |
| 영상 렌더링 | 건당 | 0원 | 10,000건/월 | - | 0원 | 로컬 GPU 활용 |
| Gemini API | 건당 | 2.5원 | 10,000건/월 | - | 25,000원 | 번역/태깅 |
| ElevenLabs | 건당 | 40원 | 10,000건/월 | - | 400,000원 | 베트남어 성우 |
| 인프라 | 월 | - | - | - | 100,000원 | 서버/DB/CDN |
| **합계** | - | - | - | - | **525,000원/월** | -

**비고**: 월 10,000건 생성 기준 (하루 약 330건)

### 11.2 운영 비용 (월간)
**1인 운영 시 월간 고정 비용:**

| 항목 | 예상 월 비용 | 산출 근거 |
|------|-------------|-----------|
| 인프라 | 100,000원 | 서버, DB, CDN (초기 기준) |
| Gemini API | 25,000원 | 2.5원 × 10,000건 |
| ElevenLabs | 400,000원 | 40원 × 10,000건 |
| 기타 | - | 도메인, 이메일 (무료 활용) |
| **합계** | **525,000원/월** | 영상 렌더링 로컬 GPU로 0원 절감 |

### 11.3 리소스 계획
**1인 창업자 기준 마이크로 SaaS 운영:**

| 역할 | 인원 | 기간 | 참여율 | 주요 업무 |
|------|------|------|--------|-----------|
| 창업자/운영자 | 1명 | 전체 | 100% | 전체 개발/운영 |

**비고**: 창업자 1인이 전 과정을 전담하며, 필요시 UI 디자인/인프라 등 특정 태스크는 외주(N주) 활용 가능
`;
  },
  estimatedTokens: 3000,
};

// 섹션 12: SaaS 운영 요소 (선택사항)
export const saasOpsPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const funcContext = previousSections?.['functional-req'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${funcContext ? `## 기능 요구사항 참고
${funcContext}

---` : ''}

## 작성 섹션: 12. SaaS 운영 요소 (SaaS Operations)
*SaaS 서비스인 경우에만 작성하세요*

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 SaaS 관련 논의가 있었던 경우 작성하세요.

### 12.1 계정 및 권한 (Accounts & Permissions)

| 역할 | 권한 범위 | 기본 권한 | 제한 사항 |
|------|-----------|-----------|-----------|
| 관리자 | 전체 | CRUD 전체 | 없음 |
| 일반 사용자 | 본인 데이터 | CRUD 본인 | 삭제 불가 |
| 조회 권한 | 조회만 | Read | 수정/삭제 불가 |

### 12.2 과금 및 결제 (Billing & Payment)
**1인 셀러 타겟 현실적 요금제:**

| 플랜 | 가격 | 기능 | 결제 주기 | 할인 |
|------|------|------|----------|------|
| 무료 | 0원 | 월 50건 크롤링 | - | - |
| 베이직 | 39,000원/월 | 월 500건, 자동 생성 | 월간 | - |
| 프로 | 99,000원/월 | 무제한, API 연동 | 월간 | 연간 10% |

### 12.3 백오피스 기능 (Backoffice)
- [ ] 사용자 관리 (가입 승인, 정지, 탈퇴)
- [ ] 결제 관리 (환불, 영수증 발급)
- [ ] 통계 대시보드 (매출, 활성 사용자)
- [ ] 설정 관리 (공지사항, 약관)
- [ ] 로그 및 감사 (접속 기록, 변경 이력)

### 12.4 온보딩 (Onboarding)

| 단계 | 콘텐츠 | 형태 | 소요 시간 | 필수 여부 |
|------|--------|------|-----------|----------|
| 1단계 | 서비스 소개 | 인앱 투어 | 3분 | 필수 |
| 2단계 | 핵심 기능 사용법 | 비디오 | 5분 | 선택 |
| 3단계 | FAQ | 문서 | - | 선택 |

### 12.5 보안 및 컴플라이언스 (Security & Compliance)
- [ ] 이메일 인증 (가입 시)
- [ ] 2단계 인증 (선택/필수)
- [ ] 세션 만료 (로그인 후 30분)
- [ ] IP 제한 (관리자 접근)
- [ ] 개인정보 처리방침 동의
`;
  },
  estimatedTokens: 3000,
};

// 섹션 13: 리스크 및 대응
export const risksPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const overviewContext = previousSections?.['overview'] || '';
    const releaseContext = previousSections?.['release-plan'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${overviewContext ? `## 개요 참고
${overviewContext}

---` : ''}

${releaseContext ? `## 릴리스 계획 참고
${releaseContext}

---` : ''}

## 작성 섹션: 13. 리스크 및 대응

## 원본 회의 내용
${transcript}

---

## 작성 가이드

**최소 3개 이상 작성:**

| 리스크 ID | 리스크명 | 영향도(H/M/L) | 발생확률(H/M/L) | 대응 방안 | 담당자 |
|-----------|----------|---------------|-----------------|-----------|--------|
| R-001 | [구체적 리스크] | H | M | [구체적 대응] | - |
| R-002 | [구체적 리스크] | M | L | [구체적 대응] | - |
| R-003 | [구체적 리스크] | H | H | [구체적 대응] | - |
`;
  },
  estimatedTokens: 2000,
};

// 섹션 14: 성공 기준
export const successCriteriaPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const goalsContext = previousSections?.['goals'] || '';
    const releaseContext = previousSections?.['release-plan'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${goalsContext ? `## 목표 참고
${goalsContext}

---` : ''}

${releaseContext ? `## 릴리스 계획 참고
${releaseContext}

---` : ''}

## 작성 섹션: 14. 성공 기준 (Success Criteria)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

**최소 5개 이상 작성:**
- [ ] P0 필수 기능 100% 구현 및 테스트 통과
- [ ] 성능 기준 충족 (페이지 로딩 2초 이내)
- [ ] 보안 점검 통과 (취약점 0건)
- [ ] 베타 테스터 30명 만족도 80% 이상
- [ ] 버그 리포트 10건 미만 (P0/P1 기준)
- [ ] 일일 활성 사용자(DAU) 1,000명 달성 (출시 1개월 후)
`;
  },
  estimatedTokens: 1500,
};

// 섹션 15: 부록
export const appendixPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 15. 부록

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 15.1 용어 정리
| 용어 | 설명 |
|------|------|
| MAU | 월간 활성 사용자 수 (Monthly Active Users) |
| 전환율 | 방문자 중 가입/구매 등 전환한 비율 |

### 15.2 참고 자료
- 시장 조사 보고트: [링크 또는 요약]
- 경쟁사 분석: [링크 또는 요약]
- 기술 레퍼런스: [링크 또는 요약]
- **API 명세서 링크**: [TBD 또는 /docs/api]
`;
  },
  estimatedTokens: 1500,
};

// 섹션별 프롬프트 매핑
export const SECTION_PROMPTS: Record<string, SectionPrompt> = {
  'doc-info': docInfoPrompt,
  'overview': overviewPrompt,
  'problem': problemPrompt,
  'goals': goalsPrompt,
  'target-users': targetUsersPrompt,
  'functional-req': functionalReqPrompt,
  'non-functional-req': nonFunctionalReqPrompt,
  'ui-ux': uiUxPrompt,
  'technical-req': technicalReqPrompt,
  'release-plan': releasePlanPrompt,
  'cost-resources': costResourcesPrompt,
  'saas-ops': saasOpsPrompt,
  'risks': risksPrompt,
  'success-criteria': successCriteriaPrompt,
  'appendix': appendixPrompt,
};
