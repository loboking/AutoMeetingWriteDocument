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
    weight: 0.08,
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
    weight: 0.16,
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
    weight: 0.08,
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
    weight: 0.08,
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
    weight: 0.10,
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
    weight: 0.08,
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
    weight: 0.08,
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
  {
    name: 'AI 모델명 통일',
    description: 'AI 모델명이 일관되게 사용되었는지 확인 (GLM-5 권장)',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];
      const hasGPT4 = /GPT-?4/gi.test(content);
      const hasGLM = /GLM-?[545]/gi.test(content);
      const hasGemini = /Gemini/gi.test(content);

      if (hasGPT4 && !hasGLM) {
        issues.push('GPT-4가 명시되어 있습니다. 현재 프로젝트는 GLM-5를 사용 중입니다. 모델명을 통일해주세요.');
      }
      if (hasGemini && hasGPT4) {
        issues.push('복수의 AI 모델(GPT-4, Gemini)이 혼재되어 있습니다. 하나의 모델로 통일해주세요.');
      }

      return {
        passed: !hasGPT4 || hasGLM,
        score: (hasGPT4 && !hasGLM) ? 0 : 100,
        issues,
      };
    },
  },
  {
    name: 'DB 구조 적합성',
    description: 'SaaS/커머스에 적합한 테이블 구조인지 확인',
    weight: 0.07,
    check: (content) => {
      const issues: string[] = [];
      const hasUsersTable = /users?.*id|users\s*id/i.test(content);
      const hasOnlyPosts = /posts?.*id|posts\s*id/i.test(content);
      const hasSaaSFields = /(subscriptions|products|orders|plans).*id/i.test(content);

      if (hasUsersTable && hasOnlyPosts && !hasSaaSFields) {
        issues.push('DB 구조가 게시판 형태(users, posts)입니다. SaaS/커머스인 경우 subscriptions, products, orders 테이블이 필요합니다.');
      }

      return {
        passed: !hasOnlyPosts || hasSaaSFields,
        score: hasSaaSFields ? 100 : (hasOnlyPosts ? 30 : 100),
        issues,
      };
    },
  },
  {
    name: '수치 정합성',
    description: '인원 수, 일정 등 수치가 문서 전체에서 일치하는지 확인',
    weight: 0.08,
    check: (content) => {
      const issues: string[] = [];
      const betaTesterMatches = content.match(/베타.*?(\d+)\s*명/gi);
      const successCriteriaMatches = content.match(/테스터.*?(\d+)\s*명/gi);

      if (betaTesterMatches && successCriteriaMatches) {
        const betaNumbers = betaTesterMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
        const successNumbers = successCriteriaMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));

        for (const beta of betaNumbers) {
          for (const success of successNumbers) {
            if (beta !== success && Math.abs(beta - success) > 5) {
              issues.push(`베타 테스터 수(${beta}명)와 성공 기준(${success}명)이 일치하지 않습니다.`);
            }
          }
        }
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '세션 정책 일치',
    description: '보안 요구사항과 컴플라이언스의 세션 만료 시간이 일치하는지 확인',
    weight: 0.05,
    check: (content) => {
      const issues: string[] = [];
      const sessionMatches = content.match(/세션.*?(\d+)\s*(시간|분)/gi);

      if (sessionMatches && sessionMatches.length > 1) {
        const values = sessionMatches.map(m => {
          const num = parseInt(m.match(/\d+/)?.[0] || '0');
          const unit = m.includes('시간') ? 60 : 1; // 시간→분 변환
          return num * unit;
        });

        const uniqueValues = [...new Set(values)];
        if (uniqueValues.length > 1) {
          issues.push(`세션 만료 시간이 문서에서 서로 다르게 명시되어 있습니다 (${sessionMatches.join(', ')}). 하나로 통일해주세요.`);
        }
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 0,
        issues,
      };
    },
  },
  {
    name: '화면 구성 충실',
    description: '최소 3개 이상의 화면이 정의되어 있는지 확인',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];
      const screenSectionMatches = content.match(/화면\s*\d+[:\s]*[^\n]+/gi);

      if (screenSectionMatches && screenSectionMatches.length < 3) {
        issues.push(`화면 구성이 ${screenSectionMatches.length}개뿐입니다. 최소 3개 이상의 화면을 정의해주세요.`);
      }

      return {
        passed: !screenSectionMatches || screenSectionMatches.length >= 3,
        score: screenSectionMatches && screenSectionMatches.length >= 3 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: 'API 명세서 링크',
    description: '부록에 API 명세서 링크가 포함되어 있는지 확인',
    weight: 0.02,
    check: (content) => {
      const issues: string[] = [];
      const hasApiLink = /API.*링크.*TBD|api.*명세|\/docs\/api|API.*endpoint/i.test(content);

      if (!hasApiLink) {
        issues.push('부록에 API 명세서 링크가 누락되어 있습니다. 15.2절에 "[API 명세서 링크: TBD 또는 /docs/api]"를 추가해주세요.');
      }

      return {
        passed: hasApiLink,
        score: hasApiLink ? 100 : 0,
        issues,
      };
    },
  },
  {
    name: '용어 일관성',
    description: '문서 전체에서 용어가 일관되게 사용되는지 확인',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];

      // "사용자" vs "유저" 혼용 체크
      const hasUser = /사용자/gi.test(content);
      const hasUserKorean = /유저/gi.test(content);
      if (hasUser && hasUserKorean) {
        issues.push('"사용자"와 "유저"가 혼용되어 있습니다. 하나로 통일해주세요.');
      }

      // "원" vs "원화" 혼용 체크
      const wonMatches = content.match(/(\d+)\s*원/g);
      const wonHwaMatches = content.match(/(\d+)\s*원화/g);
      if (wonMatches && wonHwaMatches && wonMatches.length > 2 && wonHwaMatches.length > 0) {
        issues.push('"원"과 "원화"가 혼용되어 있습니다. 하나로 통일해주세요.');
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 70,
        issues,
      };
    },
  },
  {
    name: '회의 요약록 스타일 감지',
    description: 'PRD가 회의 요약록 스타일로 작성되지 않았는지 확인',
    weight: 0.06,
    check: (content) => {
      const issues: string[] = [];
      const passiveVoicePatterns = [
        /회의\s+(?:에서|에서는)\s*(?:논의|토론|결정)/gi,
        /(?:논의|토론|결정)\s*된\s*것\s*으로/gi,
        /(?:논의|토론)\s*결과/gi,
      ];

      let passiveCount = 0;
      for (const pattern of passiveVoicePatterns) {
        const matches = content.match(pattern);
        if (matches) {
          passiveCount += matches.length;
        }
      }

      const threshold = Math.max(3, content.length / 1000);
      if (passiveCount > threshold) {
        issues.push(`회의 요약록 스타일의 수동태 표현이 ${passiveCount}건 발견되었습니다. PRD는 "우리는 ~를 구현한다"와 같은 능동태로 작성해주세요.`);
      }

      return {
        passed: passiveCount <= threshold,
        score: passiveCount <= threshold ? 100 : 40,
        issues,
      };
    },
  },
  {
    name: 'SaaS 필수 요소 포함',
    description: 'SaaS 제품인 경우 필수 요소가 포함되어 있는지 확인',
    weight: 0.06,
    check: (content) => {
      const issues: string[] = [];
      const isSaaS = /SaaS|구독|결제|플랜|크레딧|월.*구독/gi.test(content);

      if (isSaaS) {
        const essentialElements = [
          /다중\s*테넌트|tenant_id|데이터\s*격리/gi,
          /API\s*키|암호화|인증|JWT/gi,
          /결제|과금|환불|영수증/gi,
          /백오피스|관리자|대시보드|admin/gi,
        ];

        const missingElements = [];
        for (const element of essentialElements) {
          if (!element.test(content)) {
            missingElements.push(element.source.replace(/\\s\*/g, ' '));
          }
        }

        if (missingElements.length > 0) {
          issues.push(`SaaS 제품이지만 필수 요소가 누락되었습니다: ${missingElements.join(', ')}`);
        }
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '섹션별 최소 길이',
    description: '각 섹션이 최소 200자 이상인지 확인',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];
      const lines = content.split('\n');
      const sections: { title: string; start: number; end: number }[] = [];

      // 섹션 추출 (##으로 시작하는 헤딩)
      let currentSection: { title: string; start: number } | null = null;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^##+\s+(.+)$/);
        if (match) {
          if (currentSection) {
            sections.push({ ...currentSection, end: i });
          }
          currentSection = { title: match[1], start: i + 1 };
        }
      }
      if (currentSection) {
        sections.push({ ...currentSection, end: lines.length });
      }

      // 각 섹션 길이 확인
      const shortSections: string[] = [];
      for (const section of sections) {
        const sectionContent = lines.slice(section.start, section.end).join('\n');
        const length = sectionContent.replace(/\s/g, '').length;
        if (length < 200 && !section.title.includes('부록') && !section.title.includes('용어')) {
          shortSections.push(`${section.title}(${length}자)`);
        }
      }

      if (shortSections.length > 0) {
        issues.push(`다음 섹션이 너무 짧습니다 (최소 200자 권장): ${shortSections.join(', ')}`);
      }

      return {
        passed: shortSections.length === 0,
        score: Math.max(0, 100 - shortSections.length * 20),
        issues,
      };
    },
  },
  {
    name: '페르소나 구체성',
    description: '사용자 페르소나가 구체적으로 작성되었는지 확인',
    weight: 0.05,
    check: (content) => {
      const issues: string[] = [];
      const personaSection = content.match(/##[##\s]*5\.?\s*[대상 사용자|페르소나|Target Users]/i);

      if (personaSection) {
        const sectionStart = content.indexOf(personaSection[0]);
        const sectionEnd = content.indexOf('##', sectionStart + 10);
        const sectionContent = content.substring(sectionStart, sectionEnd > 0 ? sectionEnd : content.length);

        // 구체적 정보 포함 여부 확인
        const hasAge = /\d{2}\s*(세|년생)/i.test(sectionContent);
        const hasLocation = /(거주지|지역|도시|시)/i.test(sectionContent);
        const hasQuote = /["'].*["'].*인용구|목소리/i.test(sectionContent);
        const hasGoal = /\d+\s*(만원|원|VND|USD|명|%)/i.test(sectionContent);

        const missingElements = [];
        if (!hasAge) missingElements.push('연령');
        if (!hasLocation) missingElements.push('거주지');
        if (!hasQuote) missingElements.push('인용구');
        if (!hasGoal) missingElements.push('구체적 목표(수치)');

        if (missingElements.length > 0) {
          issues.push(`페르소나에 누락된 정보: ${missingElements.join(', ')}`);
        }
      } else {
        issues.push('사용자 페르소나 섹션(5절)을 찾을 수 없습니다.');
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: 'ERD 포함',
    description: '데이터베이스 ERD 다이어그램이 포함되어 있는지 확인',
    weight: 0.06,
    check: (content) => {
      const issues: string[] = [];
      const hasERD = /```mermaid[\s\S]*erDiagram/.test(content);
      const hasDBSection = /##[##\s]*9\.?\s*.*[DB|데이터베이스|Database]/i.test(content);

      if (!hasERD) {
        if (hasDBSection) {
          issues.push('DB 설계 섹션이 있지만 ERD(Mermaid)가 누락되었습니다. 9.3절에 ERD를 추가해주세요.');
        } else {
          issues.push('DB 설계 섹션(9.3절)과 ERD가 누락되었습니다.');
        }
      }

      return {
        passed: hasERD,
        score: hasERD ? 100 : 0,
        issues,
      };
    },
  },
  {
    name: '보안 섹션 상세성',
    description: 'SaaS 보안 요구사항이 상세하게 작성되었는지 확인',
    weight: 0.06,
    check: (content) => {
      const issues: string[] = [];
      const securitySection = content.match(/##[##\s]*7\.?\s*[2|2\.| ]*.*[보안|Security]/i);

      if (securitySection) {
        const sectionStart = content.indexOf(securitySection[0]);
        const nextSection = content.indexOf('##', sectionStart + 10);
        const sectionContent = content.substring(sectionStart, nextSection > 0 ? nextSection : content.length);

        // SaaS 보안 필수 요소 확인
        const requiredElements = [
          { pattern: /다중\s*테넌트|tenant.*id|Row.*Level.*Security|RLS/i, name: '다중 테넌트 격리' },
          { pattern: /API.*키.*암호화|AES.*256|토큰.*암호화/i, name: 'API 키 암호화' },
          { pattern: /세션.*30분|세션.*만료.*30/i, name: '세션 만료(30분)' },
          { pattern: /감사.*로그|audit.*log|접속.*기록/i, name: '감사 로그' },
          { pattern: /Rate.*Limit|API.*호출.*제한|속도.*제한/i, name: 'Rate Limiting' },
        ];

        const missingElements = requiredElements.filter(element => !element.pattern.test(sectionContent));

        if (missingElements.length > 0) {
          issues.push(`보안 섹션에 누락된 SaaS 필수 요소: ${missingElements.map(e => e.name).join(', ')}`);
        }
      } else {
        issues.push('보안 요구사항 섹션(7.2절)을 찾을 수 없습니다.');
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '핵심 지표 수치 일관성',
    description: '같은 표준 지표(ARPU/MRR/객단가/전환율/이탈률)가 문서 전체에서 단일 값으로 쓰였는지 확인',
    weight: 0.05,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }
      // 지표명 뒤 0~12자 내 "숫자(,포함)+원/%" 형태 값을 수집해, 한 지표에 2개 이상 서로 다른 값이면 모순
      const metrics = ['ARPU', 'MRR', 'ARR', '객단가', '전환율', '이탈률', 'LTV', 'CAC'];
      let contradictions = 0;
      for (const metric of metrics) {
        const re = new RegExp(`${metric}[^0-9%]{0,12}?([\\d,]+)\\s*(원|%)`, 'g');
        const values = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          values.add(`${m[1].replace(/,/g, '')}${m[2]}`);
        }
        if (values.size >= 2) {
          contradictions++;
          issues.push(`'${metric}' 지표가 문서에서 서로 다른 값(${[...values].join(', ')})으로 나타납니다. 하나의 값으로 통일하세요.`);
        }
      }
      return {
        passed: contradictions === 0,
        score: contradictions === 0 ? 100 : Math.max(30, 100 - contradictions * 25),
        issues,
      };
    },
  },
  {
    name: '과장 표현 탐지',
    description: '입증 불가능한 단정 표현(완벽/원천 차단/100% 등)이 사용되지 않았는지 확인',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }

      const exaggerationPattern = /완벽(히|하게)?|원천\s*차단|100%\s*(보장|차단|우회)|무조건|절대\s*안|완전히\s*우회/g;
      const matches = content.match(exaggerationPattern);
      const count = matches ? matches.length : 0;

      if (count > 0) {
        issues.push(`입증 불가능한 단정 표현(완벽/원천 차단/100% 등)이 ${count}곳 발견되었습니다. 측정 가능한 한정적 표현으로 바꾸세요.`);
      }

      return {
        passed: count === 0,
        score: count === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '기능 순환 의존성',
    description: '기능 의존성에 순환 참조(F-A↔F-B)가 없는지 확인',
    weight: 0.03,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }

      // 각 줄에서 기능 ID(F-숫자)와 그 줄에 명시된 의존 기능(F-숫자) 추출
      // 의존 컬럼/표현이 있는 줄만 대상으로 보수적으로 그래프 구성
      const graph = new Map<string, Set<string>>();
      const lines = content.split('\n');

      for (const line of lines) {
        // 줄에 "의존" 단서가 있어야 의존 관계로 간주 (false positive 방지)
        if (!/의존/.test(line)) continue;

        const ids = line.match(/F-\d+/g);
        if (!ids || ids.length < 2) continue;

        const source = ids[0];
        // 첫 ID를 기능 주체로 보고, "의존" 키워드 이후의 ID들을 의존 대상으로 추출
        const depPart = line.slice(line.indexOf('의존'));
        const depTargets = depPart.match(/F-\d+/g);
        if (!depTargets) continue;

        if (!graph.has(source)) graph.set(source, new Set());
        for (const target of depTargets) {
          if (target !== source) {
            graph.get(source)!.add(target);
          }
        }
      }

      if (graph.size === 0) {
        return { passed: true, score: 100, issues };
      }

      // DFS로 사이클 검출
      const WHITE = 0, GRAY = 1, BLACK = 2;
      const colors = new Map<string, number>();
      const cyclePairs = new Set<string>();
      const parent = new Map<string, string>();

      const dfs = (node: string) => {
        colors.set(node, GRAY);
        const neighbors = graph.get(node);
        if (neighbors) {
          for (const next of neighbors) {
            const c = colors.get(next) ?? WHITE;
            if (c === WHITE) {
              parent.set(next, node);
              dfs(next);
            } else if (c === GRAY) {
              // back-edge → 사이클. 보수적으로 직접/근접 두 노드를 경고
              const a = node < next ? node : next;
              const b = node < next ? next : node;
              cyclePairs.add(`${a} ↔ ${b}`);
            }
          }
        }
        colors.set(node, BLACK);
      };

      for (const node of graph.keys()) {
        if ((colors.get(node) ?? WHITE) === WHITE) {
          dfs(node);
        }
      }

      if (cyclePairs.size > 0) {
        for (const pair of cyclePairs) {
          issues.push(`기능 의존성에 순환 참조가 있습니다: ${pair}. 의존 방향을 단방향으로 정리하세요.`);
        }
      }

      return {
        passed: cyclePairs.size === 0,
        score: cyclePairs.size === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: 'KPI-콘셉트 불정합',
    description: '비즈니스 모델(1인/무인/비SaaS)과 KPI 지표(MAU)가 정합한지 확인',
    weight: 0.03,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }

      const hasMau = /MAU|월간\s*활성\s*사용자/i.test(content);
      const isNonSaaS = /1인|무인|SaaS\s*아님|SaaS\s*형태[\s\S]{0,10}?아닙니다/i.test(content);

      if (hasMau && isNonSaaS) {
        issues.push('이 사업은 SaaS/가입형이 아닌데 MAU 지표를 사용 중입니다. 매출·주문 건수 등 비즈니스 모델에 맞는 지표로 교체하세요.');
      }

      return {
        passed: !(hasMau && isNonSaaS),
        score: hasMau && isNonSaaS ? 50 : 100,
        issues,
      };
    },
  },
  {
    name: '컴플라이언스/PII 누락',
    description: '크롤링/자동등록 및 개인정보 처리에 대한 리스크·정책이 다뤄졌는지 확인',
    weight: 0.04,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }

      // 1) 자동 크롤링/등록 기능 → 플랫폼 약관 리스크 언급 여부
      const hasAutomation = /크롤링|스크래핑|자동\s*등록|자동\s*게시/.test(content);
      const hasTosMention = /약관|ToS|플랫폼\s*정책/i.test(content);
      if (hasAutomation && !hasTosMention) {
        issues.push('자동 크롤링/등록 기능이 있으나 플랫폼 약관 위반 리스크가 다뤄지지 않았습니다.');
      }

      // 2) 개인정보 취급 → PII 처리 정책 언급 여부
      const hasPii = /개인정보|이름|주소|연락처|구매자명|buyer/i.test(content);
      const hasPiiPolicy = /개인정보|PII|암호화|보관기간/i.test(content);
      if (hasPii && !hasPiiPolicy) {
        issues.push('개인정보를 다루나 PII 처리 정책(보관기간/암호화/파기)이 누락되었습니다.');
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
  {
    name: '마일스톤 기간-날짜 정합',
    description: '마일스톤의 명시된 주(N주)와 시작~종료일이 정합한지 확인',
    weight: 0.03,
    check: (content) => {
      const issues: string[] = [];
      if (!isPrdContent(content)) {
        return { passed: true, score: 100, issues };
      }

      const lines = content.split('\n');
      for (const line of lines) {
        // "N주"와 두 날짜(YYYY-MM-DD)가 같은 줄에 있어야 비교 (보수적)
        const weekMatch = line.match(/(\d+)\s*주/);
        const dateMatches = line.match(/\d{4}-\d{2}-\d{2}/g);
        if (!weekMatch || !dateMatches || dateMatches.length < 2) continue;

        const declaredWeeks = parseInt(weekMatch[1], 10);
        const startMs = new Date(dateMatches[0]).getTime();
        const endMs = new Date(dateMatches[1]).getTime();
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
        if (endMs < startMs) continue;

        const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
        const actualWeeks = Math.ceil(diffDays / 7);

        if (Math.abs(actualWeeks - declaredWeeks) >= 2) {
          issues.push(`마일스톤 기간(${declaredWeeks}주)과 시작~종료일이 불일치합니다(실제 약 ${actualWeeks}주).`);
        }
      }

      return {
        passed: issues.length === 0,
        score: issues.length === 0 ? 100 : 50,
        issues,
      };
    },
  },
];

// PRD 문서 여부 휴리스틱 (check 함수가 docType을 받지 않으므로 본문으로 가드)
function isPrdContent(content: string): boolean {
  return /PRD/i.test(content)
    || /제품\s*요구사항/.test(content)
    || (/기능\s*요구사항/.test(content) && /비기능\s*요구사항/.test(content));
}

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
    'AI 모델명 통일': 'AI 모델명을 프로젝트 표준(GLM-5)으로 통일해주세요.',
    'DB 구조 적합성': 'SaaS/커머스에 맞는 테이블 구조(subscriptions, products, orders)로 설계해주세요.',
    '수치 정합성': '베타 테스터 수, 일정 등 수치가 문서 전체에서 일치하는지 확인해주세요.',
    '세션 정책 일치': '보안 요구사항과 컴플라이언스의 세션 만료 시간을 통일해주세요.',
    '화면 구성 충실': '최소 3개 이상의 화면을 상세하게 정의해주세요.',
    'API 명세서 링크': '부록 15.2절에 API 명세서 링크를 추가해주세요.',
    '용어 일관성': '문서 전체에서 용어(사용자/유저, 원/원화 등)를 일관되게 사용해주세요.',
    '회의 요약록 스타일 감지': 'PRD는 회의 요약록이 아닙니다. "우리는 ~를 구현한다"와 같은 능동태로 작성해주세요.',
    'SaaS 필수 요소 포함': 'SaaS 제품의 경우 다중 테넌트, 결제, 보안, 백오피스를 반드시 포함해주세요.',
    '섹션별 최소 길이': '각 섹션은 최소 200자 이상 상세하게 작성해주세요.',
    '페르소나 구체성': '페르소나에 연령, 거주지, 인용구, 구체적 목표(수치 포함)를 모두 포함해주세요.',
    'ERD 포함': '9.3절 데이터베이스 설계에 Mermaid ERD 다이어그램을 추가해주세요.',
    '보안 섹션 상세성': '보안 섹션(7.2절)에 다중 테넌트, API 암호화, 세션 만료, 감사 로그를 포함해주세요.',
    '과장 표현 탐지': '완벽/원천 차단/100% 등 단정 표현을 측정 가능한 한정적 표현(예: "오탐률 X% 이하 목표")으로 바꿔주세요.',
    '기능 순환 의존성': '기능 간 의존 방향을 단방향으로 정리하여 순환 참조를 제거해주세요.',
    'KPI-콘셉트 불정합': '비즈니스 모델에 맞는 지표(매출, 주문 건수 등)로 KPI를 교체해주세요.',
    '컴플라이언스/PII 누락': '플랫폼 약관 위반 리스크와 PII 처리 정책(보관기간/암호화/파기)을 명시해주세요.',
    '마일스톤 기간-날짜 정합': '마일스톤의 주(N주)와 시작~종료일이 일치하도록 일정을 정정해주세요.',
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
