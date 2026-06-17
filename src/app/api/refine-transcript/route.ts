import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import OpenAI from 'openai';

export const runtime = 'nodejs';
// Vercel 함수 상한 (긴 회의록 보정 대응)
export const maxDuration = 300;

// OpenAI 클라이언트 초기화 (summarize/route.ts 패턴 복제)
// OpenAI 우선 → 없으면 z.ai GLM 사용
function createOpenAIClient() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasZai = !!process.env.ZAI_API_KEY;

  const useZai = !hasOpenAI && hasZai;
  const API_KEY = hasOpenAI ? process.env.OPENAI_API_KEY! : process.env.ZAI_API_KEY!;
  const API_BASE = useZai
    ? (process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4')
    : 'https://api.openai.com/v1';

  if (!API_KEY) {
    throw new Error('API_KEY가 필요합니다. ZAI_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
  }

  return new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE,
    timeout: 180000,
  });
}

// GLM 맥락 보정 — 회의 내용 정확 파악이 1순위.
// 실패 시 원문 그대로 반환 (파이프라인을 절대 끊지 않음).
async function refineWithGPT(transcript: string): Promise<string> {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const useZai = !hasOpenAI && !!process.env.ZAI_API_KEY;
  // summarize/generate-doc과 동일하게 glm-5-turbo로 통일
  const MODEL = useZai ? (process.env.ZAI_MODEL || 'glm-5-turbo') : 'gpt-4o';

  const prompt = `당신은 회의 녹취 교정 전문가입니다. 아래 텍스트는 회의 음성을 STT(음성→텍스트)로 변환한 결과로, 오타·끊김·잘못 인식된 단어(오인식)·중복·잡음이 섞여 있을 수 있습니다.

## 교정 규칙 (반드시 준수)
- 회의의 맥락과 의미를 유지하면서 명백한 오인식, 중복 표현, 잡음을 자연스러운 한국어로 교정하세요.
- 내용을 새로 지어내지 마세요. 원문에 없는 정보를 추가하지 마세요.
- 불확실한 부분은 원문을 그대로 유지하세요.
- 화자 추정은 하지 마세요(별도 기능에서 처리합니다). 화자 라벨을 임의로 붙이거나 바꾸지 마세요.
- 설명이나 머리말 없이, 교정된 회의록 텍스트만 출력하세요.

## STT 원문
\`\`\`
${transcript}
\`\`\`

교정된 회의록 텍스트만 반환하세요.`;

  try {
    const openai = createOpenAIClient();

    const createParams = {
      model: MODEL,
      messages: [{ role: 'user' as const, content: prompt }],
      max_tokens: 8192,
      // GLM 계열 thinking 비활성화 (속도 향상, timeout 방지)
      ...(MODEL.includes('glm') ? { thinking: { type: 'disabled' } } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

    const response = await openai.chat.completions.create(createParams, {
      timeout: 180000,
    });

    const message = response.choices[0]?.message;
    // 코딩 플랜 추론 모델은 content 또는 reasoning_content 확인
    const content =
      message?.content ||
      (message as { reasoning_content?: string })?.reasoning_content ||
      '';

    // 제어 문자 정리 (개행/탭은 보존, 그 외 제어문자만 제거)
    const cleaned = content
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();

    // 빈 응답이면 원문 보존
    if (!cleaned) {
      console.warn('[API] refine-transcript: 빈 응답, 원문 보존');
      return transcript;
    }

    return cleaned;
  } catch (error) {
    console.error('[ERROR] refine-transcript GLM 오류:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      hasZaiKey: !!process.env.ZAI_API_KEY,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    });
    // graceful: 원문 그대로 반환 (파이프라인 보존)
    return transcript;
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const { transcript } = await request.json();

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return NextResponse.json({ error: 'transcript가 필요합니다.' }, { status: 400 });
    }

    const refined = await refineWithGPT(transcript);

    return NextResponse.json(
      { refined },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error('[API] refine-transcript 오류:', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    // 본문 파싱 실패 등은 400 (transcript 미수신으로 간주)
    return NextResponse.json({ error: 'transcript가 필요합니다.' }, { status: 400 });
  }
}
