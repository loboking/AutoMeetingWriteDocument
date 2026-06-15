/**
 * PRD 메타데이터 동적 파서
 *
 * PRD 마크다운 문서에서 핵심 기획 변수를 실시간 추출하여 JSON 상태값으로 자산화합니다.
 * - 페르소나 정보
 * - 기능 요구사항 (F-001, F-002...)
 * - 성능 제약 조건
 * - 1인 기업 여부 판별
 */

import type { PRDMetadata, Persona, FunctionalRequirement, PerformanceConstraints } from '@/types';

/**
 * PRD 마크다운에서 메타데이터를 파싱합니다.
 *
 * @param prdContent - PRD 마크다운 문자열
 * @returns PRDMetadata 객체
 */
export function parsePRDMetadata(prdContent: string): PRDMetadata {
  if (!prdContent || prdContent.length < 100) {
    return {
      personas: [],
      functionalRequirements: [],
      performanceConstraints: {},
      isOnePersonBusiness: false,
      isParsed: false,
    };
  }

  return {
    personas: extractPersonas(prdContent),
    functionalRequirements: extractFunctionalRequirements(prdContent),
    performanceConstraints: extractPerformanceConstraints(prdContent),
    isOnePersonBusiness: detectOnePersonBusiness(prdContent),
    isParsed: true,
  };
}

/**
 * PRD에서 페르소나 정보를 추출합니다.
 */
function extractPersonas(prdContent: string): Persona[] {
  const personas: Persona[] = [];

  // 정규식 패턴: 페르소나 섹션 찾기
  // "페르소나 1:", "Persona 1:", "#### 페르소나 1" 등의 패턴
  const personaSectionRegex =
    /(?:페르소나|Persona)\s*\d+\s*[:：]?\s*([^\n*]+)/gi;
  const personaMatches = [...prdContent.matchAll(personaSectionRegex)];

  if (personaMatches.length === 0) {
    // 표로 된 페르소나 정보 찾기 시도
    const tableRegex = /\|[^\n]+\|[^\n]*\n\|[\s-]+\|[\s-]+\|[\s-]+\|[\s-]+\|[\s-]+\|([\s\S]+?)\n\n/gi;
    const tableMatches = [...prdContent.matchAll(tableRegex)];

    for (const match of tableMatches) {
      const tableContent = match[1];
      const rows = tableContent.split('\n').filter((row) => row.trim() && row.startsWith('|'));

      for (const row of rows) {
        const cells = row.split('|').filter((cell) => cell.trim());
        if (cells.length >= 3) {
          const name = cells[0].trim();
          const occupation = cells[1]?.trim() || '';
          const goals = cells[2]?.trim() || '';

          if (name && name !== '이름' && name !== '페르소나') {
            personas.push({
              id: `persona-${personas.length + 1}`,
              name,
              occupation,
              goals: [goals],
              painPoints: [],
            });
          }
        }
      }
    }
  } else {
    // 일반 텍스트 페르소나 파싱
    for (let i = 0; i < personaMatches.length; i++) {
      const match = personaMatches[i];
      const personaName = match[1]?.trim() || `페르소나 ${i + 1}`;

      // 해당 페르소나 섹션의 내용 추출
      const sectionStart = match.index!;
      const nextMatch = personaMatches[i + 1];
      const sectionEnd = nextMatch ? nextMatch.index : prdContent.length;
      const sectionContent = prdContent.slice(sectionStart, sectionEnd);

      // 페르소나 상세 정보 추출
      const age = extractField(sectionContent, /연령\s*[:：]?\s*([^\n*]+)/i);
      const occupation = extractField(sectionContent, /직업\s*[:：]?\s*([^\n*]+)/i);
      const techLevel = extractField(sectionContent, /기술\s*수준\s*[:：]?\s*([^\n*]+)/i);
      const quote = extractField(sectionContent, /인용구\s*["']([^"']+)["']/i);

      // 목표와 페인 포인트 추출 (리스트 형식)
      const goals = extractListItems(sectionContent, /목표\s*[:：]?/i);
      const painPoints = extractListItems(sectionContent, /페인\s*포인트\s*[:：]?/i);

      personas.push({
        id: `persona-${i + 1}`,
        name: personaName,
        age,
        occupation: occupation || personaName,
        techLevel,
        goals,
        painPoints,
        quote,
      });
    }
  }

  return personas;
}

