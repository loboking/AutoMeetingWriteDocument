import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { llmComplete } from '@/lib/llm';

export const runtime = 'nodejs';
// 단일 LLM 호출이지만 입력(문서 본문)이 길 수 있어 300초(Vercel 상한)로 맞춤.
// generate-doc/summarize/synthesize-notes 라우트와 동일.
export const maxDuration = 300;

// 한국어 출력 강제 시스템 프롬프트 — synthesize-notes/route.ts와 동일 텍스트.
// cutScope: import가 아닌 복사(단일 출처 분리 — 두 라우트는 독립 배포/수명주기).
const KOREAN_OUTPUT_SYSTEM_PROMPT =
  '당신은 한국 기업의 시니어 PM/기획자입니다. 모든 출력은 반드시 한국어(한글)로 작성합니다. ' +
  '영어 단어는 고유명사(제품명, 회사명, 기술 스택명 - 예: React, Next.js, AWS), ' +
  '업계 표준 약어(API, DB, UI, UX, KPI, MAU, PRD, CRUD 등), 코드/명령어/식별자에만 허용합니다. ' +
  '그 외 일반 명사, 동사, 형용사, 설명문은 모두 한국어로 작성하세요. ' +
  '예: "user" → "사용자", "feature" → "기능", "implement" → "구현", "process" → "처리", "manage" → "관리". ' +
  '문장은 자연스러운 한국어 어순과 어미를 사용하고, 어색한 직역체나 중국어식 표현을 피하세요. ' +
  '절대 중국어 한자나 일본어 가나를 섞지 마세요 (예: "上述"→"위에서 언급한", "心理"→"심리"). 모든 한자어는 한글로만 표기합니다. ' +
  '마크다운 표/제목/리스트의 항목명도 한국어로 작성합니다.';

export interface QualityIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  message: string;
}

interface QualityBody {
  docType: string; // 'meeting-note' | 'prd' | 문서 키
  content: string; // 검증 대상 문서 본문
  context?: string; // 추가 맥락(회의 제목 등)
}

// 실패사유 머신코드. 클라이언트가 "검증 불가, 나중에 재시도" 안내에 사용.
type QCErrorReason = '429' | 'timeout' | 'empty' | 'no-key' | 'network' | 'error';

function classifyQcError(error: unknown): QCErrorReason {
  if (!error) return 'error';
  const e = error as { status?: number; name?: string; message?: string };
  if (e.status === 429) return '429';
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
  if (typeof e.message === 'string') {
    if (e.message.includes('timeout') || e.message.includes('Timeout')) return 'timeout';
    if (e.message === '빈 응답' || e.message.includes('empty')) return 'empty';
    if (e.message.includes('API key') || e.message.includes('no-key')) return 'no-key';
  }
  return 'error';
}

// 문서 종류(docType) → 분석 라벨. 사용자 친화적 한국어.
function docTypeLabel(docType: string): string {
  switch (docType) {
    case 'meeting-note':
      return '회의록';
    case 'prd':
      return 'PRD(제품 요구사항 정의서)';
    default:
      return '문서';
  }
}

