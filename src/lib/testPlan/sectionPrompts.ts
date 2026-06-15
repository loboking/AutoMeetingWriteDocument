import { MeetingSummary } from '@/types';
import { getSystemDateInfo } from '../dateUtils';
import { getTimelineGuardrailPrompt } from './advancedGuards';
import type { MeetingMetadata } from '@/types';

interface SectionPromptParams {
  summary: MeetingSummary;
  transcript: string;
  meetingInfo: { title: string; date: string };
  previousSections?: Record<string, string>;
  metadata?: MeetingMetadata;
}

export interface SectionPrompt {
  getPrompt: (params: SectionPromptParams) => string;
  estimatedTokens: number;
}

// 공통 헤더
function getCommonHeader(meetingInfo: { title: string; date: string }, summary: MeetingSummary): string {
  const { currentDate, currentYear, minStartDate } = getSystemDateInfo();

  return `## 회의 정보
- 제목: ${meetingInfo.title}
- 날짜: ${meetingInfo.date}

## 회의 요약
- 개요: ${summary.overview}
- 핵심 사항: ${summary.keyPoints.join(', ')}
- 의사결정: ${summary.decisions.join(', ')}

## ⚠️ 시스템 날짜 강제 규칙 (반드시 준수하세요)
- **오늘 날짜**: ${currentDate} (${currentYear}년)
- **프로젝트 최소 시작일**: ${minStartDate} (내일부터)
- 모든 테스트 일정은 **${currentYear}년 ${minStartDate} 이후**의 날짜로만 생성해야 합니다.

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

| 항목 | 내용 |
|------|------|
| **문서명** | 테스트 계획서 (Test Plan) |
| **버전** | v1.0 |
| **작성일** | ${meetingInfo.date} |
| **작성자** | QA 리드 |

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | ${meetingInfo.date} | 초기 작성 | QA 리드 |

위 형식을 그대로 출력하세요.
`;
  },
  estimatedTokens: 200,
};

// 섹션 2: 테스트 개요
export const overviewPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 2. 테스트 개요 (Test Overview)

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

### 2.1 프로젝트 정보

| 항목 | 내용 |
|------|------|
| **프로젝트명** | [프로젝트명] |
| **테스트 기간** | [YYYY-MM-DD] ~ [YYYY-MM-DD] |
| **테스트 환경** | Staging |
| **테스트 팀** | QA 팀 ([회의 내용 또는 추정]) |

### 2.2 테스트 목표

- [ ] P0/P1 기능 100% 구현 검증
- [ ] 치명적 버그 0건 릴리스
- [ ] 테스트 커버리지 70% 이상 달성
- [ ] 성능 기준 충족 (응답 200ms 이하)
`;
  },
  estimatedTokens: 2000,
};

// 섹션 3: 테스트 전략
export const strategyPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 3. 테스트 전략 (Test Strategy)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 3.1 테스트 접근 방식

| 항목 | 내용 |
|------|------|
| **방법론** | 애자일 테스트 (스프린트별) |
| **테스트 주기** | 스프린트별 + 릴리스 전 전체 테스트 |
| **자동화 비율** | 1단계: 30%, 2단계: 60%, 3단계: 80% |

### 3.2 테스트 유형별 전략

| 테스트 유형 | 목적 | 도구 | 책임자 | 주기 | 자동화 |
|------------|------|------|--------|------|--------|
| **단위 테스트** | 함수/컴포넌트 품질 | Jest, Vitest | 개발자 | 매일 | 100% |
| **통합 테스트** | 모듈 간 연동 | Supertest | 개발자 | 주별 | 80% |
| **API 테스트** | API 동작 검증 | Postman | QA | 주별 | 90% |
| **E2E 테스트** | 사용자 시나리오 | Playwright | QA | 스프린트별 | 70% |
| **성능 테스트** | 부하/응답시간 | k6 | QA | 릴리스 전 | 100% |
| **보안 테스트** | 취약점 점검 | OWASP ZAP | 보안팀 | 분별 | 50% |
`;
  },
  estimatedTokens: 2500,
};

// 섹션 4: 테스트 범위
export const scopePrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const context = previousSections?.['overview'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## 테스트 개요 참고
${context}

---` : ''}

## 작성 섹션: 4. 테스트 범위 (Test Scope)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 논의된 **모든 기능**을 포함하세요.

### 4.1 In-Scope (테스트 대상)

| 기능 영역 | 상세 기능 | 우선순위 | 테스트 유형 |
|-----------|-----------|-----------|-----------|
| 회원관리 | 회원가입 | P0 | E2E, API |
| 회원관리 | 로그인/로그아웃 | P0 | E2E, API |
| [회의 내용] | [회의 내용] | [회의 내용] | [회의 내용] |

### 4.2 Out-of-Scope (테스트 제외)

- [ ] 서드파티 라이브러리 내부 동작
- [ ] 프로덕션 데이터 백업/복구
`;
  },
  estimatedTokens: 3000,
};

// 섹션 5: 테스트 환경
export const environmentPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 5. 테스트 환경 (Test Environment)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 5.1 환경 구성

| 환경 | 용도 | URL | 데이터 | 관리자 |
|------|------|-----|--------|--------|
| **Local** | 개발 테스트 | localhost | Mock 데이터 | 개발자 |
| **Dev** | 개발 통합 | [추정] | 테스트 데이터 | DevOps |
| **Staging** | 사전 테스트 | [추정] | 실제 데이터와 유사 | QA |
| **Production** | 운영 모니터링 | [추정] | 실제 데이터 | 운영팀 |

### 5.2 테스트 데이터