/**
 * PRD에서 기능 요구사항을 추출합니다.
 */
function extractFunctionalRequirements(prdContent: string): FunctionalRequirement[] {
  const requirements: FunctionalRequirement[] = [];

  // F-001, F-002 형식의 기능 ID 추출
  const funcIdRegex = /F[-\-]?\d{3}/g;
  const funcIds = [...new Set(prdContent.match(funcIdRegex) || [])];

  for (const funcId of funcIds) {
    // 해당 기능 ID 주변의 내용 추출
    const funcPattern = new RegExp(
      `${funcId}\\s*[:：]?\\s*([^\n]+)\\s*[\\n\\r]([\\s\\S]*?)(?=F[-\-]?\\d{3}|\\n###|\\n##|$)`,
      'gi'
    );
    const match = funcPattern.exec(prdContent);

    if (match) {
      const name = match[1]?.trim() || '';
      const description = match[2]?.trim().slice(0, 200) || ''; // 200자 제한

      requirements.push({
        id: funcId.replace('-', '-'), // 정규화
        name,
        description,
        priority: 'P0', // 기본값, 실제로는 파싱 필요
      });
    } else {
      // ID만 존재하는 경우
      requirements.push({
        id: funcId.replace('-', '-'),
        name: `기능 ${funcId}`,
        description: '',
        priority: 'P0',
      });
    }
  }

  // 테이블 형식의 기능 목록 추출 (Fallback)
  if (requirements.length === 0) {
    const tableRegex =
      /\|\s*F[-\-]?\d{3}\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/gi;
    const tableMatches = [...prdContent.matchAll(tableRegex)];

    for (const match of tableMatches) {
      const id = (match[0]!.match(/F[-\-]?\d{3}/) || [])[0]!.replace('-', '-');
      const name = match[1]?.trim() || '';
      const description = match[2]?.trim() || '';
      const priority = match[3]?.trim().toUpperCase() as 'P0' | 'P1' | 'P2';

      requirements.push({
        id,
        name,
        description,
        priority: priority || 'P0',
      });
    }
  }

  return requirements;
}

/**
 * PRD에서 성능 제약 조건을 추출합니다.
 */
function extractPerformanceConstraints(prdContent: string): PerformanceConstraints {
  const constraints: PerformanceConstraints = {};

  // 페이지 로딩 시간 (초 단위 → 밀리초 변환)
  const pageLoadMatch =
    /페이지\s*로딩\s*(:|시간|)?\s*(\d+(?:\.\d+)?)\s*(초|sec|s)/i.exec(prdContent);
  if (pageLoadMatch) {
    const seconds = parseFloat(pageLoadMatch[2]!);
    constraints.pageLoadTimeMs = Math.round(seconds * 1000);
  }

  // API 응답 시간
  const apiResponseMatch =
    /API\s*응답\s*(:|시간)?\s*(\d+(?:\.\d+)?)\s*(ms|밀리초)/i.exec(prdContent);
  if (apiResponseMatch) {
    constraints.apiResponseTimeMs = parseInt(apiResponseMatch[2]!, 10);
  }

  // 동시 접속자 수
  const concurrentUsersMatch = /동시\s*접속자\s*(:|수)?\s*(\d+)\s*(명|이상)/i.exec(prdContent);
  if (concurrentUsersMatch) {
    constraints.concurrentUsers = parseInt(concurrentUsersMatch[2]!, 10);
  }

  // 가용성
  const availabilityMatch = /가용성\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(prdContent);
  if (availabilityMatch) {
    constraints.availability = `${availabilityMatch[1]}%`;
  }

  // 세션 만료 시간
  const sessionTimeoutMatch =
    /세션\s*만료\s*[:：]?\s*로그인\s*후\s*(\d+)\s*(분|min|m)/i.exec(prdContent);
  if (sessionTimeoutMatch) {
    constraints.sessionTimeoutMinutes = parseInt(sessionTimeoutMatch[1]!, 10);
  }

  // 기본값 (PRD에 명시되지 않은 경우)
  if (Object.keys(constraints).length === 0) {
    constraints.pageLoadTimeMs = 2000; // 2초
    constraints.apiResponseTimeMs = 200; // 200ms
    constraints.concurrentUsers = 1000;
    constraints.availability = '99.9%';
    constraints.sessionTimeoutMinutes = 30;
  }

  return constraints;
}

