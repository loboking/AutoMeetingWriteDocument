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
- 모든 배포 일정, 릴리스 일정은 **${currentYear}년 ${minStartDate} 이후**의 날짜로만 생성해야 합니다.

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
- **문서 버전**: v1.0
- **작성일**: ${meetingInfo.date}
- **작성자**: DevOps팀

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | ${meetingInfo.date} | 초기 작성 | DevOps팀 |

위 형식을 그대로 출력하세요.
`;
  },
  estimatedTokens: 200,
};

// 섹션 2: 프로젝트 개요
export const overviewPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 2. 프로젝트 개요 (Project Overview)

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

다음 소섹션을 **매우 상세하게** 작성하세요:

### 2.1 프로젝트 정보
**최소 3문단 이상 작성:**
- 프로젝트의 목표와 범위
- 프로젝트의 성공 기준
- 주요 이해관계자

| 항목 | 내용 |
|------|------|
| **프로젝트명** | [프로젝트명] |
| **프로젝트 코드** | PRJ-001 |
| **시작일** | [YYYY-MM-DD] |
| **종료일** | [YYYY-MM-DD] |
| **총 기간** | [기간]주 ([일수]일) |
| **예산** | [추정] |

### 2.2 프로젝트 범위 (Scope)
**포함(In Scope):**
- 회의에서 논의된 **모든 기능**을 포함하세요

**불포함(Out of Scope):**
- 다음 단계로 미룰 기능

### 2.3 가정 및 제약사항
**가정사항:**
- 팀원은 프로젝트 시작일에 확보됨
- 외부 API는 일정 내에 제공됨

**제약사항:**
- 예산: [추정]
- 인력: [회의 내용 또는 추정]
- 기간: [회의 내용 또는 추정]
`;
  },
  estimatedTokens: 2500,
};

// 섹션 3: WBS 계층 구조
export const hierarchyPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const context = previousSections?.['overview'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## 프로젝트 개요 참고
${context}

---` : ''}

## 작성 섹션: 3. WBS 계층 구조 (WBS Hierarchy)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

각 작업은 최소 3단계 깊이로 분할하세요 (1.0 → 1.1 → 1.1.1).

회의에서 논의된 **모든 작업 영역**을 포함하세요:

#### 1.0 프로젝트 관리 (Project Management)
- 1.1 프로젝트 계획
- 1.2 일정 관리
- 1.3 리스크 관리
- 1.4 커뮤니케이션

#### 2.0 요구사항 분석 (Requirements Analysis)
- 2.1 요구사항 수집
- 2.2 요구사항 분석
- 2.3 문서화 (PRD 작성)
- 2.4 검토

#### 3.0 디자인 (Design)
- 3.1 UI/UX 디자인
- 3.2 아키텍처 설계
- 3.3 디자인 시스템

#### 4.0 프론트엔드 개발 (Frontend Development)
- 4.1 환경 설정
- 4.2 컴포넌트 개발
- 4.3 페이지 개발
- 4.4 상태 관리
- 4.5 테스트

#### 5.0 백엔드 개발 (Backend Development)
- 5.1 환경 설정
- 5.2 API 개발
- 5.3 데이터베이스
- 5.4 인프라

#### 6.0 테스트 (Testing)
- 6.1 테스트 계획
- 6.2 테스트 수행
- 6.3 결함 관리

#### 7.0 배포 (Deployment)
- 7.1 스테이징 배포
- 7.2 프로덕션 배포
- 7.3 핸드오버
`;
  },
  estimatedTokens: 3000,
};

