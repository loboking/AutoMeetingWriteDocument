import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { llmComplete } from '@/lib/llm';
import { DOCUMENTS } from '@/lib/documentUtils';
import type { DocType } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface HistoryMsg {
  role: 'user' | 'assistant';
  text: string;
}

interface EditDocBody {
  docType: DocType;
  currentContent: string;
  instruction: string; // 이번 사용자 메시지
  history?: HistoryMsg[]; // 이전 대화 맥락 (최근 N개)
  title?: string; // 회의 제목(맥락)
}

const docLabel = (t: DocType): string =>
  DOCUMENTS.find((d) => d.key === t)?.title ?? t;

// 대화 히스토리를 프롬프트 텍스트로 직렬화 (llmComplete는 단일 prompt만 받음)
function renderHistory(history: HistoryMsg[]): string {
  if (!history.length) return '';
  const lines = history.map((m) => `${m.role === 'user' ? '사용자' : 'DocHelper'}: ${m.text}`);
  return `이전 대화:\n${lines.join('\n')}\n\n`;
}

// JSON 블록 안전 추출 (모델이 코드펜스/잡텍스트로 감싸도)
function parseModelJson(raw: string): { mode?: string; reply?: string; content?: string; needSearch?: boolean; searchQuery?: string } | null {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  // 첫 { 부터 마지막 } 까지
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  let body: EditDocBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const { docType, currentContent, instruction, history = [], title } = body;
  if (!docType || typeof currentContent !== 'string' || !instruction?.trim()) {
    return NextResponse.json({ error: 'docType, currentContent, instruction이 필요합니다.' }, { status: 400 });
  }

  const label = docLabel(docType);

  // 공통 규칙(1차·2차 공유)
  const commonRules = [
    '규칙:',
    '1. 모든 텍스트는 한국어. content(문서 본문)도 반드시 한국어로 작성한다(영문 문서라도 수정 시 한국어로 옮긴다).',
    '2. edit일 때 content는 문서 "전체"를 담는다. 일부만/생략 금지. 요청과 무관한 기존 내용·구조·표는 보존하고 요청된 부분만 변경.',
    '3. 되묻기 금지: "수정해줘/진행해줘"처럼 변경을 명확히 지시하면 정보가 부족해도 되묻지 말고 edit으로 진행한다. 진짜로 사용자만 답할 수 있는 내부 고유정보(우리 회사 내부 수치 등)만 chat으로 1회 되묻는다.',
    '4. 추측·가공 금지: 가공의 회사명/가명("로컬 B사" 등)이나 지어낸 수치를 쓰지 않는다. 확인 불가한 값은 옆에 "[확인 필요]"를 단다.',
    '5. content 안의 줄바꿈/따옴표는 JSON 규칙에 맞게 이스케이프한다.',
  ];

  const docBlock = [
    title ? `회의 제목: ${title}` : '',
    `문서 종류: ${label}`,
    '',
    '현재 문서 전체:',
    '---',
    currentContent || '(아직 내용 없음)',
    '---',
    '',
    renderHistory(history),
    `사용자: ${instruction}`,
  ].filter(Boolean).join('\n');

  // ── 1차: 빠른 판단 (검색 없음, thinking off). 검색 필요 여부도 함께 받음 ──
  const system1 = [
    `당신은 숙련된 기획자 "DocHelper"입니다. 사용자와 "${label}" 문서를 대화하며 다듬습니다.`,
    '',
    '사용자 의도를 보고 판단해 아래 JSON 중 하나로만 응답하세요(설명·코드펜스 없이 JSON만):',
    '- 대화/논의: {"mode":"chat","reply":"답변"}',
    '- 수정(외부 정보 불필요): {"mode":"edit","reply":"바꾼 내용 요약","content":"수정된 문서 전체"}',
    '- 수정(외부 사실 필요): {"mode":"edit","needSearch":true,"searchQuery":"검색에 쓸 핵심 질의(한국어)","reply":"무엇을 조사할지 한 줄"}',
    '',
    'needSearch=true는 "당신이 확실히 알지 못하는 실제 기업/서비스명·시장규모·통계·법규·최신 동향 등"이 필요할 때만. 문체 다듬기·요약·구조 변경 등엔 절대 쓰지 않는다(그땐 content를 바로 작성).',
    'chat 답변(reply)은 핵심만 간결하게 3~5문장 이내로. 불필요하게 장황하게 늘리지 않는다.',
    '',
    ...commonRules,
  ].join('\n');

  try {
    const r1 = await llmComplete({
      prompt: `${docBlock}\n\n위 의도에 맞게 JSON으로 응답하세요.`,
      system: system1,
      maxTokens: 16384,
      temperature: 0.5,
      timeoutMs: 120_000,
      maxRetries: 1,
      // 1차는 검색 미부착 → thinking off로 빠르게
    });

    const p1 = parseModelJson(r1.text ?? '');
    if (!p1 || !p1.reply) {
      const fallback = (r1.text ?? '').trim() || '죄송해요, 다시 한 번 말씀해 주세요.';
      return NextResponse.json({ mode: 'chat', reply: fallback, provider: r1.provider });
    }

    // 검색 불필요 → 1차 결과 그대로 (대화·단순수정 = 빠름)
    if (!p1.needSearch) {
      if (p1.mode === 'edit' && typeof p1.content === 'string' && p1.content.trim()) {
        return NextResponse.json({ mode: 'edit', reply: p1.reply, content: p1.content, provider: r1.provider, model: r1.model });
      }
      return NextResponse.json({ mode: 'chat', reply: p1.reply, provider: r1.provider });
    }

    // ── 2차: 검색 필요 → web_search 켜서 실제 정보로 수정안 작성 ──
    const searchQuery = typeof p1.searchQuery === 'string' && p1.searchQuery.trim() ? p1.searchQuery.trim() : instruction;
    const system2 = [
      `당신은 숙련된 기획자 "DocHelper"입니다. 웹 검색으로 확인된 실제 사실을 반영해 "${label}" 문서를 수정합니다.`,
      '',
      '제공된 웹 검색으로 아래 조사 주제의 실제 정보(실명·수치 등)를 찾아 반영하세요. 검색으로 확인된 사실만 쓰고, 못 찾은 값은 "[확인 필요]"로 표기합니다.',
      `조사 주제: ${searchQuery}`,
      '',
      '아래 JSON으로만 응답: {"mode":"edit","reply":"무엇을 조사해 어떻게 반영했는지 1~2문장","content":"수정된 문서 전체"}',
      '',
      ...commonRules,
    ].join('\n');

    // 2차는 별도 try: 검색이 느려 실패(timeout)해도 "모의"로 빠지지 말고 검색 없이라도 수정안을 준다.
    try {
      const r2 = await llmComplete({
        prompt: `${docBlock}\n\n위 문서에 검색 결과를 반영해 edit JSON으로 응답하세요.`,
        system: system2,
        maxTokens: 16384,
        temperature: 0.4,
        timeoutMs: 210_000, // 함수 maxDuration(300s) 안전 마진
        maxRetries: 0, // 재시도하면 시간 2배 → timeout 위험. 1회만.
        enableWebSearch: true, // 2차에서만 검색
      });
      const p2 = parseModelJson(r2.text ?? '');
      if (p2 && p2.mode === 'edit' && typeof p2.content === 'string' && p2.content.trim()) {
        return NextResponse.json({ mode: 'edit', reply: p2.reply || '검색 결과를 반영했습니다.', content: p2.content, provider: r2.provider, model: r2.model, searched: true });
      }
    } catch (e2) {
      console.error('[edit-doc] 2차(검색) 실패 → 검색없이 폴백:', e2 instanceof Error ? e2.message : e2);
    }

    // 2차 실패/빈응답 → 검색 없이라도 수정안 생성(빠름). "모의"로 떨어지지 않게.
    const r3 = await llmComplete({
      prompt: `${docBlock}\n\n위 문서를 요청대로 수정해 edit JSON으로 응답하세요. 외부 정보가 필요하면 알고 있는 범위에서 반영하고 불확실한 값은 "[확인 필요]"로 표기하세요.`,
      system: [
        `당신은 숙련된 기획자 "DocHelper"입니다. "${label}" 문서를 요청대로 수정합니다.`,
        '아래 JSON으로만 응답: {"mode":"edit","reply":"바꾼 내용 요약","content":"수정된 문서 전체"}',
        '',
        ...commonRules,
      ].join('\n'),
      maxTokens: 16384,
      temperature: 0.4,
      timeoutMs: 60_000,
      maxRetries: 1,
    });
    const p3 = parseModelJson(r3.text ?? '');
    if (p3 && p3.mode === 'edit' && typeof p3.content === 'string' && p3.content.trim()) {
      return NextResponse.json({ mode: 'edit', reply: (p3.reply || '수정했습니다.') + ' (실시간 검색은 일시적으로 건너뛰었어요)', content: p3.content, provider: r3.provider, model: r3.model });
    }
    // 그래도 안되면 1차 reply라도 대화로
    return NextResponse.json({ mode: 'chat', reply: p1.reply, provider: r3.provider });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '요청 처리 중 오류가 발생했습니다.';
    console.error('[edit-doc] error:', msg);
    // 키 미설정/LLM 실패 → 모의 대화 응답(흐름 보존)
    return NextResponse.json({
      mode: 'chat',
      reply: `(모의) 지금은 AI 연결이 안 돼 실제 대화·수정이 어려워요. (${msg})`,
      mock: true,
    });
  }
}
