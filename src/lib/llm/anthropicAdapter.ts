import Anthropic from '@anthropic-ai/sdk';
import type { LLMAdapter, LLMRequest, LLMResult, ResolvedProvider } from './types';

// Claude 전용 어댑터. @anthropic-ai/sdk는 OpenAI 호환이 아니라 별도 구조(messages.create).
// system은 top-level, content는 블록 배열. temperature는 Opus 4.8 sampling 제약상 전달 안 함.
export const anthropicAdapter: LLMAdapter = {
  id: 'anthropic',
  implemented: true,

  async complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResult> {
    const client = new Anthropic({
      apiKey: ctx.apiKey,
      timeout: req.timeoutMs ?? 900000,
      maxRetries: req.maxRetries ?? 0,
    });

    const res = await client.messages.create({
      model: ctx.model, // 예: 'claude-opus-4-8'
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.prompt }],
    });

    // refusal 시 빈 text → 라우트가 mock/원문 fallback (침묵 실패 방지).
    const text =
      res.stop_reason === 'refusal'
        ? ''
        : res.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('');

    // 토큰 실측(과금 설계용). Anthropic은 usage.input_tokens/output_tokens.
    const u = res.usage;
    const usage = u
      ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) }
      : undefined;

    return { text, provider: ctx.id, model: ctx.model, usage };
  },
};