| 유형 | 설명 | 데이터 수 | 준비 방법 |
|------|------|-----------|----------|
| **정상 데이터** | 표준 사용자 시나리오 | 100건 | 수동 생성 |
| **경계 데이터** | 최소/최대값 | 20건 | 수동 생성 |
| **예외 데이터** | 오류 유발 케이스 | 30건 | 수동 생성 |
`;
  },
  estimatedTokens: 2000,
};

// 섹션 6: 테스트 일정
export const schedulePrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const scopeContext = previousSections?.['scope'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${getTimelineGuardrailPrompt()}

${scopeContext ? `## 테스트 범위 참고
${scopeContext}

---` : ''}

## 작성 섹션: 6. 테스트 일정 (Test Schedule)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 테스트 일정과 날짜**를 반드시 포함하세요.

### 6.1 단계별 일정

| 단계 | 작업 | 기간 | 시작일 | 종료일 | 담당자 | 선행 조건 |
|------|------|------|--------|--------|--------|----------|
| **0단계** | 준비 | 1주 | [YYYY-MM-DD] | [YYYY-MM-DD] | QA 리드 | - |
| **1단계** | 단위/통합 | 2주 | [YYYY-MM-DD] | [YYYY-MM-DD] | 개발팀 | 개발 완료 |
| **2단계** | 기능 테스트 | 2주 | [YYYY-MM-DD] | [YYYY-MM-DD] | QA 팀 | 1단계 완료 |
| **3단계** | E2E 테스트 | 1주 | [YYYY-MM-DD] | [YYYY-MM-DD] | QA 팀 | 2단계 완료 |
| **4단계** | 성능/보안 | 1주 | [YYYY-MM-DD] | [YYYY-MM-DD] | QA, 보안 | 3단계 완료 |

### 6.2 간트 차트

\`\`\`mermaid
gantt
    title Test Schedule / 테스트 일정
    dateFormat YYYY-MM-DD
    section Preparation / 준비
    Test Plan / 테스트 계획     :a1, 2024-06-01, 2d
    section Unit/Integration / 단위/통합
    Unit Test / 단위 테스트     :b1, after a1, 2w
    section Functional Test / 기능 테스트
    Functional Test / 기능 테스트     :c1, after b1, 2w
    section E2E
    E2E Test / E2E 테스트      :d1, after c1, 1w
    section Performance/Security / 성능/보안
    Performance Test / 성능 테스트     :e1, after d1, 3d
\`\`\`

**위 예시를 회의 내용에 맞게 수정하세요.**
`;
  },
  estimatedTokens: 3500,
};

// 섹션 7: 입수/퇴수 기준
export const entryExitCriteriaPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 7. 입수/퇴수 기준 (Entry/Exit Criteria)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 7.1 입수 기준 (Entry Criteria)

| 항목 | 기준 | 확인 방법 | 담당자 |
|------|------|----------|--------|
| 개발 완료 | 모든 P0/P1 기능 구현 완료 | 데모 확인 | PM |
| 배포 | Dev 환경에 배포 완료 | 접속 확인 | DevOps |
| 단위 테스트 | 커버리지 80% 이상 통과 | 리포트 | 개발팀장 |

### 7.2 퇴수 기준 (Exit Criteria)

| 항목 | 기준 | 측정 방법 | 담당자 |
|------|------|----------|--------|
| 기능 완료 | P0/P1 기능 100% 구현 | 테스트 결과 | QA 리드 |
| 버그 기준 | P0: 0건, P1: 0건, P2: 3건 이하 | 버그 리포트 | QA 리드 |
| 커버리지 | 코드 커버리지 70% 이상 | 리포트 | 개발팀장 |
`;
  },
  estimatedTokens: 2000,
};

// 섹션 8: 리스크 관리
export const risksPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 8. 리스크 관리 (Risk Management)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 8.1 테스트 리스크

| 리스크 ID | 리스크명 | 확률 | 영향 | 점수 | 대응 전략 | 담당자 |
|-----------|----------|------|------|------|----------|--------|
| R-001 | 테스트 인력 부족 | 중(50%) | 높음 | 12 | 외부 QA 지원 | PM |
| R-002 | 환경 불안정 | 중(30%) | 중 | 6 | 환경 사전 점검 | DevOps |
| R-003 | 일정 지연 | 높(70%) | 높음 | 21 | 우선순위 조정 | PM |

**위험도 점수 = 확률 × 영향**
`;
  },
  estimatedTokens: 1500,
};

// 섹션 9: 결함 관리
export const defectManagementPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 9. 결함 관리 (Defect Management)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

### 9.1 버그 등급 분류

| 등급 | 설명 | 예시 | 응답 SLA | 수정 SLA |
|------|------|------|----------|----------|
| P0 | 치명적, 서비스 중단 | 로그인 불가, 데이터 손실 | 1시간 | 4시간 |
| P1 | 주요 기능 실패 | 결제 실패, 저장 불가 | 4시간 | 1일 |
| P2 | 부분 기능 실패 | UI 깨짐, 경고 메시지 | 1일 | 3일 |
| P3 | 사소한 문제 | 오타, 미미한 UI | 2일 | 1주 |
`;
  },
  estimatedTokens: 1500,
};

// 섹션별 프롬프트 매핑
export const SECTION_PROMPTS: Record<string, SectionPrompt> = {
  'doc-info': docInfoPrompt,
  'overview': overviewPrompt,
  'strategy': strategyPrompt,
  'scope': scopePrompt,
  'environment': environmentPrompt,
  'schedule': schedulePrompt,
  'entry-exit-criteria': entryExitCriteriaPrompt,
  'risks': risksPrompt,
  'defect-management': defectManagementPrompt,
};