// 섹션 4: 작업 상세
export const workPackagesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const context = previousSections?.['hierarchy'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## WBS 계층 구조 참고
${context}

---` : ''}

## 작성 섹션: 4. 작업 상세 (Work Package Detail)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

최소 10개 이상의 작업 패키지를 작성하세요.

회의에서 언급된 **모든 일정과 기간**을 반드시 포함하세요.

#### WP-001: 프로젝트 계획
| 항목 | 내용 |
|------|------|
| **작업 ID** | WP-001 |
| **작업명** | 프로젝트 계획 수립 |
| **WBS 코드** | 1.1 |
| **담당자** | PM |
| **시작일** | [YYYY-MM-DD] |
| **종료일** | [YYYY-MM-DD] |
| **공수(인일)** | 3일 |
| **선행 작업** | 없음 |
| **의존 관계** | - |
| **산출물** | 프로젝트 계획서 v1.0 |

이와 동일한 형식으로 최소 10개 작업 패키지를 작성하세요.

**중요**: 회의에서 언급된 작업, 일정을 모두 포함하세요.
`;
  },
  estimatedTokens: 4000,
};

// 섹션 5: 간트 차트
export const ganttChartPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const workPackagesContext = previousSections?.['work-packages'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${getTimelineGuardrailPrompt()}

${workPackagesContext ? `## 작업 상세 참고
${workPackagesContext}

---` : ''}

## 작성 섹션: 5. 간트 차트 (Gantt Chart)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 날짜와 기간**을 반드시 포함하세요.

### 간트 차트 (Mermaid)

\`\`\`mermaid
gantt
    title Project Schedule / 프로젝트 일정
    dateFormat YYYY-MM-DD
    section Project Management / 프로젝트 관리
    Planning / 계획     :a1, 2024-06-01, 2d
    Requirements / 요구사항    :a2, after a1, 5d
    section Design / 디자인
    UI/UX Design / UI/UX 디자인     :b1, after a2, 10d
    Architecture / 아키텍처     :b2, after a2, 7d
    section Development / 개발
    Frontend / 프론트엔드     :c1, after b1, 20d
    Backend / 백엔드     :c2, after b2, 25d
    section Testing / 테스트
    Integration / 통합 테스트     :d1, after c1 c2, 10d
    section Deployment / 배포
    Staging / 스테이징     :e1, after d1, 2d
    Production / 프로덕션     :e2, after e1, 1d
\`\`\`

**위 예시를 참고하여 회의 내용에 맞게 수정하세요.**
`;
  },
  estimatedTokens: 3000,
};

// 섹션 6: 마일스톤
export const milestonesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const workPackagesContext = previousSections?.['work-packages'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${getTimelineGuardrailPrompt()}

${workPackagesContext ? `## 작업 상세 참고
${workPackagesContext}

---` : ''}

## 작성 섹션: 6. 마일스톤 (Milestones)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 마일스톤과 날짜**를 반드시 포함하세요.

| 마일스톤 | 날짜 | 완료 기준 | 관련 작업 | 승인자 |
|----------|------|----------|----------|--------|
| M1: 프로젝트 착수 | [YYYY-MM-DD] | 프로젝트 계획 승인 | WP-001 | 스폰서 |
| M2: 요구사항 확정 | [YYYY-MM-DD] | PRD 승인 | WP-002 | PM |
| M3: 디자인 확정 | [YYYY-MM-DD] | 디자인 승인 | WP-003, WP-004 | CTO |
| M4: 개발 완료 | [YYYY-MM-DD] | 기능 구현 완료 | WP-005, WP-006 | 개발팀장 |
| M5: 테스트 완료 | [YYYY-MM-DD] | 테스트 통과 | WP-007 | QA팀장 |
| M6: 릴리스 | [YYYY-MM-DD] | 프로덕션 배포 | WP-009 | CTO |

**중요**: 회의에서 언급된 마일스톤을 모두 포함하세요.
`;
  },
  estimatedTokens: 2500,
};

// 섹션 7: 리스크 관리
export const risksPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

## 작성 섹션: 7. 리스크 관리 (Risk Management)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

최소 3개 이상 작성하세요.

| 리스크 ID | 리스크명 | 영향도 | 발생확률 | 대응 전략 | 담당자 | 상태 |
|-----------|----------|--------|----------|----------|--------|------|
| R-001 | [구체적 리스크] | 높음(3)/중간(2)/낮음(1) | 높음(3)/중간(2)/낮음(1) | [구체적 대응] | - | 모니터링 |
| R-002 | [구체적 리스크] | 중간 | 중간 | [구체적 대응] | - | 모니터링 |
| R-003 | [구체적 리스크] | 중간 | 낮음 | [구체적 대응] | - | 완화 |

**위험도 점수 = 영향도 × 발생확률**
`;
  },
  estimatedTokens: 2000,
};

