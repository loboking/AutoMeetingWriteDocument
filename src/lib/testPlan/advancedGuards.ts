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
1. **시작일 강제**: 모든 테스트 단계의 시작일은 **${minStartDate} 이후**여야 합니다.
2. **연도 강제**: 모든 날짜는 **${currentYear}년** 기준으로 작성하세요.
3. **과거 연도 금지**: 2024년, 2025년 등 **과거 연도**를 절대로 생성하지 마세요.

### 테스트 일정 작성 시 준수 사항:
- 테스트 시작일: ${currentYear}-06-01 이후 (최소 ${minStartDate})
- 각 테스트 단계 간격: 최소 3일 이상
- 전체 테스트 기간: 6주 ~ 10주 내외로 현실적으로 작성

### 간트 차트/Mermaid 다이어그램 시:
- 모든 날짜를 ${currentYear}년으로 설정
- 시작점은 ${minStartDate} 이후로 표시
`;
}

/**
 * 마크다운 문서 전체 후처리
 */
export function postProcessGeneratedDocument(content: string): string {
  let processed = content;

  // 과거 연도 보정
  const { correctPastYears } = require('../dateUtils');
  processed = correctPastYears(processed);

  return processed;
}
