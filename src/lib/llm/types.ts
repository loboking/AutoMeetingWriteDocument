// LLM provider 추상화 타입. 호출부가 보는 유일한 계약.
// provider별 분기(baseURL/모델ID/thinking/응답추출)는 모듈 내부에 숨긴다.

export type ProviderId = 'zai' | 'openai' | 'gemini' | 'anthropic';

export interface LLMRequest {
  prompt: string; // user content
  system?: string; // system prompt (예: 한국어 출력 강제)
  maxTokens: number; // 호출부가 자기 값 전달 (현행 4096~16384 보존)
  temperature?: number; // OpenAI호환 전용. anthropic(Opus 4.8)은 전달 시 400 → 어댑터가 무시.
  timeoutMs?: number; // 호출부별 timeout 보존 (60s~900s)
  maxRetries?: number; // OpenAI SDK 재시도. 현행 0/1/미지정 보존. 미지정 시 0.
}

export interface LLMResult {
  text: string; // provider 무관 단일 본문
  provider: ProviderId; // 어떤 provider가 동작했는지 (로그/검증용)
  model: string; // 실제 사용 모델 id
}

// 활성 provider 1개 + 호출에 필요한 정보 (resolveProvider 반환)
export interface ResolvedProvider {
  id: ProviderId;
  model: string;
  apiKey: string;
  baseURL?: string; // OpenAI호환 전용. anthropic은 undefined.
}

export interface LLMAdapter {
  readonly id: ProviderId;
  // 어댑터 본문 구현 여부. false면 resolveAllProviders 폴백 시 건너뛴다.
  // (anthropicAdapter는 phase2 미구현 → false → 호출 안 됨)
  readonly implemented: boolean;
  complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResult>;
}
