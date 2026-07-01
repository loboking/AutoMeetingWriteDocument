import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { llmComplete } from '@/lib/llm';
import { DOCUMENTS } from '@/lib/documentUtils';
import { applyPatches, type DocPatch } from '@/lib/docPatch';
import { recordTokenUsage, type TokenOp } from '@/lib/tokenUsage';
import type { LLMResult } from '@/lib/llm/types';
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
  meetingId?: string; // 토큰 기록 연관용(옵션)
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
function parseModelJson(raw: string): { mode?: string; reply?: string; content?: string; patches?: DocPatch[]; rewrite?: boolean; needSearch?: boolean; searchQuery?: string } | null {
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

  const { docType, currentContent, instruction, history = [], title, meetingId } = body;
  if (!docType || typeof currentContent !== 'string' || !instruction?.trim()) {
    return NextResponse.json({ error: 'docType, currentContent, instruction이 필요합니다.' }, { status: 400 });
  }

  const label = docLabel(docType);

  // 토큰 실측 기록(과금 설계용, best-effort). 각 llmComplete 결과를 op별로 남긴다.
  const logTokens = (op: TokenOp, r: LLMResult) => {
    void recordTokenUsage({
      userId: auth.user.id,
      op,
      provider: r.provider,
      model: r.model,
      usage: r.usage,
      meetingId,
      docType,
    });
  };

  // 패치(부분 수정) 출력 지침 — 전체 재작성 대신 작은 패치만 생성 → 긴 문서도 빠르고 정확.
  const patchGuide = [
    '★문서 수정은 "전체 다시 쓰기"가 아니라 "patches(부분 변경)"로 합니다. 긴 문서를 통째로 출력하지 마세요.',
    'edit 응답: {"mode":"edit","reply":"바꾼 내용 1~2문장 요약","patches":[ ...패치들... ]}',
    'patches의 각 항목은 셋 중 하나:',
    '  - 교체: {"find":"원문에 그대로 있는 짧고 고유한 텍스트","replace":"새 텍스트"}',
    '  - 삽입: {"after":"이 텍스트(원문 그대로) 바로 뒤에","insert":"\\n삽입할 내용"}',
    '  - 끝에 추가: {"append":"문서 맨 끝에 붙일 내용(예: 새 섹션)"}',
    '★find/after는 반드시 "현재 문서에 글자 그대로 존재하는" 짧고 고유한 문자열이어야 합니다(공백·기호 포함 정확히). 길게 잡지 말고 식별 가능한 최소 길이로.',
    '바꿀 부분이 여러 곳이면 패치를 여러 개 넣으세요. 표/문단 추가는 after+insert 또는 append를 쓰세요.',
  ];

  // 공통 규칙
  const commonRules = [
    '규칙:',
    '1. 모든 텍스트(reply, 패치 내용)는 한국어. 영문 문서라도 수정/추가 내용은 한국어로.',
    '2. 요청과 무관한 부분은 건드리지 않는다(패치에 포함하지 않는다). 요청된 부분만 정확히.',
    '3. 되묻기 금지: "수정/진행해줘"처럼 명확히 지시하면 정보 부족해도 진행한다. 사용자만 답할 내부 고유정보만 chat으로 1회 되묻는다.',
    '4. 추측·가공 금지: 가명("로컬 B사")·지어낸 수치 금지. 확인 불가 값은 "[확인 필요]" 표기.',
    '5. JSON 문자열 안의 줄바꿈은 \\n, 따옴표는 \\"로 이스케이프한다.',
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

  // patches 적용 → 응답 JSON 생성. 실패가 과하면 null 반환(폴백 유도).
  const buildEditResponse = (
    parsed: NonNullable<ReturnType<typeof parseModelJson>>,
    provider: string,
    model: string | undefined,
    extraNote = '',
    searched = false
  ) => {
    if (!Array.isArray(parsed.patches) || parsed.patches.length === 0) return null;
    const res = applyPatches(currentContent, parsed.patches);
    // 하나도 적용 못 했으면 실패(폴백). 일부 실패는 허용하되 안내.
    if (res.applied === 0) return null;
    if (res.content.trim() === currentContent.trim()) return null; // 변화 없음
    let reply = parsed.reply || '수정했습니다.';
    if (res.failed > 0) reply += ` (일부 ${res.failed}곳은 원문에서 찾지 못해 건너뛰었어요)`;
    reply += extraNote;
    return NextResponse.json({ mode: 'edit', reply, content: res.content, provider, model, searched, partial: res.failed > 0 });
  };

  try {
    // ── 1차: 판단 + (수정이면) 패치 생성. 검색X, thinking off → 빠름 ──
    const system1 = [
      `당신은 숙련된 기획자 "DocHelper"입니다. 사용자와 "${label}" 문서를 대화하며 다듬습니다.`,
      '',
      '사용자 의도를 보고 아래 JSON 중 하나로만 응답하세요(설명·코드펜스 없이 JSON만):',
      '- 대화/논의: {"mode":"chat","reply":"답변(3~5문장 이내로 간결히)"}',
      '- 부분 수정(바꿀 곳이 문서의 일부): {"mode":"edit","reply":"요약","patches":[...]}',
      '- 전체 재검토/전면 개선(문서 대부분을 손봐야 함): {"mode":"edit","rewrite":true,"reply":"어떻게 개선할지 1~2문장"}',
      '- 수정(외부 사실 필요): {"mode":"edit","needSearch":true,"searchQuery":"검색 질의(한국어)","reply":"무엇을 조사할지 한 줄"}',
      '',
      '★판단 기준: "이 부분/이 표현/이 수치"처럼 좁은 수정은 patches. "전체 검토/전면 개선/다시 써줘/품질 높여줘"처럼 문서 대부분을 손봐야 하면 rewrite:true(이땐 patches를 만들지 말 것 — 시스템이 별도로 전체를 다시 씁니다).',
      'needSearch=true는 "확실히 알지 못하는 실제 기업/서비스명·시장규모·통계·법규·최신 동향"이 필요할 때만. 문체·요약·구조 변경엔 쓰지 말고 바로 patches를 작성.',
      '',
      ...patchGuide,
      '',
      ...commonRules,
    ].join('\n');

    const r1 = await llmComplete({
      prompt: `${docBlock}\n\n위 의도에 맞게 JSON으로 응답하세요.`,
      system: system1,
      maxTokens: 8192, // 패치만 내므로 작게 충분 → 빠름
      temperature: 0.4,
      timeoutMs: 90_000,
      maxRetries: 1,
    });

    const p1 = parseModelJson(r1.text ?? '');
    // r1은 판단 호출. chat이면 chat, edit이면 부분수정 시도로 기록(rewrite/research는 아래서 별도 기록).
    logTokens(p1?.mode === 'edit' && !p1.rewrite && !p1.needSearch ? 'edit-patch' : 'chat', r1);
    if (!p1 || !p1.reply) {
      const fallback = (r1.text ?? '').trim() || '죄송해요, 다시 한 번 말씀해 주세요.';
      return NextResponse.json({ mode: 'chat', reply: fallback, provider: r1.provider });
    }

    // ── 전체 재검토/재작성: 문서 대부분을 손봐야 하는 요청 → content 전체 생성(큰 토큰·긴 timeout) ──
    if (p1.mode === 'edit' && p1.rewrite && !p1.needSearch) {
      try {
        const rw = await llmComplete({
          prompt: `${docBlock}\n\n위 "${label}" 문서 전체를 요청에 맞게 검토·개선해 다시 작성하세요. 기존의 유효한 내용·구조·표는 살리되 부족한 부분을 보강하고 다듬으세요.`,
          system: [
            `당신은 숙련된 기획자 "DocHelper"입니다. "${label}" 문서 전체를 검토·개선해 재작성합니다.`,
            '아래 JSON으로만 응답(설명·코드펜스 없이): {"mode":"edit","reply":"무엇을 어떻게 개선했는지 2~3문장","content":"개선된 문서 전체 마크다운"}',
            'content는 문서 전체를 담습니다. 생략("...") 금지. 마크다운 구조를 지키세요.',
            '',
            ...commonRules,
          ].join('\n'),
          maxTokens: 15000, // 전체 재작성 → 큰 출력 허용
          temperature: 0.5,
          timeoutMs: 240_000, // 함수 300s 안전 마진
          maxRetries: 0,
        });
        logTokens('edit-rewrite', rw);
        const prw = parseModelJson(rw.text ?? '');
        if (prw && prw.mode === 'edit' && typeof prw.content === 'string' && prw.content.trim() && prw.content.trim() !== currentContent.trim()) {
          return NextResponse.json({ mode: 'edit', reply: prw.reply || '문서 전체를 검토·개선했습니다.', content: prw.content, provider: rw.provider, model: rw.model, rewritten: true });
        }
        return NextResponse.json({ mode: 'chat', reply: prw?.reply || p1.reply || '문서를 개선해봤지만 변경할 내용을 확정하지 못했어요. 개선 방향을 조금 더 구체적으로 알려주시겠어요?', provider: rw.provider });
      } catch (erw) {
        console.error('[edit-doc] 전체 재작성 실패:', erw instanceof Error ? erw.message : erw);
        return NextResponse.json({ mode: 'chat', reply: '문서가 커서 전체 재검토가 시간 안에 끝나지 못했어요. "개요 섹션만 검토" 처럼 섹션 단위로 나눠 요청하면 빠르게 개선할 수 있어요.' });
      }
    }

    // 검색 불필요 → 1차 결과로 끝 (대화·단순수정 = 빠름)
    if (!p1.needSearch) {
      if (p1.mode === 'edit') {
        const resp = buildEditResponse(p1, r1.provider, r1.model);
        if (resp) return resp;
        // 패치 실패 → 한 번 더 명확히 패치 재요청(작은 호출)
      } else {
        return NextResponse.json({ mode: 'chat', reply: p1.reply, provider: r1.provider });
      }
    }

    // ── 검색 필요 시: 2차=사실 수집(작게, 빠름) ──
    let researchFacts = '';
    if (p1.needSearch) {
      const searchQuery = typeof p1.searchQuery === 'string' && p1.searchQuery.trim() ? p1.searchQuery.trim() : instruction;
      try {
        const r2 = await llmComplete({
          prompt: `다음 주제로 웹을 검색해 확인된 사실만 간결한 한국어 bullet로 정리하세요(최대 10줄). 실제 명칭·수치 위주, 출처 불명확하면 제외.\n\n주제: ${searchQuery}`,
          system: '당신은 리서처입니다. 웹 검색 결과에서 확인된 사실만 "- 사실" bullet로 출력합니다. 설명·서론 없이.',
          maxTokens: 1200,
          temperature: 0.2,
          timeoutMs: 75_000,
          maxRetries: 0,
          enableWebSearch: true,
        });
        logTokens('research', r2);
        researchFacts = (r2.text ?? '').trim();
      } catch (e2) {
        console.error('[edit-doc] 검색 실패 → 검색없이 진행:', e2 instanceof Error ? e2.message : e2);
      }
    }

    // ── 3차(또는 1차 패치 실패 시 재시도): 패치 생성. 검색X → 빠름 ──
    const factsBlock = researchFacts ? `\n참고(웹 검색으로 확인된 사실):\n${researchFacts}\n` : '';
    try {
      const r3 = await llmComplete({
        prompt: `${docBlock}\n${factsBlock}\n위 문서를 요청대로 수정해 patches로 응답하세요. 참고 사실이 있으면 실제 명칭·수치를 반영하세요.`,
        system: [
          `당신은 숙련된 기획자 "DocHelper"입니다. "${label}" 문서를 patches(부분 수정)로 고칩니다.`,
          ...patchGuide,
          '',
          ...commonRules,
        ].join('\n'),
        maxTokens: 8192,
        temperature: 0.4,
        timeoutMs: 120_000,
        maxRetries: 0,
      });
      logTokens(researchFacts ? 'research' : 'edit-patch', r3);
      const p3 = parseModelJson(r3.text ?? '');
      if (p3) {
        const note = p1.needSearch && !researchFacts ? ' (실시간 검색은 일시적으로 건너뛰었어요)' : '';
        const resp = buildEditResponse(p3, r3.provider, r3.model, note, !!researchFacts);
        if (resp) return resp;
        if (p3.reply) return NextResponse.json({ mode: 'chat', reply: p3.reply, provider: r3.provider });
      }
      return NextResponse.json({
        mode: 'chat',
        reply: p1.reply || '요청하신 위치를 문서에서 정확히 찾지 못했어요. 바꿀 부분의 표현을 조금 더 구체적으로 알려주시겠어요?',
        provider: r3.provider,
      });
    } catch (e3) {
      console.error('[edit-doc] 수정(패치) 생성 실패:', e3 instanceof Error ? e3.message : e3);
      return NextResponse.json({
        mode: 'chat',
        reply: '수정 생성이 시간 안에 끝나지 못했어요. 범위를 조금 좁혀서 다시 요청해 주세요.',
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '요청 처리 중 오류가 발생했습니다.';
    console.error('[edit-doc] error:', msg);
    return NextResponse.json({
      mode: 'chat',
      reply: `지금은 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요. (${msg})`,
      mock: true,
    });
  }
}
