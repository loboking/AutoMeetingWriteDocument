import type { MeetingMetadata } from '@/types';

/**
 * 메타데이터를 기반으로 강제 제약조건 프롬프트를 생성합니다.
 *
 * 이 프롬프트는 AI가 문서를 생성할 때 회의에서 논의된
 * 핵심 제약조건을 위반하지 않도록 강제합니다.
 */
export function getMetadataConstraintsPrompt(metadata: MeetingMetadata): string {
  const constraints: string[] = [];

  // 팀 규모 제약조건
  constraints.push(getTeamSizeConstraint(metadata));

  // 예산 타입 제약조건
  constraints.push(getBudgetConstraint(metadata));

  // SaaS 관련 제약조건
  if (metadata.isSaaS) {
    constraints.push(getSaaSConstraint(metadata));
  }

  // 모바일 앱 제약조건
  if (metadata.hasMobileApp) {
    constraints.push(getMobileAppConstraint());
  }

  return `
## ⚠️ 강제 제약조건 (회의록 분석 기반 - 반드시 준수하세요)

다음 제약조건은 회의록 분석을 통해 추출된 **핵심 비즈니스 제약사항**입니다.
이를 위반하는 문서를 생성하면 사용자의 비즈니스 목표와 맞지 않게 됩니다.

${constraints.join('\n\n')}

---
`;
}

/**
 * 팀 규모 제약조건
 */
function getTeamSizeConstraint(metadata: MeetingMetadata): string {
  const { teamSize, teamSizeType } = metadata;

  if (teamSizeType === '1인') {
    return `### 1. 팀 규모 제약 (1인 기업)
- **팀 구성**: 1명 (개인/1인 창업)
- **리소스 계획**: PM, 디자이너, QA 등 **별도 인력 배치 금지**
- **비용 계획**: 인건비는 0원 또는 창업자 본인 비용만
- **일정 계획**: 1인이 수행 가능한 현실적인 일정으로 작성
- **역할**: 개인이 개발/기획/디자인을 모두 수행하는 것으로 기획`;
  }

  if (teamSizeType === '2-5인') {
    return `### 1. 팀 규모 제약 (소형 팀: ${teamSize}명)
- **팀 구성**: ${teamSize}명 이내의 소형 팀
- **리소스 계획**: ${teamSize}명 내에서 역할 분담 (개발/기획/디자인)
- **비용 계획**: ${teamSize}명 인건비 기준으로 현실적으로 산출
- **일정 계획**: ${teamSize}명이 수행 가능한 일정으로 작성`;
  }

  if (teamSizeType === '6-10인') {
    return `### 1. 팀 규모 제약 (중형 팀: ${teamSize}명)
- **팀 구성**: ${teamSize}명의 중형 팀
- **리소스 계획**: ${teamSize}명 내에서 전문 역할 분담 (개발/기획/디자인/QA)
- **비용 계획**: ${teamSize}명 인건비 기준으로 현실적으로 산출`;
  }

  return `### 1. 팀 규모 제약 (대형 팀: ${teamSize}명)
- **팀 구성**: ${teamSize}명 이상의 대형 팀
- **리소스 계획**: 전문 역할별 인력 배정 가능`;
}

/**
 * 예산 타입 제약조건
 */
function getBudgetConstraint(metadata: MeetingMetadata): string {
  const { budgetType, estimatedBudget } = metadata;

  if (budgetType === '무료') {
    return `### 2. 예산 제약 (무료 프로젝트)
- **비용**: 모든 비용은 0원 또는 무료 서비스 활용
- **인프라**: AWS/GCP 무료 티어, Vercel 무료 플랜, SQLite 등
- **외부 서비스**: 무료 오픈소스, 무료 티어 API만 사용
- **결제**: 유료 결제 기능 포함 금지`;
  }

  if (budgetType === '자체') {
    return `### 2. 예산 제약 (자체 예산: ${estimatedBudget || '추정 필요'})
- **비용**: 회사 자체 예산 내에서 현실적으로 산출
- **인프라**: 비용 효율적인 솔루션 (Vercel, AWS lightsail 등)
- **외부 서비스**: 필수 서비스 위주로 비용 최적화`;
  }

  return `### 2. 예산 제약 (투자 유치: ${estimatedBudget || '추정 필요'})
- **비용**: 투자금을 활용한 스케일링 고려
- **인프라**: 성능/확장성 중심의 아키텍처`;
}

/**
 * SaaS 제약조건
 */
function getSaaSConstraint(metadata: MeetingMetadata): string {
  const constraints = [
    `### 3. SaaS 필수 요구사항`,
    `- **다중 테넌트**: user_id 기반 데이터 격리 필수`,
    `- **계정/권한**: 회원가입, 로그인, 권한 관리 시스템 필수`,
  ];

  if (metadata.hasPayment) {
    constraints.push(`- **결제 시스템**: 과금, 결제, 환불, 영수증 발급 기능 필수`);
    constraints.push(`- **요금제**: 무료/베이직/프로 등 플랜 구조 필요`);
  } else {
    constraints.push(`- **결제 시스템**: 현재 단계에서 불포함 (향후 확장성 고려)`);
  }

  constraints.push(`- **백오피스**: 관리자 대시보드, 사용자 관리, 통계 기능 필수`);

  return constraints.join('\n');
}

/**
 * 모바일 앱 제약조건
 */
function getMobileAppConstraint(): string {
  return `### 4. 모바일 앱 포함
- **iOS 앱**: iOS 14+ 지원
- **Android 앱**: Android 10+ 지원
- **반응형**: 모바일 웹 지원 필수
- **기술 스택**: React Native / Flutter / 각 플랫폼 네이티브`;
}

/**
 * 메타데이터 기반 요약 텍스트 생성
 */
export function getMetadataSummary(metadata: MeetingMetadata): string {
  return `
**회의록 분석 기반 프로젝트 제약사항:**
- 팀 규모: ${metadata.teamSizeType} (${metadata.teamSize}명)
- 예산 타입: ${metadata.budgetType}${metadata.estimatedBudget ? ` (${metadata.estimatedBudget})` : ''}
- SaaS 여부: ${metadata.isSaaS ? '포함' : '불포함'}
- 결제 기능: ${metadata.hasPayment ? '포함' : '불포함'}
- 타겟 사용자: ${metadata.targetUsersCount}명 (예상)
- 모바일 앱: ${metadata.hasMobileApp ? '포함' : '불포함'}
- 추출 확신도: ${metadata.confidence}
`;
}
