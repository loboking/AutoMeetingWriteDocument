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
  // 출처 — GLM(llmComplete) / Codex(OpenAI 직접 fetch) / common(양쪽 모두가 같은 category로 잡은 이슈).
  // 도현 설계(2026-07-21): cutScope — llmComplete/lib/llm 본문 무변경, Codex는 본 라우트에서만 직접 fetch.
  source: 'glm' | 'codex' | 'common';
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

// GLM 품질 검증 — llmComplete(기본 provider) 호출. 결과로 QualityIssue[] 반환.
// 비즈니스 리스크/논리/누락 관점 강점. Codex와 보완적 각도.
async function runGlmQualityCheck(body: QualityBody): Promise<QualityIssue[]> {
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

  return parseIssues(rawText, 'glm');
}

// Codex(OpenAI gpt-4o) 품질 검증 — fetch 직접호출.
// llmComplete/lib/llm 무변경(cutScope). 문서 완성도/오타/Go-No-Go/디테일 강점 — GLM과 보완적.
// OPENAI_API_KEY 없거나 429/에러 시 throw → 호출부에서 스킵.
async function runCodexQualityCheck(body: QualityBody): Promise<QualityIssue[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('no-key');
  }

  const label = docTypeLabel(body.docType);
  const prompt = `당신은 한국 기업의 시니어 문서 리뷰어입니다. 다음 ${label}을 분석해 완성도/디테일 관점에서 품질 이슈를 찾아주세요.

## 분석 대상 ${label}
\`\`\`
${body.content}
\`\`\`

${body.context ? `## 추가 맥락\n${body.context}` : ''}

## 분석 항목 (중복 가능)
1. **오타/문법/어색한 표현**: 맞춤법, 중복 단어, 어색한 직역투, 혼용되는 용어
2. **Go-No-Go 결정 누락**: 회의록이라면 명확한 결정(go/no-go)이 있는지, PRD라면 출시 기준이 명확한지
3. **구체성 부족**: "적절히"/"추후 협의"/"약간" 등 모호한 표현, 수치/기한/담당자 누락
4. **구조/가독성**: 빈 섹션, 중복 서술, 논리적 순서 위반, 항목 분류 오류
5. **디테일/일관성**: 용어 통일, 단위 표기, 날짜 형식, 제품명/기능명 일관성

## 심각도 기준
- **high**: 즉시 결정/보완이 필요한 치명적 이슈 (Go-No-Go 누락, 핵심 기한/수치 부재 등)
- **medium**: 보완 권장 (모호한 표현, 구조 흐트러짐)
- **low**: 사소한 오타/정리 제안

## 출력 형식 (JSON 배열만 반환 — 다른 설명 금지)
[
  { "severity": "high", "category": "Go-No-Go 결정 누락", "message": "출시 결정(go/no-go)이 명시되지 않았습니다." },
  { "severity": "medium", "category": "구체성 부족", "message": "'추후 협의'로 기한이 모호합니다." }
]

이슈가 없으면 빈 배열 \`[]\`을 반환합니다. 한국어로 작성하세요. JSON 배열 외 텍스트는 출력하지 마세요.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: KOREAN_OUTPUT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    // 429/에러 — 호출부에서 스킵하도록 status를 가진 에러로 전달.
    const e = new Error(`OpenAI ${resp.status}`) as Error & { status?: number };
    e.status = resp.status;
    throw e;
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data.choices?.[0]?.message?.content ?? '';

  return parseIssues(rawText, 'codex');
}

// JSON 배열 응답 파싱 — GLM/Codex 공용. source를 주입해 반환.
// 빈 응답/파싱 실패 시 throw. 정제 패턴은 synthesize-notes/route.ts:127-147 차용.
function parseIssues(rawText: string, source: 'glm' | 'codex'): QualityIssue[] {
  const content = (rawText || '').trim();
  if (!content) throw new Error('빈 응답');

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
        source,
      });
    }
  }

  return issues;
}

// 두 검증기(GLM/Codex) 결과 병합 + 중복 제거.
// 도현 설계: 단순하게 category 기준. 양쪽이 같은 category를 잡으면 source='common'으로 합침
// (메시지는 GLM 것 유지 — 클라이언트에 더 익숙한 비즈니스 톤). 그 외는 그대로.
function mergeIssues(glm: QualityIssue[], codex: QualityIssue[]): QualityIssue[] {
  if (codex.length === 0) return glm;
  if (glm.length === 0) return codex;

  const codexCategories = new Set(codex.map(i => i.category));
  const merged: QualityIssue[] = [];
  const commonCategories = new Set<string>();

  // GLM 먼저 순회 — common이면 source 교체, 아니면 그대로.
  for (const issue of glm) {
    if (codexCategories.has(issue.category)) {
      commonCategories.add(issue.category);
      merged.push({ ...issue, source: 'common' });
    } else {
      merged.push(issue);
    }
  }

  // Codex 추가 — common이 아닌 것만.
  for (const issue of codex) {
    if (!commonCategories.has(issue.category)) {
      merged.push(issue);
    }
  }

  return merged;
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

    // GLM 검증(항상 실행) — llmComplete 기본 provider. provider-agnostic 원칙 유지.
    let glmIssues: QualityIssue[];
    try {
      glmIssues = await runGlmQualityCheck({ docType, content, context: body.context });
    } catch (error) {
      // GLM 실패는 전체 실패(기본 provider) — 기존 동작 유지.
      console.error('[quality-check] GLM 검증 실패:', error);
      const reason = classifyQcError(error);
      const status = reason === '429' ? 429 : 503;
      return NextResponse.json(
        {
          error: '품질 검증을 수행할 수 없습니다. 잠시 후 다시 시도해주세요.',
          reason,
        },
        { status }
      );
    }

    // Codex(OpenAI) 검증 — 쿼터 시도. 스킵 시 codexSkipped=true (에러 아님).
    // OPENAI_API_KEY 없음 / 429 / timeout / 네트워크 에러 → GLM 결과만 반환 + 안내.
    let codexIssues: QualityIssue[] = [];
    let codexSkipped = false;
    try {
      codexIssues = await runCodexQualityCheck({ docType, content, context: body.context });
    } catch (error) {
      codexSkipped = true;
      const reason = classifyQcError(error);
      console.warn(`[quality-check] Codex 검증 스킵(reason=${reason}):`, error);
    }

    const issues = mergeIssues(glmIssues, codexIssues);

    return NextResponse.json(
      { issues, codexSkipped },
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
