import { getSystemDateInfo } from '../dateUtils';

/**
 * 타임라인 생성 모델 가드레일
 * 현재 연도 기준으로 시작일 강제
 */
export function getTimelineGuardrailPrompt(): string {
  const { currentDate, currentYear, minStartDate } = getSystemDateInfo();

  return `
## ⚠️ 타임라인 생성 강제 규칙 (반드시 준수하세요)

**시스템 현재 날짜**: ${currentDate}
**프로젝트 최소 시작일**: ${minStartDate} (내일부터)

### 절대 위반 금지:
1. **시작일 강제**: 모든 마일스톤, 작업의 시작일은 **${minStartDate} 이후**여야 합니다.
2. **연도 강제**: 모든 날짜는 **${currentYear}년** 기준으로 작성하세요.
3. **과거 연도 금지**: 2024년, 2025년 등 **과거 연도**를 절대로 생성하지 마세요.

### 일정 작성 시 준수 사항:
- 간트 차트 시작일: ${currentYear}-06-01 이후 (최소 ${minStartDate})
- 각 작업 간격: 최소 1일 이상
- 전체 프로젝트 기간: 8주 ~ 16주 내외로 현실적으로 작성

### 간트 차트/Mermaid 다이어그램 시:
- 모든 날짜를 ${currentYear}년으로 설정
- 시작점은 ${minStartDate} 이후로 표시
`;
}

/**
 * 1인 팀 규모 리소스 계획 검증
 * 리소스 계획 테이블이 1명 초과일 경우 수정
 */
export function ensureOnePersonResourcePlan(content: string): string {
  // 자원 계획 테이블 찾기
  const resourcePlanPattern = /### 8\.1 인력 구성[\s\S]*?\n\n\|[\s\S]*?\n\n/g;

  return content.replace(resourcePlanPattern, (section) => {
    // 인원 수 합계 계산
    const lines = section.split('\n');
    let totalHeadcount = 0;
    let dataLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\|[^|]*\|[^|]*\|(\d+)\|/);
      if (match) {
        totalHeadcount += parseInt(match[1], 10);
        if (dataLineIndex === -1) dataLineIndex = i;
      }
    }

    // 1명 초과하면 수정
    if (totalHeadcount > 1 && dataLineIndex >= 0) {
      // 테이블 헤더 찾기
      const headerIndex = lines.findIndex(line => line.includes('역할'));
      if (headerIndex >= 0) {
        lines[headerIndex + 2] = '| 창업자(개발/기획/디자인) | 1 | 전체 | 100% |';
      }
      return lines.join('\n') + '\n\n';
    }

    return section;
  });
}

/**
 * 마크다운 문서 전체 후처리
 * 생성된 문서에 대해 일관성 검증 및 수정
 */
export function postProcessGeneratedDocument(content: string, metadata?: { teamSize?: number; teamSizeType?: string }): string {
  let processed = content;

  // 1. 과거 연도 보정 (dateUtils.correctPastYears)
  const { correctPastYears } = require('../dateUtils');
  processed = correctPastYears(processed);

  // 2. 1인 팀 규모 리소스 계획 검증
  if (metadata?.teamSizeType === '1인') {
    processed = ensureOnePersonResourcePlan(processed);
  }

  return processed;
}
