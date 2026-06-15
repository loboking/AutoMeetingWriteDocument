import { MeetingSummary, MeetingMetadata } from '@/types';

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

// 공통 가드: 과장 표현 금지
function getHyperboleGuard(): string {
  return `
[과장 표현 금지]
절대 '완벽', '원천 차단', '100%', '무조건', '완전히 우회' 같은 입증 불가능한 단정 표현을 쓰지 마세요. 대신 '~% 감소', '~조건에서 달성', '~방식으로 개선' 등 측정 가능하고 한정적인 표현을 사용하세요.
`;
}

// 공통 가드: PII/법규 준수
function getComplianceGuard(metadata?: MeetingMetadata): string {
  let guard = `
[개인정보 및 법규 준수]
개인정보(이름·주소·연락처)를 다루는 경우, 수집항목·보관기간·암호화 방식·파기정책을 반드시 명시하세요.
크롤링·자동등록·스크래핑이 관련되면 해당 플랫폼 약관 위반 가능성을 리스크로 명시하세요.
`;
  if (metadata?.hasPayment) {
    guard += `결제/정산 기능이 포함되므로 결제·정산 관련 규정(PG 약관, 정산 주기, 환불 정책 등)을 반드시 다루세요.\n`;
  }
  if (metadata?.complianceRisks && metadata.complianceRisks.length > 0) {
    guard += `다음 컴플라이언스 항목을 반드시 다루세요: ${metadata.complianceRisks.join(', ')}.\n`;
  }
  return guard;
}

// 공통 가드: 수치 일관성
function getNumericalConsistencyGuard(metadata?: MeetingMetadata): string {
  let guard = `
[수치 일관성 — 매우 중요]
같은 의미의 수치(원가·배송비·마진율·ARPU·MRR·전환율·사용자 수·인원·기간 등)는 PRD 전체에서 반드시 하나의 값으로만 쓰세요. 같은 지표를 섹션마다 다른 값으로 쓰면 안 됩니다. 합계와 부품 합이 맞는지 검산하고, 계산 근거를 비고에 명시하세요.
`;
  if (metadata?.coreMetrics && Object.keys(metadata.coreMetrics).length > 0) {
    const metrics = Object.entries(metadata.coreMetrics)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    guard += `
[확정 수치 — 아래 값을 토씨 하나 틀리지 말고 그대로 사용하세요. 절대 다른 값으로 바꾸거나 재계산하지 마세요]
${metrics}
`;
  }
  return guard;
}

