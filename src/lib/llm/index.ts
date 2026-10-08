import type { LLMAdapter, LLMRequest, LLMResult, ProviderId, ResolvedProvider } from './types';
import { resolveAllProviders } from './resolveProvider';
import { openaiCompatAdapter } from './openaiCompatAdapter';
import { anthropicAdapter } from './anthropicAdapter';

// provider id → 어댑터. OpenAI 호환(zai/openai/gemini)은 하나를 공유.
const ADAPTERS: Record<ProviderId, LLMAdapter> = {
  zai: openaiCompatAdapter,
  openai: openaiCompatAdapter,
  gemini: openaiCompatAdapter,
  anthropic: anthropicAdapter,
};

/**
 * 우선순위 순으로 돌며 "어댑터가 실제 구현된(implemented:true)" 첫 provider를 고른다.
 * 미구현 어댑터(예: anthropic phase2)는 건너뛰고 console.warn으로 폴백 로그(침묵 폴백 금지).
 * 구현된 게 하나도 없으면 throw.
 *
 * 책임분리: env→provider 순서는 resolveAllProviders가, 구현여부 가드는 여기(index)가 안다.
 */
function resolveImplementedProvider(): ResolvedProvider {
  const providers = resolveAllProviders(); // 키 없으면 여기서 throw
  for (const ctx of providers) {
    if (ADAPTERS[ctx.id].implemented) return ctx;
    if (process.env.LLM_PROVIDER?.trim()) {
      throw new Error(`지정한 LLM provider '${ctx.id}' 어댑터가 구현되지 않았습니다.`);
    }
    console.warn(
      `[llm] provider '${ctx.id}' 어댑터 미구현 → 다음 우선순위로 폴백`
    );
  }
  throw new Error(
    `LLM provider 후보(${providers
      .map((p) => p.id)
      .join(', ')}) 중 구현된 어댑터가 없습니다.`
  );
}

/**
 * 단일 LLM 호출. provider 분기(baseURL/모델/thinking/응답추출)는 전부 내부에 숨긴다.
 * 호출부는 prompt+옵션만 넘기고 { text }를 받는다. 실패 시 throw(라우트가 mock fallback).
 */
export async function llmComplete(req: LLMRequest): Promise<LLMResult> {
  const ctx = resolveImplementedProvider();
  const adapter = ADAPTERS[ctx.id];
  const startedAt = Date.now();
  let result: LLMResult;
  try {
    result = await adapter.complete(req, ctx);
  } catch (err) {
    // 같은 provider 폴백 모델(zai: glm-5.3-flash → glm-5.3). timeout은 라우트 시간 예산 초과라 재시도 안 함.
    const fallback = ctx.fallbackModel;
    if (!fallback || fallback === ctx.model || (err as Error)?.name === 'APIConnectionTimeoutError') throw err;
    console.warn(`[llm] '${ctx.model}' 실패 → '${fallback}' 폴백:`, (err as Error)?.message);
    result = await adapter.complete(req, { ...ctx, model: fallback });
  }
  if (process.env.LLM_MEASUREMENT_LOGGING === 'true') {
    console.log('[llm-measurement]', JSON.stringify({
      provider: ctx.id, requestedModel: ctx.model, reportedModel: result.model,
      reasoningEffort: ctx.id === 'openai' && /^(gpt-5|gpt-6|o\d)/.test(ctx.model)
        ? process.env.OPENAI_REASONING_EFFORT || 'low' : null,
      elapsedMs: Date.now() - startedAt, usage: result.usage ?? null,
    }));
  }
  return result;
}

/**
 * 호출부가 isGlm 등 판정에 쓰는 "실제 선택될" provider.
 * resolveProvider.ts의 순수 env 버전이 아니라 가드된 버전을 export해야
 * isGlm 판정이 llmComplete가 실제 호출하는 provider와 일치한다.
 */
export function resolveProvider(): ResolvedProvider {
  return resolveImplementedProvider();
}

export { resolveAllProviders } from './resolveProvider';
export type { LLMRequest, LLMResult, ProviderId } from './types';