// LLM 품질 검증. 결과로 QualityIssue[] 반환(이슈 0건이면 검증 통과).
// 프롬프트는 JSON 배열만 반환하도록 강제. 빈 응답/파싱 실패 시 throw.
async function runQualityCheck(body: QualityBody): Promise<QualityIssue[]> {
  const label = docTypeLabel(body.docType);
  const prompt = `당신은 한국 기업의 시니어 PM/기획 리뷰어입니다. 다음 ${label}을 분석해 품질 이슈를 찾아주세요.

## 분석 대상 ${label}
\`\`\`
${body.content}
\`\`\`

${body.context ? `## 추가 맥락\n${body.context}` : ''}

## 분석 항목 (중복 가능)
1. **논리적 모순**: 서로 충돌하는 내용, 앞뒤가 안 맞는 서술
2. **누락된 핵심 정보**: ${label}에 있어야 할 정보가 빠진 경우 (예: 회의록 — 의사결정/담당자/기한, PRD — 순마진 목표/타겟/KPI/일정)
3. **불명확한 KPI/목표**: 측정 가능하지 않거나 모호한 목표/지표
4. **완성도 이슈**: 미해결 과제, TODO, 구멍, 구체성 부족

## 심각도 기준
- **high**: 즉시 결정/보완이 필요한 치명적 이슈 (순마진 목표 누락, 핵심 의사결정 없음 등)
- **medium**: 보완 권장 (모호한 KPI, 담당자 미지정 등)
- **low**: 사소한 정리/명확화 제안

## 출력 형식 (JSON 배열만 반환 — 다른 설명 금지)
[
  { "severity": "high", "category": "누락된 핵심 정보", "message": "순마진 목표가 명시되지 않았습니다." },
  { "severity": "medium", "category": "불명확한 KPI", "message": "MAU 목표수치가 없습니다." }
]

이슈가 없으면 빈 배열 \`[]\`을 반환합니다. 한국어로 작성하세요. JSON 배열 외 텍스트는 출력하지 마세요.`;

  const { text: rawText } = await llmComplete({
    prompt,
    system: KOREAN_OUTPUT_SYSTEM_PROMPT,
    maxTokens: 4096,
    timeoutMs: 180_000,
    maxRetries: 2,
  });

  const content = (rawText || '').trim();
  if (!content) throw new Error('빈 응답');

  // JSON 정제 — synthesize-notes/route.ts:127-147 패턴 차용.
  // 배열이므로 \\{[\\s\\S]*\\} 대신 \\[[\\s\\S]*\\] 사용.
  const cleaned = content.replace(/[\x00-\x1F\x7F]/g, ' ');

  let parsed: unknown;
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      parsed = JSON.parse(arrayMatch[0]);
    } catch {
      const withoutCodeBlock = arrayMatch[0].replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(withoutCodeBlock);
    }
  } else {
    // 코드 블록 안에 배열이 있는 경우
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      parsed = JSON.parse(codeBlockMatch[1]);
    } else {
      parsed = JSON.parse(cleaned);
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM 응답이 배열이 아님');
  }

  // 스키마 가드: 각 원소가 {severity, category, message} 형태인지.
  const issues: QualityIssue[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const severity = it.severity;
    const category = it.category;
    const message = it.message;
    if (
      (severity === 'high' || severity === 'medium' || severity === 'low') &&
      typeof category === 'string' && category.trim() &&
      typeof message === 'string' && message.trim()
    ) {
      issues.push({
        severity,
        category: category.trim(),
        message: message.trim(),
      });
    }
  }

  return issues;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const body = await request.json() as Partial<QualityBody>;
    const { docType, content } = body;

    // 입력 검증 — 클라가 임의 길이 본문 보내 비용 폭발 방지.
    if (typeof docType !== 'string' || !docType.trim()) {
      return NextResponse.json(
        { error: 'docType이 필요합니다.', reason: 'bad-request' },
        { status: 400 }
      );
    }
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: '검증할 본문(content)이 필요합니다.', reason: 'bad-request' },
        { status: 400 }
      );
    }
    // 본문 상한 — 14문서/회의록 중 가장 긴(PRD/계획서) 기준 여유값. 초과 시 400.
    if (content.length > 32_000) {
      return NextResponse.json(
        { error: '본문이 너무 깁니다(32,000자 이하).', reason: 'bad-request' },
        { status: 400 }
      );
    }

    const issues = await runQualityCheck({ docType, content, context: body.context });

    return NextResponse.json(
      { issues },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error('[quality-check] 품질 검증 실패:', error);
    const reason = classifyQcError(error);
    // 429(쿼터)는 클라이언트가 "검증 불가, 나중에 재시도" 안내에 사용하도록 동일 상태 전달.
    const status = reason === '429' ? 429 : 503;
    return NextResponse.json(
      {
        error: '품질 검증을 수행할 수 없습니다. 잠시 후 다시 시도해주세요.',
        reason,
      },
      { status }
    );
  }
}
