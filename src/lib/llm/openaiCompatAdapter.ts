import OpenAI from 'openai';
import type { LLMAdapter, LLMRequest, LLMResult, ResolvedProvider } from './types';
import { extractContent } from './extractContent';

// GLM(z.ai) / OpenAI / Gemini 공통 어댑터.
// 셋 다 OpenAI 호환 API라 baseURL만 바꿔 `openai` SDK를 재사용한다.
// GLM-5.3 계열은 thinking 비활성화 불가(disabled 전송 시 요청 실패) → enabled + reasoning_effort=low로 최소화.
// https://docs.z.ai/guides/llm/glm-5.3
export const openaiCompatAdapter: LLMAdapter = {
  id: 'zai', // 대표 id. 실제 id는 ctx에서 온다 (resolveProvider가 결정).
  implemented: true,

  async complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResult> {
    const client = new OpenAI({
      apiKey: ctx.apiKey,
      baseURL: ctx.baseURL,
      timeout: req.timeoutMs ?? 900000,
      maxRetries: req.maxRetries ?? 0,
    });

    // Explicit prefix caching is supported on GPT-5.6+ only. Never send these
    // OpenAI-specific fields to compatible providers or older models.
    const version = ctx.model.match(/^gpt-(\d+)(?:\.(\d+))?(?:-|$)/);
    const explicitCache = !!req.sharedContext && ctx.id === 'openai' && !!version
      && (+version[1] >= 6 || (+version[1] === 5 && +(version[2] || 0) >= 6));
    const sharedPart = { type: 'text' as const, text: req.sharedContext || '',
      ...(explicitCache ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {}) };
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    if (req.sharedContext) messages.push({ role: 'user', content: explicitCache ? [sharedPart] : req.sharedContext });
    messages.push({ role: 'user', content: req.prompt });

    const isGlm = ctx.model.includes('glm');
    // OpenAI GPT-5 계열(추론 모델)은 max_tokens·temperature를 거부(400). max_completion_tokens + reasoning_effort 사용.
    // reasoning 토큰은 출력 요금에 포함. 기본 low, env OPENAI_REASONING_EFFORT(minimal|low|medium|high)로 품질 A/B 전환.
    // gpt-6·o-시리즈도 동일(2026-09 실측: gpt-6-luna/sol이 max_tokens 400). gpt-4 계열만 구형 파라미터.
    const isGpt5 = ctx.id === 'openai' && /^(gpt-5|gpt-6|o\d)/.test(ctx.model);
    // 리서치 요청 + GLM일 때만 web_search 내장 도구 부착(추가 검색 API 키 불필요).
    const useWebSearch = !!req.enableWebSearch && isGlm;
    // 침묵 소실 금지: 모델 교체 후 리서치가 검색 없이 도는 걸 로그로 드러낸다.
    if (req.enableWebSearch && !isGlm) console.warn(`[llm] web_search는 GLM 전용 — '${ctx.model}'는 검색 없이 응답`);
    const params = {
      model: ctx.model,
      messages,
      ...(explicitCache ? { prompt_cache_options: { mode: 'explicit', ttl: '30m' } } : {}),
      ...(isGpt5
        // 추론 토큰도 max_completion_tokens에 포함된다. 호출부 maxTokens는 '본문' 예산이므로 추론 몫을 2배로 얹는다
        // (실측: medium에서 출력의 ~50%가 추론). 과금은 실제 생성분만이라 상한 상향 자체는 무비용.
        ? { max_completion_tokens: req.maxTokens * 2, reasoning_effort: process.env.OPENAI_REASONING_EFFORT || 'low' }
        : { max_tokens: req.maxTokens }),
      ...(req.temperature !== undefined && !isGpt5 ? { temperature: req.temperature } : {}),
      // GLM-5.3: thinking 끌 수 없음 → 가장 가벼운 low (env ZAI_REASONING_EFFORT: low|high|max)
      ...(isGlm ? { thinking: { type: 'enabled' }, reasoning_effort: process.env.ZAI_REASONING_EFFORT || 'low' } : {}),
      ...(useWebSearch
        ? {
            tools: [
              {
                type: 'web_search',
                web_search: {
                  enable: 'True',
                  search_engine: 'search-prime',
                  search_result: 'True',
                  count: '3', // 5→3: 검색·요약 부담 낮춰 응답 속도 개선(timeout 방지)
                  search_recency_filter: 'noLimit',
                  content_size: 'medium', // high→medium: 요약 길이 축소로 가속
                },
              },
            ],
          }
        : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

    const response = await client.chat.completions.create(params);
    const message = response.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;

    // A truncated or refused response must not be stored as a completed document.
    const choice = response.choices[0];
    if (choice?.finish_reason === 'length' || choice?.finish_reason === 'content_filter') {
      throw new Error(`문서 생성 미완료 (${choice.finish_reason}). 완성된 응답으로 저장하지 않습니다.`);
    }
    if (!message?.content?.trim()) {
      throw new Error('문서 본문이 비어 있습니다. 추론 내용은 문서로 저장하지 않습니다.');
    }

    // 토큰 실측(과금 설계용). OpenAI 호환은 usage.prompt_tokens/completion_tokens 제공.
    const u = response.usage;
    const usage = u
      ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0,
          cachedInputTokens: u.prompt_tokens_details?.cached_tokens,
          cacheWriteInputTokens: (u.prompt_tokens_details as { cache_write_tokens?: number } | undefined)?.cache_write_tokens,
          reasoningTokens: u.completion_tokens_details?.reasoning_tokens }
      : undefined;

    return { text: extractContent(message), provider: ctx.id, model: response.model || ctx.model, usage };
  },
};
