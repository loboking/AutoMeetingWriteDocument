// PRD 생성 전, 핵심 수치 + 파생 수치를 GLM으로 "한 번" 확정한다.
// 목적: 섹션을 독립 생성할 때 같은 지표(ARPU, MRR, 전환율 등)가 섹션마다 다른 값으로
// 나오는 모순을 원천 차단. 여기서 확정된 값이 모든 섹션에 단일 출처로 주입된다.
//
// 회의에 명시된 값(요금제 9,900/29,000)뿐 아니라, 그로부터 파생되는 값(ARPU 등)도
// 여기서 한 번만 계산해 못 박는다. SaaS는 수치 정합성이 중요하므로 필수.
import OpenAI from 'openai';
import type { MeetingSummary } from '@/types';

function createClient(): OpenAI | null {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasZai = !!process.env.ZAI_API_KEY;
  if (!hasOpenAI && !hasZai) return null;
  const useZai = !hasOpenAI && hasZai;
  return new OpenAI({
    apiKey: hasOpenAI ? process.env.OPENAI_API_KEY! : process.env.ZAI_API_KEY!,
    baseURL: useZai ? (process.env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4') : 'https://api.openai.com/v1',
    timeout: 60000,
    maxRetries: 1,
  });
}

function getModel(): string {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const useZai = !hasOpenAI && !!process.env.ZAI_API_KEY;
  return useZai ? (process.env.ZAI_MODEL || 'glm-5-turbo') : 'gpt-4o';
}

/**
 * 회의에서 PRD 전체에 걸쳐 일관되게 써야 할 핵심 수치를 확정한다.
 * - 명시 수치: 회의에 직접 언급된 값 (요금제, 단가, 마진 등)
 * - 파생 수치: 명시 수치로부터 계산되는 값 (ARPU, MRR, 합계 등) — 한 번 계산해 고정
 * 반환: { 지표명: "값(근거)" } 형태. 실패 시 빈 객체(graceful).
 */
export async function resolveCoreMetrics(
  summary: MeetingSummary,
  transcript: string,
  seedMetrics?: Record<string, string>
): Promise<Record<string, string>> {
  const client = createClient();
  if (!client) return seedMetrics ?? {};

  const seedText = seedMetrics && Object.keys(seedMetrics).length > 0
    ? `\n[휴리스틱으로 1차 추출된 수치(참고)]\n${Object.entries(seedMetrics).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`
    : '';

  const prompt = `당신은 PRD 작성을 위한 수치 정합성 담당자입니다. 아래 회의 내용에서 "PRD 전체에서 단 하나의 값으로 통일해야 하는 핵심 수치"를 확정하세요.

## 회의 요약
- 개요: ${summary.overview}
- 핵심: ${(summary.keyPoints || []).join(', ')}
- 결정: ${(summary.decisions || []).join(', ')}

## 회의 녹취
${transcript.slice(0, 4000)}
${seedText}
## 규칙
1. 회의에 "명시된" 수치(요금제, 단가, 가격, 마진율, 배송비, 목표 사용자 수 등)를 그대로 추출.
2. 명시 수치로 "파생되는" 표준 지표는 **반드시 하나의 값으로 확정**하고, 정의(단위 기준)를 못 박을 것.
   - SaaS면 ARPU·MRR 같은 표준 지표를 반드시 포함. ARPU는 "사용자(좌석)당"인지 "팀(계정)당"인지 정의를 명확히 한 뒤 단 하나의 값으로 결정. (둘을 섞지 말 것)
   - 단가/비용 항목이 여럿이면 합계도 검산해 확정.
3. 회의에 근거 없는 수치는 만들지 말 것(추정 금지). 단, 표준 지표의 "정의 기준"(예: ARPU는 사용자당)은 명시할 것.
4. 값에는 단위와 1줄 근거를 포함. 같은 지표를 둘 이상의 값으로 내지 말 것.

## 출력 (JSON만, 다른 말 없이)
{ "지표명": "값 (정의/근거)", ... }
예: { "ARPU(사용자당)": "19,450원 (베이직 9,900원·프로 29,000원 단순평균, 사용자당 기준으로 통일)", "베이직 요금제": "9,900원/월/사용자", "프로 요금제": "29,000원/월/사용자" }
회의에 핵심 수치가 없으면 {} 만 출력.`;

  try {
    const model = getModel();
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      ...(model.includes('glm') ? { thinking: { type: 'disabled' } } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const msg = res.choices[0]?.message as { content?: string | null; reasoning_content?: string | null } | undefined;
    const raw = (msg?.content || '').trim() || (msg?.reasoning_content || '').trim();
    const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, ' ');
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return seedMetrics ?? {};
    const parsed = JSON.parse(match[0].replace(/```json\n?|\n?```/g, '').trim());
    // 문자열 값만 채택
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) out[k.trim()] = v.trim();
    }
    // 휴리스틱 시드도 병합(GLM이 놓친 것 보강), GLM 값 우선
    if (seedMetrics) {
      for (const [k, v] of Object.entries(seedMetrics)) {
        if (!out[k]) out[k] = v;
      }
    }
    return out;
  } catch (e) {
    console.error('[resolveCoreMetrics] 수치 확정 실패, 시드 사용:', e);
    return seedMetrics ?? {};
  }
}