// 공통 가드: 현실성
function getRealismGuard(metadata?: MeetingMetadata): string {
  let guard = `
[현실성]
성능 목표는 외부 API 지연을 합산해 현실적으로 설정하세요(내부 처리 200ms와 외부 API를 포함한 종단(end-to-end) 응답 시간을 구분해 표기). 일정은 가정(인력 규모·기능 수)을 명시하세요.
`;
  if (metadata?.teamSizeType === '1인') {
    guard += `1인 기준 주당 1~2개 기능 구현이 현실적이며, 무리한 일정은 우선순위 축소를 권고하세요.\n`;
  }
  return guard;
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
  getPrompt: ({ summary, transcript, metadata }) => {
    // 콘셉트 유형별 KPI 지표 세트 (특정 수치 하드코딩 없이 지표명만 분기)
    const concept = metadata?.conceptType
      ?? (metadata?.isSaaS === true ? 'saas' : metadata?.isSaaS === false ? 'commerce' : undefined);
    const kpiByConcept: Record<string, { guide: string; rows: string[] }> = {
      commerce: {
        guide: '이 사업은 SaaS가 아니므로 MAU/DAU/전환율 같은 가입자 지표를 쓰지 마세요. 매출·주문·재구매 등 커머스 지표를 사용하세요.',
        rows: ['| 비즈니스 | 월 매출 |', '| 비즈니스 | 월 주문 건수 |', '| 비즈니스 | 재구매율 |', '| 비즈니스 | 평균 객단가 |'],
      },
      saas: {
        guide: '이 사업은 SaaS이므로 MAU·구독 전환율·ARPU·이탈률 등 구독 기반 지표를 사용하세요.',
        rows: ['| 비즈니스 | MAU |', '| 비즈니스 | 유료 전환율 |', '| 비즈니스 | ARPU |', '| 비즈니스 | 월 이탈률 |'],
      },
      marketplace: {
        guide: '양면 시장이므로 거래액(GMV)·거래 건수·공급자/수요자 수 등 마켓플레이스 지표를 사용하세요.',
        rows: ['| 비즈니스 | GMV(총 거래액) |', '| 비즈니스 | 월 거래 건수 |', '| 비즈니스 | 활성 공급자 수 |', '| 비즈니스 | 활성 수요자 수 |'],
      },
      community: {
        guide: '커뮤니티이므로 활성 사용자·게시/참여 수·리텐션 등 참여 지표를 사용하세요.',
        rows: ['| 비즈니스 | MAU |', '| 비즈니스 | 월 게시/참여 수 |', '| 비즈니스 | 재방문율(리텐션) |'],
      },
      web: {
        guide: '서비스 성격에 맞는 지표(방문자·핵심 액션 완료율·재방문율 등)를 회의 내용 기반으로 선택하세요.',
        rows: ['| 비즈니스 | 월 활성 사용자 |', '| 비즈니스 | 핵심 액션 완료율 |', '| 비즈니스 | 재방문율 |'],
      },
    };
    const kpiSet = concept ? kpiByConcept[concept] : undefined;
    const kpiConceptGuide = kpiSet
      ? `\n[KPI 분기 지침]\n${kpiSet.guide}\n`
      : `\n[KPI 분기 지침]\n회의에서 드러난 비즈니스 모델에 맞는 지표만 선택하세요. 모델과 무관한 지표(예: 비SaaS인데 MAU)는 쓰지 마세요.\n`;
    // 비즈니스 지표 행: 콘셉트별 지표명 + 빈 목표(GLM이 회의 기반으로 채우도록), 없으면 일반 안내
    const businessRows = (kpiSet?.rows ?? ['| 비즈니스 | (모델에 맞는 지표) |'])
      .map(r => `${r} 0 | [목표값] | [측정 시점] | - |`)
      .join('\n');
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getHyperboleGuard()}
${getNumericalConsistencyGuard(metadata)}

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
${kpiConceptGuide}
**반드시 아래 형식의 테이블로 작성하세요. 목표값/측정 시점은 회의 내용에 근거해 채우되, 회의에 수치가 없으면 합리적 추정치를 쓰고 '추정'임을 비고에 명시하세요.**

| 지표 분류 | 지표명 | 현재 | 목표 | 측정 시점 | 담당자 |
|-----------|--------|------|------|----------|--------|
${businessRows}
| 제품 | 기능 완료도 | 0% | 100% | 출시 시 | 개발팀 |
| 제품 | 버그율 | - | [목표값] | 출시 1개월 후 | QA팀 |

**중요**: 위 비즈니스 지표는 이 사업의 콘셉트에 맞춘 것입니다. 회의에서 다른 핵심 지표가 언급되면 추가하되, 콘셉트에 맞지 않는 지표는 넣지 마세요.
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
  getPrompt: ({ summary, transcript, previousSections, metadata }) => {
    const context = previousSections?.['overview'] || previousSections?.['problem'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getRealismGuard(metadata)}
${getNumericalConsistencyGuard(metadata)}

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
  getPrompt: ({ summary, transcript, metadata }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getComplianceGuard(metadata)}
${getRealismGuard(metadata)}

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

**개인정보(PII) 처리 정책 (필수 하위항목):**
개인정보를 다루는 경우 아래 4개 항목을 반드시 표 또는 목록으로 명시하세요.
- **수집항목**: 수집하는 개인정보 항목(이름·연락처·주소 등)
- **보관기간**: 항목별 보관 기간 및 보관 종료 시점
- **암호화 방식**: 저장/전송 시 암호화 방식(예: AES-256, TLS 1.3)
- **파기정책**: 보관기간 경과·목적 달성 시 파기 절차와 방법

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

**반드시 첫 줄에 H2 대제목 "## 9. 기술 요구사항"을 출력한 뒤**, 아래 3개 소섹션을 **매우 상세하게** 작성하세요:

### 9.1 기술 스택
이 프로젝트의 실제 요구사항(회의 내용)에 맞는 기술을 선정하세요. 아래 표 구조로 작성하되, 각 기술은 이 제품에 필요한 이유를 근거로 선택하세요. (특정 스택을 무조건 넣지 말고, 회의에서 드러난 성격에 맞게 결정)

| 분야 | 기술 | 버전 | 선택 이유 |
|------|------|------|-----------|
| 프론트엔드 | [회의 내용 기반 선택] | [버전] | [이 제품에 적합한 이유] |
| 백엔드 | [선택] | [버전] | [이유] |
| 데이터베이스 | [선택] | [버전] | [이유] |
| 인프라/배포 | [선택] | - | [이유] |
| (필요 시 추가) | | | |

### 9.2 상세 아키텍처 설계
**최소 3문단 이상 작성 (이 제품의 실제 구조에 맞게):**
- **시스템 컴포넌트**: 이 제품에 실제로 필요한 컴포넌트와 각 역할
- **데이터 흐름**: 사용자 요청부터 응답까지의 전체 흐름
- **확장성 전략**: 수평/수직 확장 계획

아래는 일반적인 웹 서비스 아키텍처의 **빈 골격**입니다. 이 제품에 맞게 컴포넌트를 추가/삭제/이름변경하세요. 이 제품과 무관한 컴포넌트(예: 회의에 없는 외부 서비스)는 절대 넣지 마세요.

\`\`\`mermaid
graph TB
    subgraph "클라이언트"
        A[클라이언트 앱]
    end
    subgraph "애플리케이션"
        C[인증/인가]
        F[핵심 비즈니스 로직]
    end
    subgraph "데이터 계층"
        H[(주 데이터베이스)]
        I[(캐시)]
    end
    subgraph "외부 서비스"
        K[이 제품에 필요한 외부 연동만]
    end

    A --> C
    C --> F
    F --> H
    F --> I
    F --> K
\`\`\`

### 9.3 데이터베이스 설계
이 제품의 핵심 도메인 엔터티에 맞는 테이블을 설계하세요. 아래는 **빈 골격**이며 컬럼/테이블명은 이 제품 도메인에 맞게 채우세요. 예상 데이터 수는 회의의 사용량 가정에 근거해 산정하고(근거를 백업 전략 옆에 간단히), 회의에 없는 기능의 테이블(예: 무관한 결제/영상)은 넣지 마세요.

| 테이블명 | 주요 컬럼 | 관계 | 예상 데이터 수 | 백업 전략 |
|---------|-----------|------|---------------|-----------|
| [핵심 엔터티1] | id, ... | 1:N | [근거 기반 추정] | [전략] |
| [핵심 엔터티2] | id, ... | N:1 | [추정] | [전략] |
| [필요 시 추가] | | | | |
`;
  },
  estimatedTokens: 5000,
};