/**
 * 1인 기업 여부를 판별합니다.
 */
function detectOnePersonBusiness(prdContent: string): boolean {
  // 리소스 계획 섹션 확인
  const resourceSection =
    /리소스\s*계획|비용\s*및\s*리소스|인력\s*계획/i.exec(prdContent);

  if (resourceSection) {
    const sectionStart = resourceSection.index;
    const sectionEnd = Math.min(sectionStart + 2000, prdContent.length); // 섹션 2000자 제한
    const sectionContent = prdContent.slice(sectionStart, sectionEnd).toLowerCase();

    // 1인 관련 키워드 확인
    const onePersonKeywords = ['1인', '1명', '단일', '혼자', '본인', '창업자 1', 'solo'];
    const hasOnePersonKeyword = onePersonKeywords.some((keyword) =>
      sectionContent.includes(keyword)
    );

    // 팀 규모가 명시된 경우 확인
    const teamSizeMatch = /(\d+)\s*명/.exec(sectionContent);
    if (teamSizeMatch) {
      const teamSize = parseInt(teamSizeMatch[1], 10);
      return teamSize === 1;
    }

    return hasOnePersonKeyword;
  }

  // 비용 섹션에서 인건비 확인
  const costSection = /인건비|개발\s*비용/i.exec(prdContent);
  if (costSection) {
    const sectionStart = costSection.index;
    const sectionEnd = Math.min(sectionStart + 1000, prdContent.length);
    const sectionContent = prdContent.slice(sectionStart, sectionEnd);

    // 인건비가 본인 비용만인 경우
    if (/본인\s*비용|창업자\s*비용|자기\s*비용/i.test(sectionContent)) {
      return true;
    }
  }

  return false;
}

/**
 * 정규식으로 필드 값을 추출하는 헬퍼 함수.
 */
function extractField(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[1]?.trim();
}

/**
 * 리스트 형식의 항목을 추출하는 헬퍼 함수.
 */
function extractListItems(content: string, sectionPattern: RegExp): string[] {
  const items: string[] = [];

  // 섹션 찾기
  const sectionMatch = sectionPattern.exec(content);
  if (!sectionMatch) return items;

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const nextSectionMatch = /\n\s*#{3,4}\s*\w/.exec(content.slice(sectionStart));
  const sectionEnd = nextSectionMatch
    ? sectionStart + nextSectionMatch.index
    : Math.min(sectionStart + 500, content.length);

  const sectionContent = content.slice(sectionStart, sectionEnd);

  // 리스트 항목 추출 (- 또는 *로 시작)
  const listItems = sectionContent.match(/^\s*[-*]\s+(.+)$/gm) || [];
  return listItems.map((item) => item.replace(/^\s*[-*]\s+/, '').trim());
}

/**
 * 파싱된 메타데이터를 사용자 스토리 생성 프롬프트에 주입할 문자열로 변환합니다.
 */
