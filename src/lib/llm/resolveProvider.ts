import type { ResolvedProvider } from './types';

// 환경변수 우선순위로 활성 provider 1개를 결정한다.
// 9곳에 복붙됐던 hasOpenAI/useZai/MODEL/baseURL 분기의 단일 출처.
//
// 우선순위(발급된 키 중 최상위 1개만 사용):
//   1. ANTHROPIC_API_KEY → Claude (어댑터는 2차에 연결)
//   2. GEMINI_API_KEY    → Gemini (OpenAI 호환 모드)
//   3. OPENAI_API_KEY    → OpenAI gpt-4o  (현행 호환: z.ai보다 위)
//   4. ZAI_API_KEY       → z.ai GLM       (현재 메인)
//   키 없음 → throw (라우트가 mock fallback)
//
// 회귀 안전: 현재 환경엔 ANTHROPIC/GEMINI 키 없음 → 기존(OPENAI>ZAI)과 동일 선택.
export function resolveProvider(): ResolvedProvider {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const zai = process.env.ZAI_API_KEY;

  if (anthropic) {
    return {
      id: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      apiKey: anthropic,
      // baseURL 없음 — @anthropic-ai/sdk 기본 엔드포인트 사용
    };
  }

  if (gemini) {
    return {
      id: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: gemini,
      baseURL:
        process.env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
  }

  if (openai) {
    return {
      id: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      apiKey: openai,
      baseURL: 'https://api.openai.com/v1',
    };
  }

  if (zai) {
    return {
      id: 'zai',
      model: process.env.ZAI_MODEL || 'glm-5-turbo',
      apiKey: zai,
      baseURL:
        process.env.ZAI_BASE_URL ||
        'https://open.bigmodel.cn/api/coding/paas/v4',
    };
  }

  throw new Error(
    'LLM API 키가 없습니다. ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / ZAI_API_KEY 중 하나를 설정하세요.'
  );
}
