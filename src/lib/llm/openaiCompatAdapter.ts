import OpenAI from 'openai';
import type { LLMAdapter, LLMRequest, LLMResult, ResolvedProvider } from './types';
import { extractContent } from './extractContent';

// GLM(z.ai) / OpenAI / Gemini 공통 어댑터.
// 셋 다 OpenAI 호환 API라 baseURL만 바꿔 `openai` SDK를 재사용한다.
// GLM 계열만 thinking 비활성화(reasoning 생략 → 생성 속도 7배, timeout 방지).
export const openaiCompatAdapter: LLMAdapter = {
  id: 'zai', // 대표 id. 실제 id는 ctx에서 온다 (resolveProvider가 결정).

  async complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResult> {
    const client = new OpenAI({
      apiKey: ctx.apiKey,
      baseURL: ctx.baseURL,
      timeout: req.timeoutMs ?? 900000,
      maxRetries: req.maxRetries ?? 0,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    const isGlm = ctx.model.includes('glm');
    const params = {
      model: ctx.model,
      messages,
      max_tokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      // GLM 계열만 thinking 비활성화 (gpt-4o/gemini 등에는 미적용)
      ...(isGlm ? { thinking: { type: 'disabled' } } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

    const response = await client.chat.completions.create(params);
    const message = response.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;

    return { text: extractContent(message), provider: ctx.id, model: ctx.model };
  },
};
