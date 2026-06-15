/**
 * 날짜 관련 유틸리티
 * AI 생성 문서의 연도 하홀리네이션 방지
 */

export interface SystemDateInfo {
  currentDate: string;    // YYYY-MM-DD (오늘)
  currentYear: string;    // YYYY (현재 연도)
  minStartDate: string;   // YYYY-MM-DD (내일)
}

/**
 * 시스템 날짜 정보를 반환합니다.
 */
export function getSystemDateInfo(): SystemDateInfo {
  const now = new Date();
  const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentYear = now.getFullYear().toString();

  // 최소 시작일: 내일부터
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minStartDate = tomorrow.toISOString().split('T')[0];

  return { currentDate, currentYear, minStartDate };
}

/**
 * 날짜 강제 규칙 프롬프트를 생성합니다.
 */
export function getDateValidationPrompt(): string {
  const { currentDate, currentYear, minStartDate } = getSystemDateInfo();

  return `## ⚠️ 시스템 날짜 강제 규칙 (반드시 준수하세요)
- **오늘 날짜**: ${currentDate} (${currentYear}년)
- **프로젝트 최소 시작일**: ${minStartDate} (내일부터)
- 모든 마일스톤, Gantt 차트, 릴리스 일정은 **${currentYear}년 ${minStartDate} 이후**의 날짜로만 생성해야 합니다.
- 절대로 2024년, 2025년 등 **과거 연도**를 임의로 생성하지 마세요.
- 타임라인 다이어그램의 모든 날짜는 ${currentYear}년 기준으로 작성하세요.`;
}

/**
 * 문서에서 과거 연도를 감지합니다.
 */
export function detectPastYears(content: string): { detected: boolean; matches: string[]; positions: Array<{ year: string; line: number }> } {
  const { currentYear } = getSystemDateInfo();
  const currentYearNum = parseInt(currentYear, 10);

  // 현재 연도보다 작은 연도 패턴 (동적으로 생성)
  // 현재 2026년이면 2020-2025까지 과거 연도로 처리
  const pastYears: string[] = [];
  for (let y = 2020; y < currentYearNum; y++) {
    pastYears.push(y.toString());
  }
  const pastYearsPattern = new RegExp(`\\b(${pastYears.join('|')})\\b`, 'g');

  const matches = content.match(pastYearsPattern) || [];
  const uniqueMatches = [...new Set(matches)];

  // 과거 연도의 위치(라인 번호) 찾기
  const positions: Array<{ year: string; line: number }> = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    uniqueMatches.forEach(year => {
      if (line.includes(year)) {
        positions.push({ year, line: index + 1 });
      }
    });
  });

  return {
    detected: matches.length > 0,
    matches: uniqueMatches,
    positions,
  };
}

/**
 * 문서에서 과거 연도를 현재 연도로 보정합니다.
 * @param content 원본 문서 내용
 * @returns 보정된 문서 내용
 */
export function correctPastYears(content: string): string {
  const { currentYear } = getSystemDateInfo();
  const currentYearNum = parseInt(currentYear, 10);

  // 현재 연도보다 작은 연도를 현재 연도로 변경
  let corrected = content;
  for (let y = 2010; y < currentYearNum; y++) {
    const yearPattern = new RegExp(`\\b${y}\\b`, 'g');
    corrected = corrected.replace(yearPattern, currentYear);
  }

  return corrected;
}

/**
 * 연도 검증 실패 시 재생성을 위한 피드백 메시지를 생성합니다.
 */
export function getYearValidationErrorFeedback(detectedYears: string[]): string {
  const { currentYear } = getSystemDateInfo();

  return `## ⚠️ 연도 검증 실패 - 재생성 필요

발견된 문제:
- 문서에 **과거 연도**가 포함되어 있습니다: ${detectedYears.join(', ')}
- 현재 연도는 ${currentYear}년입니다.

수정 요청:
- 모든 날짜를 **${currentYear}년** 기준으로 수정하세요.
- 마일스톤, Gantt 차트, 릴리스 일정을 **${currentYear}년**으로 다시 작성하세요.
- 과거 연도를 현재 연도로 변경하여 문서를 다시 생성하세요.`;
}
