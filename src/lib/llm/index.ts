import type { LLMAdapter, LLMRequest, LLMResult, ProviderId } from './types';
import { resolveProvider } from './resolveProvider';
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
 * 단일 LLM 호출. provider 분기(baseURL/모델/thinking/응답추출)는 전부 내부에 숨긴다.
 * 호출부는 prompt+옵션만 넘기고 { text }를 받는다. 실패 시 throw(라우트가 mock fallback).
 */
export async function llmComplete(req: LLMRequest): Promise<LLMResult> {
  const ctx = resolveProvider();
  const adapter = ADAPTERS[ctx.id];
  return adapter.complete(req, ctx);
}

export { resolveProvider } from './resolveProvider';
export type { LLMRequest, LLMResult, ProviderId } from './types';
