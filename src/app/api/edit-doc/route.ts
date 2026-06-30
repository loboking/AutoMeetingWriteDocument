import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { llmComplete } from '@/lib/llm';
import { DOCUMENTS } from '@/lib/documentUtils';
import type { DocType } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface EditDocBody {
  docType: DocType;
  currentContent: string;
  instruction: string; // 사용자 채팅 지시문
  title?: string; // 회의 제목(맥락)
}

const docLabel = (t: DocType): string =>
  DOCUMENTS.find((d) => d.key === t)?.title ?? t;

// 모의 응답: 키 없을 때 — 지시문을 문서 끝에 메모로 추가(동작 확인용).
function mockEdit(content: string, instruction: string): string {
  return `${content}\n\n<!-- (모의 수정) 지시: ${instruction} -->`;
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

  const { docType, currentContent, instruction, title } = body;
  if (!docType || typeof currentContent !== 'string' || !instruction?.trim()) {
    return NextResponse.json({ error: 'docType, currentContent, instruction이 필요합니다.' }, { status: 400 });
  }

  const label = docLabel(docType);
  const system = [
    `당신은 숙련된 기획자입니다. 사용자의 "${label}" 문서를 지시에 따라 수정/고도화합니다.`,
    '규칙:',
    '1. 반드시 한국어로 작성합니다.',
    '2. 수정된 문서 "전체"를 마크다운으로 출력합니다. 일부만 출력하거나 "(생략)" 같은 표현 금지.',
    '3. 지시와 무관한 기존 내용/구조/표는 최대한 보존합니다. 요청된 부분만 바꿉니다.',
    '4. 설명·인사·코드펜스(```) 없이 문서 본문만 출력합니다.',
  ].join('\n');

  const prompt = [
    title ? `회의 제목: ${title}` : '',
    `문서 종류: ${label}`,
    '',
    '아래는 현재 문서 전체입니다:',
    '---',
    currentContent,
    '---',
    '',
    `사용자 지시: ${instruction}`,
    '',
    '위 지시를 반영해 수정된 문서 전체를 출력하세요.',
  ].filter(Boolean).join('\n');

  try {
    const result = await llmComplete({
      prompt,
      system,
      maxTokens: 16384,
      temperature: 0.4,
      timeoutMs: 280_000,
      maxRetries: 1,
    });
    let text = result.text?.trim() ?? '';
    // 모델이 코드펜스로 감싼 경우 제거
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    if (!text) {
      return NextResponse.json({ error: 'AI가 빈 응답을 반환했습니다.' }, { status: 502 });
    }
    return NextResponse.json({ content: text, provider: result.provider, model: result.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '문서 수정 중 오류가 발생했습니다.';
    console.error('[edit-doc] error:', msg);
    // 키 미설정/LLM 실패 → 모의 응답으로 흐름 보존(generate-doc와 동일 정책)
    return NextResponse.json({ content: mockEdit(currentContent, instruction), mock: true, warning: msg });
  }
}
