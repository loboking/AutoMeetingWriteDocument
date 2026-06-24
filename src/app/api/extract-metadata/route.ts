import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import type { MeetingMetadata } from '@/types';
import { llmComplete } from '@/lib/llm';

export const runtime = 'nodejs';

/**
 * Stage 1: 회의록에서 핵심 메타데이터 추출
 *
 * 추출 정보:
 * - 팀 규모 (1인 / 소형 / 중형 / 대형)
 * - 예산 타입 (무료 / 자체 / 투자)
 * - SaaS 여부
 * - 결제 기능 포함 여부
 * - 타겟 사용자 수
 * - 모바일 앱 포함 여부
 */
async function extractMetadata(transcript: string): Promise<MeetingMetadata> {
  const currentYear = new Date().getFullYear();

  const prompt = `당신은 회의록 분석 전문가입니다. 다음 회의 녹취록을 분석하여 **핵심 제약조건**을 JSON으로 추출하세요.

## 회의 녹취록
\`\`\`
${transcript}
\`\`\`

## 추출 항목

1. **teamSize** (number): 팀 규모 (명)
   - 1명 = 1, 2-5명 = 3, 6-10명 = 8, 11명 이상 = 15
   - 회의에서 언급된 "1인", "우리 둘", "팀원들", "여러 명" 등의 표현을 기반으로 추정

2. **teamSizeType** (string): "1인" | "2-5인" | "6-10인" | "11인 이상"

3. **budgetType** (string): "무료" | "자체" | "투자"
   - "무료": 개인 프로젝트, 오픈소스, 학습 목적
   - "자체": 자체 예산, 회사 내부 프로젝트
   - "투자": VC 투자, 스타트업, 외부 자금

4. **estimatedBudget** (string, optional): 추정 예산 (예: "500만원", "1억원", "무료")
   - 회의에서 언급된 구체적인 금액이나 범위

5. **isSaaS** (boolean): SaaS 제품 여부
   - 구독형, 월 결제, 다중 테넌트, 계정 시스템 등이 있으면 true

6. **hasPayment** (boolean): 결제 기능 포함 여부
   - 결제 gateway, 과금, 환불, 영수증 등이 언급되면 true

7. **targetUsersCount** (number): 타겟 사용자 수 (예상)
   - MAU, DAU, 사용자 규모 등에서 추정

8. **hasMobileApp** (boolean): 모바일 앱 포함 여부
   - iOS, Android, 모바일 앱 언급 시 true

9. **hasDatabase** (boolean): 데이터베이스 사용 여부
   - DB 설계, ERD, 데이터 저장 등이 언급되면 true

10. **hasAuth** (boolean): 인증/인가 기능 포함 여부
    - 로그인, 회원가입, JWT 등이 언급되면 true

11. **confidence** (string): "high" | "medium" | "low"
    - high: 회의에서 명확하게 언급됨
    - medium: 일부 언급되거나 유추 가능
    - low: 언급 없어 추정 필요

## 추출 원칙
- 회의에서 **명확하게 언급된 내용**을 최우선으로 반영하세요.
- 언급이 없으면 **프로젝트 맥락에서 합리적으로 추정**하세요.
- "추정 필요", "TBD" 대신 **합리적인 기본값**을 제시하세요.
- 연도는 ${currentYear}년 기준으로 작업하세요.

## 출력 형식 (JSON만 반환)
\`\`\`json
{
  "teamSize": 1,
  "teamSizeType": "1인",
  "budgetType": "무료",
  "estimatedBudget": "0원",
  "isSaaS": false,
  "hasPayment": false,
  "targetUsersCount": 100,
  "hasMobileApp": false,
  "hasDatabase": true,
  "hasAuth": true,
  "confidence": "medium"
}
\`\`\`

분석하여 JSON만 반환해주세요.`;

  try {
    const { text } = await llmComplete({
      prompt,
      maxTokens: 4096,
      temperature: 0.3, // 낮은 온도로 일관성 확보 (OpenAI호환 전용)
      timeoutMs: 60000,
    });
    const content = text || '{}';

    // JSON 파싅
    const cleanedContent = content.replace(/[\x00-\x1F\x7F]/g, ' ');
    const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const metadata = JSON.parse(jsonMatch[0]) as MeetingMetadata;

        // 검증: 필수 필드 확인
        if (typeof metadata.teamSize !== 'number') {
          metadata.teamSize = 1;
        }
        if (!metadata.teamSizeType) {
          metadata.teamSizeType = '1인';
        }
        if (!metadata.budgetType) {
          metadata.budgetType = '무료';
        }
        if (typeof metadata.isSaaS !== 'boolean') {
          metadata.isSaaS = false;
        }
        if (typeof metadata.hasPayment !== 'boolean') {
          metadata.hasPayment = false;
        }
        if (typeof metadata.targetUsersCount !== 'number') {
          metadata.targetUsersCount = 100;
        }
        if (typeof metadata.hasMobileApp !== 'boolean') {
          metadata.hasMobileApp = false;
        }
        if (typeof metadata.hasDatabase !== 'boolean') {
          metadata.hasDatabase = true;
        }
        if (typeof metadata.hasAuth !== 'boolean') {
          metadata.hasAuth = true;
        }
        if (!metadata.confidence) {
          metadata.confidence = 'medium';
        }

        console.log('[extract-metadata] 추출 완료:', metadata);
        return metadata;
      } catch (e) {
        console.error('[extract-metadata] JSON 파싱 실패:', e);
      }
    }

    // 파싱 실패 시 기본값 반환
    return getDefaultMetadata();
  } catch (error) {
    console.error('[extract-metadata] API 오류:', error);
    return getDefaultMetadata();
  }
}

// 기본 메타데이터
function getDefaultMetadata(): MeetingMetadata {
  return {
    teamSize: 1,
    teamSizeType: '1인',
    budgetType: '무료',
    estimatedBudget: '0원',
    isSaaS: false,
    hasPayment: false,
    targetUsersCount: 100,
    hasMobileApp: false,
    hasDatabase: true,
    hasAuth: true,
    confidence: 'low',
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const { transcript } = await request.json();

    if (!transcript) {
      return NextResponse.json(
        { error: 'transcript가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('[extract-metadata] 요청 수신, transcript 길이:', transcript.length);

    const metadata = await extractMetadata(transcript);

    return NextResponse.json({ metadata });
  } catch (error) {
    console.error('[extract-metadata] API 오류:', error);
    return NextResponse.json(
      { error: '메타데이터 추출에 실패했습니다.' },
      { status: 500 }
    );
  }
}
