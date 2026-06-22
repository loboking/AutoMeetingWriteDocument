import { getSystemDateInfo, correctPastYears } from '../dateUtils';

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
1. **시작일 강제**: 모든 마일스톤, 단계의 시작일은 **${minStartDate} 이후**여야 합니다.
2. **연도 강제**: 모든 날짜는 **${currentYear}년** 기준으로 작성하세요.
3. **과거 연도 금지**: 2024년, 2025년 등 **과거 연도**를 절대로 생성하지 마세요.

### 일정 작성 시 준수 사항:
- 마일스톤 시작일: ${currentYear}-06-01 이후 (최소 ${minStartDate})
- 각 단계 간격: 최소 1주 이상
- 전체 프로젝트 기간: 3개월 ~ 6개월 내외로 현실적으로 작성

### Gantt 차트/타임라인 다이어그램 시:
- 모든 날짜를 ${currentYear}년으로 설정
- x축의 시작점은 ${minStartDate} 이후로 표시
`;
}

/**
 * Multi-stage 프롬프트 체이닝: 비용 결과 → 리소스 계획 바인딩
 * 11.1절 인건비 결과를 분석하여 11.3절 리소스 계획에 반영
 */
export function getResourcePlanWithCostBinding(
  previousSections?: Record<string, string>,
  metadata?: { teamSize?: number; teamSizeType?: string }
): string {
  // 이전 섹션(11.1, 11.2)에서 인건비 정보 추출
  const costSection = previousSections?.['cost-resources'] || '';

  // 인건비 테이블 파싱
  const extractHeadcount = (content: string): number => {
    // 인건비 행 찾기: | 인건비 | ... | N | ...
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('인건비')) {
        const cells = line.split('|').map(c => c.trim());
        // 인건비 다음 셀이 숫자인지 확인
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === '인건비' && i + 2 < cells.length) {
            const count = parseInt(cells[i + 2], 10);
            if (!isNaN(count)) {
              return count;
            }
          }
        }
      }
    }
    return 1;
  };

  let teamSize = 1;
  let teamSizeType = '1인';

  // 메타데이터 우선
  if (metadata?.teamSize) {
    teamSize = metadata.teamSize;
    teamSizeType = metadata.teamSizeType || '1인';
  } else if (costSection) {
    // 비용 섹션에서 추출 시도
    teamSize = extractHeadcount(costSection);
    teamSizeType = teamSize === 1 ? '1인' : teamSize <= 5 ? '2-5인' : '6-10인';
  }

  // 1인 팀 규모일 때 리소스 계획 제약
  const onePersonConstraint = teamSizeType === '1인' ? `
### ⚠️ 1인 팀 규모 리소스 제약
- **창업자 1인** 외에 추가 역할을 생성할 수 없습니다.
- PM, 디자이너, QA 등 **별도 인력 배치 금지**
- 역할 컬럼은 반드시 **"창업자(개발/기획/디자인)"** 또는 **"1인 개발자"**로 작성하세요.
- 인원 컬럼은 무조건 **1**이어야 합니다.
` : '';

  return `
### 11.3 리소스 계획

**팀 규모**: ${teamSizeType} (${teamSize}명)
${onePersonConstraint}

**작성 가이드**:
- 회의에서 언급된 **모든 역할과 인원**을 포함하세요
- 언급이 없으면 **팀 규모(${teamSizeType})**에 맞게 작성하세요
- ${teamSizeType === '1인' ? '창업자 1명만 작성하세요' : `${teamSize}명 내에서 역할 분담하세요`}

| 역할 | 인원 | 기간 | 참여율 | 주요 업무 |
|------|------|------|--------|-----------|
${teamSizeType === '1인'
  ? `| 창업자(개발/기획/디자인) | 1 | 전체 | 100% | 개발/기획/디자인 전담 |`
  : `| [회의 내용 또는 추정] | [회의 내용 또는 추정] | [회의 내용 또는 추정] | [회의 내용 또는 추정] | [회의 내용 또는 추정] |`}