export function metadataToPromptInjection(metadata: PRDMetadata): string {
  if (!metadata.isParsed) {
    return '';
  }

  let injection = '\n## PRD 동기화 메타데이터\n\n';

  // 페르소나 정보
  if (metadata.personas.length > 0) {
    injection += '### 페르소나 (반드시 이 정보만 사용하세요)\n';
    injection += '| ID | 이름 | 직업 | 기술 수준 | 목표 | 페인 포인트 |\n';
    injection += '|----|------|------|-----------|------|------------|\n';
    for (const persona of metadata.personas) {
      injection += `| ${persona.id} | ${persona.name} | ${persona.occupation} | ${persona.techLevel || '-'} | ${persona.goals.join(', ')} | ${persona.painPoints.join(', ')} |\n`;
    }
    injection += '\n';
  }

  // 기능 요구사항
  if (metadata.functionalRequirements.length > 0) {
    injection += '### 기능 요구사항 (에픽 구성용)\n';
    for (const func of metadata.functionalRequirements) {
      injection += `- **${func.id}**: ${func.name} - ${func.description} (${func.priority})\n`;
    }
    injection += '\n';
  }

  // 성능 제약 조건
  injection += '### 성능 제약 조건 (인수 조건에 반드시 적용)\n';
  const perf = metadata.performanceConstraints;
  if (perf.pageLoadTimeMs) {
    injection += `- 페이지 로딩: ${perf.pageLoadTimeMs / 1000}초 이내\n`;
  }
  if (perf.apiResponseTimeMs) {
    injection += `- API 응답: ${perf.apiResponseTimeMs}ms 이하\n`;
  }
  if (perf.sessionTimeoutMinutes) {
    injection += `- 세션 만료: 로그인 후 ${perf.sessionTimeoutMinutes}분\n`;
  }
  injection += '\n';

  // 1인 기업 여부
  injection += `### 조직 규모\n`;
  injection += `- 1인 기업 여부: ${metadata.isOnePersonBusiness ? '예' : '아니오'}\n`;
  if (metadata.isOnePersonBusiness) {
    injection += '**⚠️ 주의**: 1인 기업이므로 대기업 조직 직군(데이터 분석가, 경영진 등)을 페르소나로 생성하지 마세요.\n';
  }
  injection += '\n';

  return injection;
}

/**
 * 후처리: 성능 수치를 PRD 스펙으로 정규화합니다.
 */
export function normalizePerformanceValues(
  userStoryContent: string,
  metadata: PRDMetadata
): string {
  if (!metadata.isParsed) return userStoryContent;

  let normalized = userStoryContent;

  const perf = metadata.performanceConstraints;

  // "1초 이내" → "2초 이내" (PRD 스펙에 맞춤)
  if (perf.pageLoadTimeMs) {
    const targetSeconds = perf.pageLoadTimeMs / 1000;
    // 다양한 표현 패턴
    const patterns = [
      /(\d+)\s*초\s*이내/gi,
      /(\d+)\s*seconds?\s*within/gi,
      /within\s*(\d+)\s*seconds?/gi,
    ];

    for (const pattern of patterns) {
      normalized = normalized.replace(pattern, `${targetSeconds}초 이내`);
    }

    // 구체적인 초 수치 교정 (예: 1초 → 2초)
    const secondPatterns = [
      /\b1\s*초\s*이내/g,
      /\b1\s*second/gi,
    ];
    if (targetSeconds >= 2) {
      for (const pattern of secondPatterns) {
        normalized = normalized.replace(pattern, `${targetSeconds}초 이내`);
      }
    }
  }

  // 세션 만료 시간 정규화
  if (perf.sessionTimeoutMinutes) {
    normalized = normalized.replace(
      /로그인\s*후\s*\d+\s*분/gi,
      `로그인 후 ${perf.sessionTimeoutMinutes}분`
    );
  }

  return normalized;
}
