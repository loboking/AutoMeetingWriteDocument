import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import type { MeetingSummary } from '@/types';
import { llmComplete } from '@/lib/llm';
import {
  validateSummariesBody,
  parseMasterSummary,
  detectPromptInjection,
} from './validate';

export const runtime = 'nodejs';
// 합성은 단일 LLM 호출이지만 입력이 길 수 있어 300초(Vercel 상한)로 맞춤.
export const maxDuration = 300;

// 한국어 출력 강제 시스템 프롬프트 — generate-doc/route.ts와 동일 텍스트.
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

// 실패사유 머신코드 (클라 store GenErrorReason과 동일값).
type GenErrorReason = 'timeout' | '429' | 'empty' | 'no-key' | 'network' | 'limit' | 'error';

function classifySynthError(error: unknown): GenErrorReason {
  if (!error) return 'error';
  const e = error as { status?: number; name?: string; message?: string };
  if (e.status === 429) return '429';
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
  if (typeof e.message === 'string') {
    if (e.message.includes('timeout') || e.message.includes('Timeout')) return 'timeout';
    if (e.message === '빈 응답' || e.message.includes('empty')) return 'empty';
  }
  return 'error';
}

// 요청 body (옵션 B: 클라가 summaries 배열 직송).
interface SynthBody {
  projectId: string;
  summaries: MeetingSummary[];
  metas: { title: string; date: string }[]; // summaries와 1:1 대응
}

// N개 summary → 1개 합성 MeetingSummary.
// 입력은 '\n---\n' join. 응답은 summarize/route.ts와 동일 JSON 스키마로 정제.
async function synthesize(summaries: MeetingSummary[], metas: { title: string; date: string }[]): Promise<MeetingSummary> {
  // 각 회의를 블록으로 직렬화
  const blocks = summaries.map((s, i) => {
    const meta = metas[i] ?? { title: `회의 ${i + 1}`, date: '' };
    const actionLines = (s.actionItems ?? [])
      .map((a) => `    - ${a.task}${a.assignee ? ` (담당: ${a.assignee})` : ''}${a.deadline ? ` [기한: ${a.deadline}]` : ''}${a.priority ? ` [우선순위: ${a.priority}]` : ''}`)
      .join('\n');
    return `### 회의 ${i + 1}: ${meta.title}${meta.date ? ` (${meta.date})` : ''}

- 개요: ${s.overview}
- 핵심 사항:
${(s.keyPoints ?? []).map((p) => `  - ${p}`).join('\n')}
- 의사결정:
${(s.decisions ?? []).map((d) => `  - ${d}`).join('\n')}
- Action Items:
${actionLines || '  (없음)'}`;
  });

  const joined = blocks.join('\n\n---\n\n');

  // H1 완화(등급 낮춤): 사용자 회의록이 입력이라 프롬프트 인젝션 완전 차단 불가.
  // 의심 패턴 감지 시 경고 로그만. 차단 아님(오탐지 위험).
  if (detectPromptInjection(joined)) {
    console.warn('[synthesize-notes] 입력에 프롬프트 인젝션 의심 패턴 감지 — 완화 등급(로그만).');
  }

  const prompt = `당신은 회의록 전문가입니다. 다음 여러 회의의 요약을 **하나의 통합 요약**으로 합성해주세요.
중복되는 내용은 통합하고, 서로 보완되는 정보는 병합하며, 각 회의에서 논의된 고유한 맥락은 보존하세요.

## 회의 요약 모음 (총 ${summaries.length}개)
\`\`\`
${joined}
\`\`\`

## 합성 요구사항

1. **개요 (overview)**: 전체 회의의 흐름을 아우르는 3-5문장 요약. 어떤 회의들이 있었고 전체적으로 무엇이 논의됐는지.
2. **핵심 사항 (keyPoints)**: 중복 제거 + 보완 병합. 최소 7개 이상, 구체적 내용 포함.
3. **의사결정 (decisions)**: 모든 회의에서 최종 결정된 사항 통합. 결정 맥락 유지.
4. **Action Items**: 모든 회의의 액션아이템 통합. 담당자/우선순위/기한 보존.

## 출력 형식 (JSON만 반환)
{
  "overview": "전체 회의 흐름을 아우르는 통합 요약 (3-5문장)",
  "keyPoints": [
    "통합된 구체적 핵심 논의 사항 1",
    "통합된 구체적 핵심 논의 사항 2",
    "최소 7개 이상 작성"
  ],
  "decisions": [
    "통합 의사결정 1 (결정 맥락 포함)",
    "통합 의사결정 2"
  ],
  "actionItems": [
    {
      "task": "구체적인 작업 내용",
      "assignee": "담당자 이름",
      "priority": "high|medium|low",
      "deadline": "구체적인 기한"
    }
  ]
}

분석하여 JSON만 반환해주세요.`;

  const { text: rawText } = await llmComplete({
    prompt,
    system: KOREAN_OUTPUT_SYSTEM_PROMPT,
    maxTokens: 8192,
    timeoutMs: 180_000,
    maxRetries: 2,
  });

  const content = rawText || '{}';

  // JSON 정제 로직 — summarize/route.ts:68-92 패턴 복사(cutScope).
  const cleanedContent = content.replace(/[\x00-\x1F\x7F]/g, ' ');

  let parsed: unknown;
  const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      const withoutCodeBlock = jsonMatch[0].replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(withoutCodeBlock);
    }
  } else {
    const codeBlockMatch = cleanedContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      parsed = JSON.parse(codeBlockMatch[1]);
    } else {
      // 최후의 수단 — 빈 응답 신호
      if (!content.trim()) throw new Error('빈 응답');
      parsed = JSON.parse(cleanedContent);
    }
  }

  // H2/H3: LLM 응답을 persist 전에 스키마 검증.
  // 빈 응답 {} / keyPoints가 string이 아닌 경우를 잡아 NoteAccumulator .map 런타임 에러 방지.
  return parseMasterSummary(parsed);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const body = await request.json();

    // C1-b: summaries 길이/내용 상한 검증. 클라 임의 projectId/과도한 배열 차단.
    const validation = validateSummariesBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { projectId, summaries, metas } = body as SynthBody;

    // TODO(소유권 검증 — 오너 잠금 대기): 클라가 임의 projectId를 넘겨도 서버가 현재 사용자의
    // projects 소유권을 검증해야 함. 현재 store는 클라이언트 zustand라 서버 접근 불가.
    // 도이 Project 테이블 서버 라우트 완성 후 "이 userId의 projects에 projectId 존재?" 검증 추가(403).
    // 지금은 summaries 상한 + userId 기반 시간당 합성 상한으로 비용 폭발만 막는다.

    // 비용 폭발 방어 — userId 기반 시간당 합성 전역 상한.
    // 합성 자체는 무료(과금은 docType==='prd' 성공 시 하루 담당). usage_events/과금 테이블은 건드리지 않는다.
    // 서버 in-memory만 — 서버 재시작 시 리셋됨(P0에선 의도적, 트래픽 작음).
    // TODO(도이 후속): 합성 전용 레이트리밋 테이블/Redis 설계 시 이관.
    // 한계(Vercel 서버리스): 인스턴스별로 분리될 수 있어 상한이 느슨해질 수 있음 —
    // P0에선 완화책으로 충분(과금은 docType==='prd'가 담당).
    //
    // 키 통제권: userId는 requireUser가 검증한 auth.user.id — 클라 위조 불가.
    // 이전 projectId 기반 매핑은 projectId가 클라 임의 UUID라 매 요청 새 UUID로 카운터 리셋 우회가 가능해
    // 비용 폭발 방어가 무력화됐음(세린 2차 리뷰 Critical). userId 기반 전역 상한으로 수정.
    const synthCount = bumpSynthCount(auth.user.id);
    if (synthCount > SYNTH_MAX_PER_USER_PER_HOUR) {
      return NextResponse.json(
        {
          error: 'SYNTH_RATE_LIMIT',
          reason: 'limit',
          message: `회의록 합성 시간당 한도(${SYNTH_MAX_PER_USER_PER_HOUR}회)를 초과했습니다.`,
          used: synthCount,
          limit: SYNTH_MAX_PER_USER_PER_HOUR,
        },
        { status: 429 }
      );
    }

    const masterSummary = await synthesize(summaries, metas);

    return NextResponse.json(
      { projectId, masterSummary },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error('[synthesize-notes] 합성 실패:', error);
    const reason = classifySynthError(error);
    return NextResponse.json(
      { error: '회의록 합성에 실패했습니다.', reason },
      { status: 500 }
    );
  }
}

