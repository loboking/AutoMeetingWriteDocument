// 회의 요약/녹취에서 PRD 품질 가드용 경량 메타데이터를 추론한다.
// LLM 호출 없이 키워드 휴리스틱으로 conceptType/coreMetrics/complianceRisks/teamSize를 채워
// 섹션 프롬프트의 KPI 분기·컴플라이언스·수치 일관성 가드를 작동시킨다.
import type { MeetingSummary, MeetingMetadata, ConceptType, TeamSizeType } from '@/types';

function detectConceptType(text: string): ConceptType {
  // 커머스: 일반 커머스 개념어만 사용(특정 플랫폼/업계 고유명사 배제 → 범용성)
  if (/판매|주문|배송|상품|마진|재고|이커머스|커머스|쇼핑|장바구니|결제\s*금액|객단가|소싱|물류/.test(text)) {
    return 'commerce';
  }
  // SaaS: 구독/요금제/MAU/saas/플랜
  if (/구독|요금제|saas|플랜|월정액|라이선스|시트당/i.test(text)) return 'saas';
  // 마켓플레이스: 중개/매칭/판매자.구매자
  if (/마켓플레이스|중개|매칭.*수수료|판매자.*구매자/.test(text)) return 'marketplace';
  // 커뮤니티
  if (/커뮤니티|게시판|소셜|피드.*팔로/.test(text)) return 'community';
  return 'web';
}

function detectTeamSize(text: string): { teamSize: number; teamSizeType: TeamSizeType } {
  if (/1인|혼자|개인\s*개발|솔로|단독\s*운영|무인/.test(text)) return { teamSize: 1, teamSizeType: '1인' };
  if (/2\s*~?\s*5인|소규모\s*팀|소형\s*팀/.test(text)) return { teamSize: 3, teamSizeType: '2-5인' };
  return { teamSize: 0, teamSizeType: '2-5인' }; // 미상 시 보수적 기본(가드 약하게)
}

function detectComplianceRisks(text: string): string[] {
  const risks: string[] = [];
  if (/크롤링|스크래핑|자동\s*등록|자동\s*게시|봇/.test(text)) risks.push('플랫폼 약관 준수(크롤링/자동 등록)');
  if (/개인정보|이름|주소|연락처|구매자|회원가입|로그인/.test(text)) risks.push('개인정보보호(PII 처리)');
  if (/결제|정산|페이먼트|pg|환불/i.test(text)) risks.push('결제/정산 규정');
  if (/해외|수출|수입|통관|세관|관세|vat|국제\s*배송|크로스보더/i.test(text)) risks.push('세관/통관 및 현지 법규');
  return risks;
}

// 비용/가격/마진 등 "돈·비율 관련 핵심 수치"만 라벨과 함께 추출.
// 버전번호(3.0)·연도(2026년)·해상도(30fps)·시간(30초) 등은 핵심 수치가 아니므로 제외 → 오인 방지.
// 단위는 통화(원/달러/$)·비율(%)만 허용해 범용 도메인에서도 안전하게 동작.
function detectCoreMetrics(text: string): Record<string, string> {
  const metrics: Record<string, string> = {};
  // 라벨 + 값 + (원|달러|$|%) 패턴. 라벨은 비용/가격/마진 의미를 담은 것만.
  const re = /([가-힣A-Za-z]{2,12})\s*(?:는|은|이|가|:|=)?\s*(?:약\s*)?([\d,]+(?:\.\d+)?)\s*(원|달러|%|USD)/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(text)) !== null && count < 10) {
    const label = m[1].trim();
    const value = `${m[2]}${m[3]}`;
    // 비용/가격/금액/단가/마진/수수료/매출/예산 등 '돈 관련 라벨'만 채택
    const isMoneyLabel = /원가|단가|가격|비용|금액|마진|수수료|매출|예산|배송비|월\s*비용|요금/.test(label);
    // 일반어/지시어 라벨 제외
    if (/목표|현재|이상|이하|최소|최대|약|전체|평균/.test(label)) continue;
    if (!isMoneyLabel) continue;
    if (!metrics[label]) {
      metrics[label] = value;
      count++;
    }
  }
  return metrics;
}

export function inferMetadata(summary: MeetingSummary, transcript: string): MeetingMetadata {
  const text = [
    summary.overview,
    ...(summary.keyPoints || []),
    ...(summary.decisions || []),
    transcript,
  ].join(' ');

  const conceptType = detectConceptType(text);
  const { teamSize, teamSizeType } = detectTeamSize(text);
  const complianceRisks = detectComplianceRisks(text);
  const coreMetrics = detectCoreMetrics(text);
  const isSaaS = conceptType === 'saas';

  return {
    teamSize,
    teamSizeType,
    budgetType: '자체',
    isSaaS,
    hasPayment: /결제|정산|페이먼트|pg|환불/i.test(text),
    targetUsersCount: 0,
    hasMobileApp: /모바일|앱|ios|android/i.test(text),
    hasDatabase: true,
    hasAuth: /로그인|인증|회원가입|jwt|oauth/i.test(text),
    confidence: 'medium',
    conceptType,
    coreMetrics: Object.keys(coreMetrics).length > 0 ? coreMetrics : undefined,
    complianceRisks: complianceRisks.length > 0 ? complianceRisks : undefined,
  };
}
