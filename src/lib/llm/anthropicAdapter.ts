import type { LLMAdapter, LLMRequest, LLMResult, ResolvedProvider } from './types';

// Claude 전용 어댑터. @anthropic-ai/sdk는 OpenAI 호환이 아니라 별도 구조다.
//
// ── 1차(현재): 뼈대만 ──
// ANTHROPIC_API_KEY가 없으면 resolveProvider가 이 어댑터를 선택하지 않으므로
// complete()는 실행되지 않는다. 키가 들어오면 즉시 아래 에러로 "미연결"을 알린다.
//
// ── 2차(키 발급 후) 구현 가이드 ──
// import Anthropic from '@anthropic-ai/sdk';
// const client = new Anthropic({ apiKey: ctx.apiKey });
// const res = await client.messages.create({
//   model: ctx.model,                 // 'claude-opus-4-8'
//   max_tokens: req.maxTokens,
//   thinking: { type: 'adaptive' },   // Opus 4.8 권장
//   ...(req.system ? { system: req.system } : {}),  // system은 top-level
//   messages: [{ role: 'user', content: req.prompt }],
//   // ⚠️ temperature 전달 금지 — Opus 4.8은 sampling param에 400
// });
// // refusal 대비: stop_reason==='refusal'이면 빈 text 반환 → 라우트가 mock/원문 fallback
// const text = res.stop_reason === 'refusal'
//   ? ''
//   : res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
// return { text, provider: ctx.id, model: ctx.model };
export const anthropicAdapter: LLMAdapter = {
  id: 'anthropic',

  async complete(_req: LLMRequest, _ctx: ResolvedProvider): Promise<LLMResult> {
    void _req;
    void _ctx;
    throw new Error(
      'Anthropic 어댑터 미연결(phase 2). ANTHROPIC_API_KEY가 설정됐다면 anthropicAdapter.complete()를 구현하세요. (@anthropic-ai/sdk, claude-opus-4-8, adaptive thinking)'
    );
  },
};
