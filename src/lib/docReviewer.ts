import type { DocType } from '@/types';

// 검토 규칙 인터페이스
interface ReviewRule {
  name: string;
  description: string;
  weight: number; // 0-1, 가중치
  check: (content: string) => { passed: boolean; score: number; issues: string[] };
}

// 검토 이슈
export interface ReviewIssue {
  category: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion?: string;
}

// 검토 결과
export interface ReviewResult {
  docType: DocType;
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  passed: boolean;
  issues: ReviewIssue[];
  summary: string;
  ruleScores: {
    rule: string;
    score: number;
    passed: boolean;
  }[];
}

// 문서별 필수 섹션
const REQUIRED_SECTIONS: Record<DocType, string[]> = {
  'prd': [
    '개요', '문제 정의', '목표', '대상 사용자',
    '기능 요구사항', '비기능 요구사항', '기술 요구사항', '릴리스 계획'
  ],
  'feature-list': ['기능 개요', '기능 목록', '우선순위'],
  'screen-list': ['화면 개요', '화면 목록', '화면 설명'],
  'ia': ['정보 구조 개요', '사이트맵', '네비게이션'],
  'flowchart': ['플로우차트', '시나리오', '예외 처리'],
  'wireframe': ['화면 구성도', '사용자 플로우', '주요 화면', '컴포넌트 구조'],
  'storyboard': ['시나리오 개요', '스토리보드 시트'],
  'user-story': ['사용자 페르소나', '에픽', '사용자 스토리', '스토리 포인트'],
  'wbs': ['프로젝트 개요', 'WBS 계층 구조', '일정 계획'],
  'api-spec': ['API 개요', '엔드포인트 목록', '데이터 모델', '에러 코드'],
  'test-plan': ['테스트 개요', '테스트 전략', '입수/퇴수 기준'],
  'test-case': ['테스트 케이스 목록', '테스트 시나리오'],
  'database': ['데이터베이스 개요', 'ERD', '테이블 명세', '인덱스'],
  'deployment': ['배포 환경', '사전 요구사항', '환경 변수', '배포 절차', '롤백 절차'],
};