`;
}

/**
 * 구독 요금제 - 원가 매핑 후처리 밸리데이터
 * '무제한' 플랜에 API 단가가 있으면 제한 텍스트 삽입
 */
export function validateAndFixBillingPlans(content: string): string {
  // 과금 플랜 테이블 패턴 (마크다운 테이블)
  const planTablePattern = /\|[\s\-]*플랜[\s\-]*\|[\s\-]*가격[\s\-]*\|[\s\-]*기능[\s\-]*\|[\s\S]*?\n\n/g;

  return content.replace(planTablePattern, (table) => {
    const lines = table.split('\n');
    const headerLine = lines[0];
    const separatorLine = lines[1];
    const dataLines = lines.slice(2);

    // 헤더에서 플랜, 가격, 기능 컬럼 인덱스 찾기
    const headers = headerLine.split('|').map(h => h.trim().toLowerCase());
    const planIdx = headers.indexOf('플랜');
    const priceIdx = headers.indexOf('가격');
    const featureIdx = headers.indexOf('기능');

    if (planIdx === -1 || priceIdx === -1 || featureIdx === -1) {
      return table; // 변환 불가
    }

    const newDataLines = dataLines.map(line => {
      const cells = line.split('|').map(c => c.trim());
      const planName = cells[planIdx + 1] || '';
      const price = cells[priceIdx + 1] || '';
      let features = cells[featureIdx + 1] || '';

      // '무제한', '언리미티드' 등의 플랜인데 API 단가가 있으면 제한 텍스트 추가
      const isUnlimited = /무제한|unlimited|언리미티드/i.test(planName);
      const hasApiPrice = /API|원\/건|건당/i.test(price) || /API/i.test(features);

      if (isUnlimited && hasApiPrice) {
        // 기능 컬럼에 제한 텍스트 추가
        if (!/월 API 사용량.*제한/i.test(features)) {
          features = features.trim() + ' (월 API 사용량 10,000건 제한)';
          cells[featureIdx + 1] = features;
        }
      }

      return cells.join('|');
    });

    return [headerLine, separatorLine, ...newDataLines].join('\n') + '\n\n';
  });
}

/**
 * postProcessGeneratedDocument metadata 파라미터 타입.
 * MeetingMetadata와 호환되도록 부분 타입으로 수용 (모든 필드 optional).
 */
export type PostProcessMetadata = Partial<import('@/types').MeetingMetadata>;

/**
 * 마크다운 문서 전체 후처리
 * 생성된 문서에 대해 일관성 검증 및 수정
 *
 * 모든 단계는 멱등(idempotent)해야 함: 이미 처리된 콘텐츠를 다시 처리해도
 * 중복/이중 적용되지 않는다.
 */
export function postProcessGeneratedDocument(content: string, metadata?: PostProcessMetadata): string {
  let processed = content;

  // 1. 구독 요금제 후처리
  processed = validateAndFixBillingPlans(processed);

  // 2. 과거 연도 보정 (dateUtils.correctPastYears)
  processed = correctPastYears(processed);

  // 3. 과장 표현 자동 치환 (멱등: 치환 결과에 다시 과장어가 생기지 않는 안전한 사전)
  processed = replaceHyperbole(processed);

  // 4. 마일스톤 기간 자동 정정 (파싱 실패 시 no-op)
  processed = fixMilestoneDuration(processed);

  // 5. 1인 팀 규모 리소스 계획 검증
  if (metadata?.teamSizeType === '1인') {
    processed = ensureOnePersonResourcePlan(processed);
  }

  return processed;
}

/**
 * 과장 표현 자동 치환 (autoFix #1)
 *
 * 보수적 사전으로 과장 표현을 현실적 표현으로 치환한다.
 * - 단어가 없으면 no-op.
 * - 멱등성: 치환 결과(우변)에는 어떤 검색어(좌변)도 부분 문자열로 포함되지 않으므로
 *   다시 실행해도 추가 치환이 발생하지 않는다.
 */
export function replaceHyperbole(content: string): string {
  // [검색어, 치환어] - 검색어가 긴 것부터 처리(부분 중첩 방지: "100% 자동" 전에 "100% 보장" 등 무관하지만 순서 고정)
  const dictionary: Array<[string, string]> = [
    ['완벽히 우회', '효과적으로 대응'],
    ['완전히 우회', '완화'],
    ['원천적으로 제거', '최소화'],
    ['원천 차단', '방지'],
    // 일반 과장 표현만 (특정 도메인/명사에 의존하지 않는 범용 사전)
    ['100% 보장', '높은 수준으로 보장'],
    ['100% 자동', '대부분 자동'],
    ['100% 무인', '고도로 무인화된'],
    ['100% 차단', '대부분 차단'],
    ['완벽하게', '충분히'],
    ['완벽한', '견고한'],   // "완벽한 X" → "견고한 X" (X는 임의 명사, 도메인 무관)
    ['완벽히', '충분히'],
    ['무조건', '대부분의 경우'],
  ];

  let result = content;
  for (const [from, to] of dictionary) {
    // 정규식 메타문자 이스케이프 후 global 치환
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), to);
  }
  return result;
}

/**
 * 마일스톤 기간 자동 정정 (autoFix #2)
 *
 * 마크다운 표에서 "시작일~종료일" 형태와 "N주" 기간 셀을 찾아,
 * 실제 (종료-시작)/7 올림 값과 N이 2주 이상 차이나면 기간 셀을 실제값으로 정정한다.
 *
 * 제약:
 * - 날짜는 문자열 파싱만 사용 (new Date('YYYY-MM-DD')). 인자 없는 new Date()/Date.now() 금지.
 * - 파싱 실패하거나 형식 이탈 시 해당 행은 원본 그대로 둔다(표 손상 금지).
 * - 멱등성: 이미 올바른 기간이면 차이가 0이므로 변경하지 않는다.
 */
export function fixMilestoneDuration(content: string): string {
  const lines = content.split('\n');

  // 마크다운 표의 데이터 행만 처리 (| 로 시작/포함). 구분선(---) 및 헤더는 건드리지 않는다.
  const separatorRe = /^\s*\|?[\s:\-|]+\|?\s*$/;

  const fixedLines = lines.map((line) => {
    // 표 행 후보: 파이프 2개 이상
    if ((line.match(/\|/g) || []).length < 2) return line;
    // 구분선은 제외
    if (separatorRe.test(line)) return line;

    const cells = line.split('|');

    // 시작일~종료일 패턴을 가진 셀과 "N주" 패턴을 가진 셀을 각각 찾는다.
    // 날짜 범위: YYYY-MM-DD ~ YYYY-MM-DD (구분자 ~, -, –, —, 또는 공백)
    const dateRangeRe = /(\d{4})-(\d{2})-(\d{2})\s*[~\-–—]+\s*(\d{4})-(\d{2})-(\d{2})/;
    // 기간: 숫자 + 주 (소수 허용)
    const weekCellRe = /(\d+(?:\.\d+)?)\s*주/;

    let rangeMatch: RegExpMatchArray | null = null;
    for (const cell of cells) {
      const m = cell.match(dateRangeRe);
      if (m) {
        rangeMatch = m;
        break;
      }
    }
    if (!rangeMatch) return line;

    // 실제 주차 계산 (문자열 날짜 파싱만 사용)
    const startStr = `${rangeMatch[1]}-${rangeMatch[2]}-${rangeMatch[3]}`;
    const endStr = `${rangeMatch[4]}-${rangeMatch[5]}-${rangeMatch[6]}`;
    const startMs = Date.parse(startStr);
    const endMs = Date.parse(endStr);
    // 파싱 실패 또는 비정상 범위 → no-op
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return line;

    const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
    const actualWeeks = Math.ceil(diffDays / 7);
    if (actualWeeks <= 0) return line;

    // "N주" 셀을 찾아 정정 (첫 번째 매칭 셀만)
    let modified = false;
    const newCells = cells.map((cell) => {
      if (modified) return cell;
      const wm = cell.match(weekCellRe);
      if (!wm) return cell;
      const stated = parseFloat(wm[1]);
      if (isNaN(stated)) return cell;
      // 2주 이상 차이날 때만 정정 (멱등: 일치/근사 시 변경 없음)
      if (Math.abs(stated - actualWeeks) < 2) return cell;
      modified = true;
      // 해당 셀 내 "N주" 토큰만 교체 (나머지 셀 텍스트 보존)
      return cell.replace(weekCellRe, `${actualWeeks}주`);
    });

    if (!modified) return line;
    return newCells.join('|');
  });

  return fixedLines.join('\n');
}

/**
 * 비용 마크다운 표 검증 (검증 전용 #3 — 자동수정 안 함, 경고만 반환)
 *
 * 비용 표에서 각 행의 금액과 합계행을 파싱해, 행들의 합 vs 합계행이
 * ±5%를 넘게 다르면 경고 문자열을 반환한다.
 * - 단위(원/건/월)는 정규화하여 숫자만 추출.
 * - 파싱 실패 시 빈 배열 반환.
 * - postProcessGeneratedDocument에서 호출하지 않음 (docReviewer가 사용).
 */
export function validateBillingTable(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split('\n');

  const separatorRe = /^\s*\|?[\s:\-|]+\|?\s*$/;

  // 셀 텍스트에서 숫자(콤마/단위 제거) 추출. 추출 실패 시 null.
  const parseNumber = (text: string): number | null => {
    if (!text) return null;
    // 단위/통화/공백 제거: 원, 건, 월, 명, 개, ₩, 콤마 등
    const cleaned = text
      .replace(/[,₩\s]/g, '')
      .replace(/원|건|월|명|개|개월|회|시간|일/g, '');
    // 순수 숫자(소수 포함)만 허용
    const m = cleaned.match(/^-?\d+(?:\.\d+)?$/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return isNaN(n) ? null : n;
  };

  // 합계 키워드
  const totalKeywordRe = /합계|총계|총\s*합|소계|total|합 ?계/i;

  // 표 단위로 스캔: 연속된 표 행 블록을 찾는다.
  let i = 0;
  while (i < lines.length) {
    // 표 시작 후보: 헤더(파이프 2개+) + 다음 줄 구분선
    const isRow = (l: string) => (l.match(/\|/g) || []).length >= 2 && !separatorRe.test(l);
    if (!isRow(lines[i])) {
      i++;
      continue;
    }
    // 헤더 다음 줄이 구분선이어야 표로 인정
    if (i + 1 >= lines.length || !separatorRe.test(lines[i + 1])) {
      i++;
      continue;
    }

    const headerLine = lines[i];
    const headerCells = headerLine.split('|').map((c) => c.trim());

    // 데이터 행 수집
    const dataRows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && isRow(lines[j])) {
      dataRows.push(lines[j].split('|').map((c) => c.trim()));
      j++;
    }

    // 비용 표 판별: 헤더에 금액/비용/원가/단가/합계 관련 컬럼이 있어야 함
    const costColIdx = headerCells.findIndex((h) => /금액|비용|원가|합계 ?금액|소계|amount|cost/i.test(h));
    if (costColIdx === -1 || dataRows.length === 0) {
      i = j;
      continue;
    }

    // 합계행 vs 일반행 분리 (첫 번째 셀 또는 임의 셀에 합계 키워드가 있으면 합계행)
    let totalValue: number | null = null;
    let sumOfRows = 0;
    let countedRows = 0;
    let parseFailed = false;

    for (const row of dataRows) {
      const isTotalRow = row.some((c) => totalKeywordRe.test(c));
      const cellVal = parseNumber(row[costColIdx] ?? '');
      if (isTotalRow) {
        // 합계행: 금액 컬럼 또는 행 내 마지막 숫자 셀 사용
        if (cellVal !== null) {
          totalValue = cellVal;
        } else {
          // 금액 컬럼이 비었으면 행에서 마지막으로 파싱 가능한 숫자 사용
          for (let k = row.length - 1; k >= 0; k--) {
            const v = parseNumber(row[k]);
            if (v !== null) {
              totalValue = v;
              break;
            }
          }
        }
      } else {
        if (cellVal === null) {
          parseFailed = true;
          break;
        }
        sumOfRows += cellVal;
        countedRows++;
      }
    }

    // 합계행이 없거나, 일반행 파싱 실패, 또는 비교 대상이 부족하면 이 표는 건너뜀
    if (parseFailed || totalValue === null || countedRows === 0) {
      i = j;
      continue;
    }

    // ±5% 초과 차이 시 경고
    const denom = totalValue === 0 ? (sumOfRows === 0 ? 1 : sumOfRows) : totalValue;
    const diffRatio = Math.abs(sumOfRows - totalValue) / Math.abs(denom);
    if (diffRatio > 0.05) {
      warnings.push(
        `비용 표 합계 불일치: 행 합계 ${sumOfRows.toLocaleString()} vs 표기 합계 ${totalValue.toLocaleString()} ` +
          `(차이 ${(diffRatio * 100).toFixed(1)}%, 허용 ±5% 초과)`
      );
    }

    i = j;
  }

  return warnings;
}

/**
 * 1인 팀 규모 리소스 계획 검증
 * 리소스 계획 테이블이 1명 초과일 경우 수정
 */
function ensureOnePersonResourcePlan(content: string): string {
  // 리소스 계획 테이블 찾기
  const resourcePlanPattern = /### 11\.3 리소스 계획[\s\S]*?\n\n\|[\s\S]*?\n\n/g;

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
      lines[dataLineIndex] = '| 역할 | 인원 | 기간 | 참여율 | 주요 업무 |\n' +
        '|------|------|------|--------|-----------|\n' +
        '| 창업자(개발/기획/디자인) | 1 | 전체 | 100% | 개발/기획/디자인 전담 |';
      return lines.join('\n') + '\n\n';
    }

    return section;
  });
}
