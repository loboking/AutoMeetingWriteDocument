import type { ResolvedProvider } from './types';

// 환경변수 우선순위로 발급된 provider들을 결정한다.
// 9곳에 복붙됐던 hasOpenAI/useZai/MODEL/baseURL 분기의 단일 출처.
//
// 우선순위(발급된 키만, 위에서부터):
//   1. ANTHROPIC_API_KEY → Claude (어댑터는 2차에 연결)
//   2. GEMINI_API_KEY    → Gemini (OpenAI 호환 모드)
//   3. OPENAI_API_KEY    → OpenAI gpt-4o  (현행 호환: z.ai보다 위)
//   4. ZAI_API_KEY       → z.ai GLM       (현재 메인)
//
// ⚠️ 책임분리: 어댑터 "구현 여부(implemented)"는 여기서 안 본다.
//    이 모듈은 env→provider 결정만 한다. 미구현 어댑터 폴백 가드는 index.ts 책임.
//    (ADAPTERS를 import하지 않음)
//
// 회귀 안전: 현재 환경엔 ANTHROPIC/GEMINI 키 없음 → 기존(OPENAI>ZAI)과 동일 선택.

/** 발급된 키를 우선순위 순으로 모두 반환. 하나도 없으면 throw. */
export function resolveAllProviders(): ResolvedProvider[] {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const zai = process.env.ZAI_API_KEY;

  const providers: ResolvedProvider[] = [];

  if (anthropic) {
    providers.push({
      id: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      apiKey: anthropic,
      // baseURL 없음 — @anthropic-ai/sdk 기본 엔드포인트 사용
    });
  }

  if (gemini) {
    providers.push({
      id: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: gemini,
      baseURL:
        process.env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }

  if (openai) {
    providers.push({
      id: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      apiKey: openai,
      baseURL: 'https://api.openai.com/v1',
    });
  }

  if (zai) {
    providers.push({
      id: 'zai',
      model: process.env.ZAI_MODEL || 'glm-5-turbo',
      apiKey: zai,
      baseURL:
        process.env.ZAI_BASE_URL ||
        'https://open.bigmodel.cn/api/coding/paas/v4',
    });
  }

  if (providers.length === 0) {
    throw new Error(
      'LLM API 키가 없습니다. ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / ZAI_API_KEY 중 하나를 설정하세요.'
    );
  }

  // LLM_PROVIDER로 명시 지정 시 그 provider를 맨 앞으로(키 우선순위 무시).
  // 지정 provider의 키가 없으면 무시하고 기본 우선순위 유지(침묵 폴백 방지 위해 warn).
  // env 한 줄로 zai/openai/gemini/anthropic 전환 — 키 순서에 휘둘리지 않는 단일 노브.
  const preferred = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (preferred) {
    const idx = providers.findIndex((p) => p.id === preferred);
    if (idx > 0) {
      const [picked] = providers.splice(idx, 1);
      providers.unshift(picked);
    } else if (idx < 0) {
      console.warn(
        `[llm] LLM_PROVIDER='${preferred}' 이지만 해당 키가 없어 무시. 기본 우선순위 사용.`
      );
    }
  }

  return providers;
}

/**
 * env 기준 최상위 1개. (어댑터 구현여부는 보지 않는 순수 env 결정)
 * 가드된 "실제 선택" provider가 필요하면 index.ts의 resolveProvider(재export)를 써라.
 */
export function resolveProvider(): ResolvedProvider {
  return resolveAllProviders()[0];
}