// 검토 규칙 정의
const REVIEW_RULES: ReviewRule[] = [
  {
    name: '최소 길이',
    description: '문서의 최소 길이를 충족하는지 확인',
    weight: 0.15,
    check: (content) => {
      const length = content.length;
      const minLength = 1500;
      const issues: string[] = [];

      if (length < minLength) {
        issues.push(`문서 길이가 ${length}자로 최소 ${minLength}자에 미달합니다.`);
      }

      return {
        passed: length >= minLength,
        score: Math.min(length / minLength, 1) * 100,
        issues,
      };
    },
  },
  {
    name: '섹션 완성',
    description: '필수 섹션이 모두 포함되어 있는지 확인',
    weight: 0.25,
    check: (content) => {
      const issues: string[] = [];
      const lines = content.split('\n');

      // 헤딩 라인 추출 (# 으로 시작)
      const headings = lines
        .filter((line) => line.trim().startsWith('#'))
        .map((line) => line.replace(/^#+\s*/, '').trim());

      // 문서 타입을 감지
      let docType: DocType = 'prd';
      if (content.includes('API')) docType = 'api-spec';
      else if (content.includes('WBS') || content.includes('Work Breakdown')) docType = 'wbs';
      else if (content.includes('플로우차트') || content.includes('flowchart')) docType = 'flowchart';
      else if (content.includes('테스트 계획')) docType = 'test-plan';
      else if (content.includes('테스트 케이스')) docType = 'test-case';
      else if (content.includes('데이터베이스') || content.includes('ERD')) docType = 'database';
      else if (content.includes('배포')) docType = 'deployment';
      else if (content.includes('기능 목록')) docType = 'feature-list';
      else if (content.includes('화면 목록')) docType = 'screen-list';
      else if (content.includes('정보 구조') || content.includes('IA')) docType = 'ia';
      else if (content.includes('와이어프레임')) docType = 'wireframe';
      else if (content.includes('스토리보드')) docType = 'storyboard';
      else if (content.includes('사용자 스토리') || content.includes('에픽')) docType = 'user-story';

      const requiredSections = REQUIRED_SECTIONS[docType] || REQUIRED_SECTIONS.prd;
      const missingSections = requiredSections.filter(
        (section) => !headings.some((h) => h.includes(section))
      );

      if (missingSections.length > 0) {
        issues.push(`누락된 섹션: ${missingSections.join(', ')}`);
      }

      return {
        passed: missingSections.length === 0,
        score: ((requiredSections.length - missingSections.length) / requiredSections.length) * 100,
        issues,
      };
    },
  },
  {
    name: '테이블 포함',
    description: '데이터가 테이블 형식으로 구조화되어 있는지 확인',
    weight: 0.1,
    check: (content) => {
      const hasTable = content.includes('|') && content.split('\n').some((line) => line.split('|').length >= 4);
      const issues: string[] = [];

      if (!hasTable) {
        issues.push('테이블(|) 형식을 사용하여 데이터를 구조화해주세요.');
      }

      return {
        passed: hasTable,
        score: hasTable ? 100 : 0,
        issues,
      };
    },
  },
  {
    name: '다이어그램',
    description: '시각화 자료(Mermaid 다이어그램)가 포함되어 있는지 확인',
    weight: 0.1,
    check: (content) => {
      const hasMermaid = content.includes('```mermaid') || content.includes('``` mermaid');
      const issues: string[] = [];

      if (!hasMermaid) {
        issues.push('Mermaid 다이어그램을 추가하여 구조를 시각화해주세요.');
      }

      return {
        passed: hasMermaid,
        score: hasMermaid ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '구체성',
    description: '모호한 표현(TBD, 추후, 등)이 과도하게 사용되지 않았는지 확인',
    weight: 0.15,
    check: (content) => {
      const vaguePatterns = [
        /\bTBD\b/g,
        /\b추후\s+논의\b/g,
        /\b추후\s+결정\b/g,
        /\b미정\b/g,
        /\b-?\s*-?\s*-/g, // 빈 항목
      ];

      let vagueCount = 0;
      const issues: string[] = [];

      for (const pattern of vaguePatterns) {
        const matches = content.match(pattern);
        if (matches) {
          vagueCount += matches.length;
        }
      }

      // 빈 테이블 셀 확인
      const emptyCells = content.match(/\|\s*\|\s*\|/g);
      if (emptyCells) {
        vagueCount += emptyCells.length * 2;
      }

      const vagueThreshold = Math.max(5, content.length / 500);
      if (vagueCount > vagueThreshold) {
        issues.push(`모호한 표현(TBD, 미정, 빈 항목 등)이 ${vagueCount}개 발견되었습니다. 구체적인 내용으로 채워주세요.`);
      }

      return {
        passed: vagueCount <= vagueThreshold,
        score: Math.max(0, 100 - (vagueCount / vagueThreshold) * 50),
        issues,
      };
    },
  },
  {
    name: '상세성',
    description: '각 섹션이 충분히 상세하게 작성되었는지 확인',
    weight: 0.15,
    check: (content) => {
      const lines = content.split('\n');
      const sections = lines.filter((line) => line.match(/^#+\s/));

      // 섹션당 평균 라인 수
      const avgLinesPerSection = lines.length / Math.max(sections.length, 1);
      const issues: string[] = [];

      if (avgLinesPerSection < 5) {
        issues.push('각 섹션이 너무 간단합니다. 최소 5-10라인 이상의 상세한 내용을 작성해주세요.');
      }

      return {
        passed: avgLinesPerSection >= 5,
        score: Math.min(avgLinesPerSection / 5, 1) * 100,
        issues,
      };
    },
  },
  {
    name: '전문성',
    description: '전문 용어와 기술적인 내용이 포함되어 있는지 확인',
    weight: 0.1,
    check: (content) => {
      const technicalTerms = [
        'API', 'REST', 'JSON', 'SQL', 'ERD', 'WBS', 'PRD', 'UI', 'UX',
        '데이터베이스', '엔드포인트', '인증', '인가', '암호화',
        '성능', '가용성', '확장성', '마일스톤', '롤백', '배포',
      ];

      const foundTerms = technicalTerms.filter((term) => content.includes(term));
      const issues: string[] = [];

      if (foundTerms.length < 3) {
        issues.push('전문적인 용어와 기술적인 내용이 부족합니다. 관련 용어를 사용하여 작성해주세요.');
      }

      return {
        passed: foundTerms.length >= 3,
        score: Math.min(foundTerms.length / 3, 1) * 100,
        issues,
      };
    },
  },
];

// 문서 검토 함수
export function reviewDocument(docType: DocType, content: string): ReviewResult {
  const issues: ReviewIssue[] = [];
  const ruleScores: ReviewResult['ruleScores'] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const rule of REVIEW_RULES) {
    const result = rule.check(content);

    let severity: ReviewIssue['severity'] = 'low';
    if (result.score < 30) severity = 'high';
    else if (result.score < 60) severity = 'medium';

    for (const issue of result.issues) {
      issues.push({
        category: rule.name,
        severity,
        message: issue,
        suggestion: getSuggestion(rule.name),
      });
    }

    ruleScores.push({
      rule: rule.name,
      score: result.score,
      passed: result.passed,
    });

    totalWeightedScore += result.score * rule.weight;
    totalWeight += rule.weight;
  }

  const finalScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  const passed = finalScore >= 60;

  // 등급 계산
  let grade: ReviewResult['grade'] = 'F';
  if (finalScore >= 90) grade = 'A';
  else if (finalScore >= 80) grade = 'B';
  else if (finalScore >= 70) grade = 'C';
  else if (finalScore >= 60) grade = 'D';

  // 요약 생성
  const summary = generateSummary(finalScore, grade, passed, issues);

  return {
    docType,
    score: Math.round(finalScore),
    grade,
    passed,
    issues,
    summary,
    ruleScores,
  };
}

// 제안 생성
function getSuggestion(ruleName: string): string {
  const suggestions: Record<string, string> = {
    '최소 길이': '각 섹션에 구체적인 예시와 설명을 추가하여 문서를 확장해주세요.',
    '섹션 완성': '필수 섹션을 모두 작성하고, 누락된 섹션을 추가해주세요.',
    '테이블 포함': '목록, 데이터, 비교 등을 테이블 형식으로 정리해주세요.',
    '다이어그램': '구조, 흐름, 관계 등을 Mermaid 다이어그램으로 시각화해주세요.',
    '구체성': 'TBD, 미정 등을 구체적인 내용으로 대체해주세요.',
    '상세성': '각 섹션에 배경, 목적, 세부 내용, 예시 등을 추가해주세요.',
    '전문성': '관련 분야의 전문 용어와 기술적 내용을 포함해주세요.',
  };

  return suggestions[ruleName] || '항목을 개선하여 문서 품질을 높여주세요.';
}

// 요약 생성
function generateSummary(score: number, grade: ReviewResult['grade'], passed: boolean, issues: ReviewIssue[]): string {
  const highSeverityCount = issues.filter((i) => i.severity === 'high').length;
  const mediumSeverityCount = issues.filter((i) => i.severity === 'medium').length;

  let summary = `문서 품질: ${score}점 (${grade}등급)\n`;

  if (passed) {
    summary += '✅ 기준 통과\n';
  } else {
    summary += '❌ 기준 미달 - 개선 필요\n';
  }

  if (highSeverityCount > 0) {
    summary += `\n🔴 ${highSeverityCount}개의 주요 이슈가 있습니다.\n`;
  }
  if (mediumSeverityCount > 0) {
    summary += `\n🟡 ${mediumSeverityCount}개의 개선 사항이 있습니다.\n`;
  }

  return summary;
}

// 일괄 검토
export function reviewMultipleDocuments(documents: Record<string, string>): Record<string, ReviewResult> {
  const results: Record<string, ReviewResult> = {};

  for (const [docType, content] of Object.entries(documents)) {
    results[docType] = reviewDocument(docType as DocType, content);
  }

  return results;
}
