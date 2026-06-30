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
function parseModelJson(raw: string): { mode?: string; reply?: string; content?: string } | null {
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

  const system = [
    `당신은 숙련된 기획자 "DocHelper"입니다. 사용자와 "${label}" 문서에 대해 대화하며 함께 다듬습니다.`,
    '',
    '당신은 두 가지 방식으로 응답합니다. 사용자의 의도를 보고 스스로 판단하세요:',
    '- chat: 질문/논의/아이디어 도출 등 — 문서를 바꾸지 않고 대화로만 답합니다.',
    '- edit: "수정해줘", "반영해줘", "바꿔줘", "추가해줘", "그렇게 고쳐" 등 문서 변경을 명시적으로 요청할 때 — 수정된 문서 전체를 만듭니다.',
    '',
    '반드시 아래 JSON 형식으로만 응답하세요(설명·코드펜스 없이 JSON만):',
    '{"mode":"chat","reply":"대화 답변(한국어)"}',
    '또는',
    '{"mode":"edit","reply":"무엇을 어떻게 바꿨는지 1~2문장 요약","content":"수정된 문서 전체 마크다운"}',
    '',
    '규칙:',
    '1. 모든 텍스트는 한국어.',
    '2. edit일 때 content는 문서 "전체"를 담습니다. 일부만/생략 금지. 요청과 무관한 기존 내용·구조·표는 보존하고 요청된 부분만 변경.',
    '3. 애매하면 chat으로 답하고, 수정 방향을 한 줄로 제안한 뒤 사용자 확인을 받으세요.',
    '4. content 안의 줄바꿈/따옴표는 JSON 규칙에 맞게 이스케이프하세요.',
  ].join('\n');

  const prompt = [
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
    '',
    '위 의도에 맞게 chat 또는 edit JSON으로 응답하세요.',
  ].filter(Boolean).join('\n');

  try {
    const result = await llmComplete({
      prompt,
      system,
      maxTokens: 16384,
      temperature: 0.5,
      timeoutMs: 280_000,
      maxRetries: 1,
    });

    const parsed = parseModelJson(result.text ?? '');
    if (!parsed || !parsed.reply) {
      // JSON 파싱 실패 → 안전하게 대화 응답으로 처리(문서 안 건드림)
      const fallback = (result.text ?? '').trim() || '죄송해요, 다시 한 번 말씀해 주세요.';
      return NextResponse.json({ mode: 'chat', reply: fallback, provider: result.provider });
    }

    if (parsed.mode === 'edit' && typeof parsed.content === 'string' && parsed.content.trim()) {
      return NextResponse.json({
        mode: 'edit',
        reply: parsed.reply,
        content: parsed.content,
        provider: result.provider,
        model: result.model,
      });
    }
    // 그 외엔 대화
    return NextResponse.json({ mode: 'chat', reply: parsed.reply, provider: result.provider });
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