// 섹션 8: 자원 계획
export const resourcesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections, metadata }) => {
    const context = previousSections?.['overview'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${context ? `## 프로젝트 개요 참고
${context}

---` : ''}

## 작성 섹션: 8. 자원 계획 (Resource Plan)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **팀 규모와 역할**을 모두 포함하세요.

### 8.1 인력 구성

**팀 규모**: ${metadata?.teamSizeType || '1인'} (${metadata?.teamSize || 1}명)

${metadata?.teamSizeType === '1인' ? `
### ⚠️ 1인 팀 규모 리소스 제약
- **창업자 1인** 외에 추가 역할을 생성할 수 없습니다.
- PM, 디자이너, QA 등 **별도 인력 배치 금지**
- 역할 컬럼은 반드시 **"창업자(개발/기획/디자인)"** 또는 **"1인 개발자"**로 작성하세요.
- 인원 컬럼은 무조건 **1**이어야 합니다.
` : ''}

| 역할 | 인원 | 기간 | 참여율 |
|------|------|------|--------|
${metadata?.teamSizeType === '1인'
  ? `| 창업자(개발/기획/디자인) | 1 | 전체 | 100% |`
  : `| [회의 내용 또는 추정] | [회의 내용 또는 추정] | [회의 내용 또는 추정] | [회의 내용 또는 추정] |`}

### 8.2 총 공수
| 단계 | 공수(인일) | 비중 |
|------|-----------|------|
| 프로젝트 관리 | [추정] | 10% |
| 요구사항 분석 | [추정] | 10% |
| 디자인 | [추정] | 20% |
| 개발 | [추정] | 40% |
| 테스트 | [추정] | 15% |
| 배포 | [추정] | 5% |
| **합계** | **[총공수]** | **100%** |
`;
  },
  estimatedTokens: 2000,
};

// 섹션 9: 의존 관계
export const dependenciesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections }) => {
    const workPackagesContext = previousSections?.['work-packages'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}

${workPackagesContext ? `## 작업 상세 참고
${workPackagesContext}

---` : ''}

## 작성 섹션: 9. 작업 의존 관계 (Dependencies)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

작업 간 의존 관계를 명시하세요.

| 선행 작업 | 후속 작업 | 의존 유형 | Lag |
|-----------|-----------|-----------|-----|
| WP-001 | WP-002 | FS | 0 |
| WP-002 | WP-003 | FS | 0 |

**의존 유형:**
- **FS (Finish-to-Start)**: 선행 작업 완료 후 후속 작업 시작
- **SS (Start-to-Start)**: 선행 작업 시작 시 후속 작업 시작
- **FF (Finish-to-Finish)**: 선행 작업 완료 시 후속 작업 완료
`;
  },
  estimatedTokens: 1500,
};

// 섹션별 프롬프트 매핑
export const SECTION_PROMPTS: Record<string, SectionPrompt> = {
  'doc-info': docInfoPrompt,
  'environment': overviewPrompt,  // overview를 environment로 재활용
  'prerequisites': hierarchyPrompt,  // hierarchy를 prerequisites로 재활용
  'env-vars': workPackagesPrompt,  // workPackages를 env-vars로 재활용
  'build': ganttChartPrompt,  // ganttChart를 build로 재활용
  'deployment': milestonesPrompt,  // milestones를 deployment로 재활용
  'rollback': risksPrompt,  // risks를 rollback로 재활용
  'monitoring': resourcesPrompt,  // resources를 monitoring으로 재활용
  'security': dependenciesPrompt,  // dependencies를 security로 재활용
};
