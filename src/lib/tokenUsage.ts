// 토큰 실측 기록. 과금(크레딧) 설계를 추정→실측으로 바꾸기 위한 데이터 수집.
// 서버 전용(supabaseAdmin). best-effort — 기록 실패해도 사용자 응답은 막지 않음.
// ⚠️ 지금은 "기록만". 과금·차단과 무관(그건 usageMetering/ENFORCE_LIMIT 담당).
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { LLMUsage, ProviderId } from '@/lib/llm/types';
import { getCurrentPeriod } from '@/lib/usageMetering';

// 어떤 작업이 토큰을 썼는지 분류(분석용).
export type TokenOp =
  | 'doc-generate' // 문서 생성(generate-doc)
  | 'chat' // DocHelper 대화
  | 'edit-patch' // DocHelper 부분 수정
  | 'edit-rewrite' // DocHelper 전체 재작성
  | 'research'; // DocHelper 리서치(검색)

export async function recordTokenUsage(params: {
  userId: string;
  op: TokenOp;
  provider: ProviderId;
  model: string;
  usage?: LLMUsage;
  meetingId?: string;
  docType?: string;
  projectId?: string;
}): Promise<void> {
  if (!supabaseAdmin) return;
  if (!params.usage) return; // provider가 토큰을 안 주면 기록 생략
  const { userId, op, provider, model, usage, meetingId, docType, projectId } = params;
  const { error } = await supabaseAdmin.from('token_usage').insert({
    user_id: userId,
    period: getCurrentPeriod(),
    op,
    provider,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    meeting_id: meetingId ?? null,
    project_id: projectId ?? null,
    doc_type: docType ?? null,
  });
  if (error) {
    console.error('[tokenUsage] insert error:', error.message);
  }
}