// 섹션 10: 릴리스 계획
export const releasePlanPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, previousSections, metadata }) => {
    const funcContext = previousSections?.['functional-req'] || '';
    const techContext = previousSections?.['technical-req'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getRealismGuard(metadata)}

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
회의에서 논의된 날짜/기간을 반영해 작성하세요. **담당자는 이 프로젝트의 실제 팀 역할로 채우고, 기간(주)은 시작일~종료일과 일치하도록 계산하세요.** 회의에 일정이 없으면 합리적으로 추정하되 추정임을 명시하세요.

| 단계 | 작업 항목 | 기간 | 시작일 | 종료일 | 담당자 | 선행 조건 | 산출물 |
|------|----------|------|--------|--------|--------|----------|--------|
| 1단계 | 기획 및 설계 | [N주] | [시작일] | [종료일] | [실제 담당 역할] | - | [산출물] |
| 2단계 | 개발 | [N주] | [시작일] | [종료일] | [역할] | 1단계 완료 | [산출물] |
| 3단계 | 테스트 | [N주] | [시작일] | [종료일] | [역할] | 2단계 완료 | [산출물] |
| 4단계 | 출시 | [N주] | [시작일] | [종료일] | [역할] | 3단계 완료 | [산출물] |

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
단계별 출시 일정을 작성하세요. **각 단계의 "대상"은 이 제품의 실제 사용자 유형에 맞게 정하세요.**
(예: 외부 판매 제품이면 베타 사용자, 사내 도구면 특정 부서, 무료 앱이면 초기 테스터 등 — 회의에 없는 시장/고객을 임의로 만들지 마세요.)

- **알파 테스트**: [기간], 대상: [이 제품에 맞는 내부/제한 대상]
- **베타 테스트**: [기간], 대상: [이 제품에 맞는 대상]
- **정식 출시**: [날짜], 대상: [실제 목표 사용자]
`;
  },
  estimatedTokens: 4000,
};

// 섹션 11: 비용 및 리소스
export const costResourcesPrompt: SectionPrompt = {
  getPrompt: ({ summary, transcript, metadata }) => {
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getNumericalConsistencyGuard(metadata)}
[비용 구분]
11.1 개발 비용(일회성·초기 투자)과 11.2 운영 비용(반복·월간)을 명확히 구분하세요. 동일 항목을 개발비와 운영비에 중복 계상하지 마세요.

## 작성 섹션: 11. 비용 및 리소스 (Cost & Resources)

## 원본 회의 내용
${transcript}

---

## 작성 가이드

회의에서 언급된 **모든 비용 관련 정보**를 추출하세요.

### 11.1 개발 비용 (일회성·초기 투자)
이 제품을 만드는 데 드는 **초기/일회성** 비용만 작성하세요. 항목·단가·수량은 회의에서 언급된 실제 비용 정보에 근거하고, 각 행의 총비용은 단가×수량으로 검산하세요. 회의에 없는 비용 항목(예: 무관한 외부 API)은 넣지 마세요.

| 항목 | 단위 | 단가 | 수량 | 기간 | 총비용 | 비고(산출 근거) |
|------|------|------|------|------|--------|------|
| [회의 기반 항목] | [단위] | [단가] | [수량] | [기간] | [단가×수량] | [근거] |
| (필요 시 추가) | | | | | | |

### 11.2 운영 비용 (월간·반복)
출시 후 **매월 반복** 발생하는 비용만 작성하세요. 11.1과 같은 항목을 중복 계상하지 마세요. 합계는 각 행의 합으로 검산하세요.

| 항목 | 예상 월 비용 | 산출 근거 |
|------|-------------|-----------|
| [회의 기반 항목] | [금액] | [단가 × 수량 등 계산식] |
| (필요 시 추가) | | |
| **합계** | **[행 합계]** | - |

### 11.3 리소스 계획
이 프로젝트의 **실제 팀 구성**에 맞게 작성하세요. 회의에서 1인/소규모라면 그에 맞게, 더 큰 팀이면 역할별로. 회의에 없는 역할(예: 1인 프로젝트인데 별도 디자이너/DevOps)을 임의로 만들지 마세요.

| 역할 | 인원 | 기간 | 참여율 | 주요 업무 |
|------|------|------|--------|-----------|
| [실제 역할] | [인원] | [기간] | [%] | [업무] |
| (필요 시 추가) | | | | |
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
이 서비스의 가치와 타겟에 맞는 요금제를 설계하세요. 각 플랜의 가격/기능 제한은 회의 내용에 근거하고, 무료 플랜의 제한과 유료 플랜의 차별점을 명확히 하세요. (아래는 빈 구조이며 가격·기능은 이 서비스에 맞게 채우세요)

| 플랜 | 가격 | 주요 기능/제한 | 결제 주기 | 할인 |
|------|------|------|----------|------|
| 무료 | 0원 | [무료 제공 범위] | - | - |
| [유료 플랜명] | [가격] | [기능/한도] | 월간 | - |
| [상위 플랜명] | [가격] | [기능/한도] | 월간 | [연간 할인 등] |

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
  getPrompt: ({ summary, transcript, previousSections, metadata }) => {
    const overviewContext = previousSections?.['overview'] || '';
    const releaseContext = previousSections?.['release-plan'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getHyperboleGuard()}
${getComplianceGuard(metadata)}

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
  getPrompt: ({ summary, transcript, previousSections, metadata }) => {
    const goalsContext = previousSections?.['goals'] || '';
    const releaseContext = previousSections?.['release-plan'] || '';
    return `
${getCommonHeader({ title: '', date: '' }, summary)}
${getHyperboleGuard()}
${getNumericalConsistencyGuard(metadata)}

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