// --- userId 기반 시간당 합성 상한(in-memory) ---
// 합성 자체는 무료(정합 #3). 과금은 docType==='prd' 성공 시 하루 영역이 담당.
// usage_events/과금 테이블은 건드리지 않는다(이전 synth- 타임스탬프 핵/ doc_type='__synthesize__'
// 마커는 project_id 칼럼 의미 오염 + 진짜 Project UUID 충돌로 롤백).
//
// 키 통제권: userId는 requireUser가 검증한 auth.user.id — 클라 위조 불가.
// 이전 projectId 기반 매핑은 projectId가 클라 임의 UUID(NoteAccumulator.tsx:71)라 매 요청 새 UUID로
// 카운터를 1로 리셋시켜 무제한 통과 우회가 가능했음(세린 2차 리뷰 Critical). userId 기반으로 수정.
// projectId 소유권 검증(도이 서버 라우트 완성 후) 전까지 이 userId 상한으로 완화.
//
// 서버 in-memory만 유지 — 재시작 시 리셋(P0에선 의도적).
// 한계: Vercel 서버리스에선 인스턴스별로 분리될 수 있어 상한이 느슨해질 수 있음.
// P0에선 완화책으로 충분 — 최종 과금 방어는 docType==='prd'가 담당.
// TODO(도이 후속): 합성 전용 레이트리밋 테이블/Redis 설계 시 이 로직을 이관.
//
// 오너 잠금 대기 — userId당 시간당 N회. 합성은 무료지만 LLM 호출 비용이 있으므로 합리적 상한.
const SYNTH_MAX_PER_USER_PER_HOUR = 10;
const SYNTH_WINDOW_MS = 60 * 60 * 1000; // 1시간

// userId → { count, windowStart }: 현재 1시간 윈도우 내 합성 호출 수.
interface SynthEntry {
  count: number;
  windowStart: number;
}
const synthAttempts = new Map<string, SynthEntry>();

// userId의 현재 윈도우 count를 1 증가시키고 증가된 값 반환.
// 윈도우(1시간)가 경과했으면 windowStart=now, count=0으로 리셋 후 count++.
// 성공/실패 무관하게 호출될 때마다 count++(재시도 폭주 방지 목적).
function bumpSynthCount(userId: string): number {
  const now = Date.now();
  let entry = synthAttempts.get(userId);
  if (!entry || now - entry.windowStart > SYNTH_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    synthAttempts.set(userId, entry);
  }
  entry.count += 1;
  return entry.count;
}
