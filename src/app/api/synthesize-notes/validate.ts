// synthesize-notes 라우트의 입력/출력 검증 로직.
// route.ts 본문에서 분리 — 단위 테스트가 가능하게.
// H1/H2/H3(C1 보조): summaries 입력 상한 + masterSummary 응답 스키마 검증 + 인젝션 완화.

import { z } from 'zod';
import type { MeetingSummary } from '@/types';

// --- 임계 설정값 (오너 잠금 대기 — 도현/오너 확정 전 임시) ---
// 회의록 축적은 무료지만, LLM 호출 비용 폭발만 막는다.
export const MAX_SUMMARIES = 20; // 한 번에 합성할 회의 수 상한
export const MIN_SUMMARIES = 1;
export const MAX_OVERVIEW_LEN = 2000; // 각 summary.overview 문자 길이
export const MAX_KEYPOINTS = 50; // 각 summary.keyPoints 항목 수
export const MAX_DECISIONS = 50;
export const MAX_ACTION_ITEMS = 50;
export const MAX_STR_LEN = 1000; // keyPoint/decision/action.task 등 개별 문자열 길이

// masterSummary 응답 스키마. types/index.ts MeetingSummary와 동일.
// 빈 응답 {}이나 스키마 불일치를 persist 전에 잡는다(H2/H3).
const ActionItemSchema = z.object({
  task: z.string().min(1),
  assignee: z.string().optional(),
  deadline: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

export const MasterSummarySchema = z.object({
  overview: z.string().min(1),
  keyPoints: z.array(z.string()).min(0),
  decisions: z.array(z.string()).min(0),
  actionItems: z.array(ActionItemSchema).min(0),
});

export type ValidationResult = { ok: true } | { ok: false; status: number; error: string; reason?: string };

// summaries 입력 상한/형태 검증 (C1-b).
// metas는 summaries와 1:1.
export function validateSummariesBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: '요청 본문이 필요합니다.' };
  }
  const b = body as { projectId?: unknown; summaries?: unknown; metas?: unknown };

  if (typeof b.projectId !== 'string' || !b.projectId) {
    return { ok: false, status: 400, error: 'projectId가 필요합니다.' };
  }
  if (!Array.isArray(b.summaries) || b.summaries.length < MIN_SUMMARIES) {
    return { ok: false, status: 400, error: `summaries(최소 ${MIN_SUMMARIES}개)가 필요합니다.` };
  }
  if (b.summaries.length > MAX_SUMMARIES) {
    return { ok: false, status: 400, error: `summaries는 최대 ${MAX_SUMMARIES}개까지 가능합니다.` };
  }
  if (!Array.isArray(b.metas) || b.metas.length !== b.summaries.length) {
    return { ok: false, status: 400, error: 'metas는 summaries와 같은 길이여야 합니다.' };
  }

  for (let i = 0; i < b.summaries.length; i++) {
    const s = b.summaries[i] as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') {
      return { ok: false, status: 400, error: `summaries[${i}]가 객체가 아닙니다.` };
    }
    if (typeof s.overview !== 'string' || !s.overview) {
      return { ok: false, status: 400, error: `summaries[${i}].overview가 필요합니다.` };
    }
    if (s.overview.length > MAX_OVERVIEW_LEN) {
      return { ok: false, status: 400, error: `summaries[${i}].overview가 ${MAX_OVERVIEW_LEN}자를 초과합니다.` };
    }
    const arrays: Array<[string, unknown, number]> = [
      ['keyPoints', s.keyPoints, MAX_KEYPOINTS],
      ['decisions', s.decisions, MAX_DECISIONS],
      ['actionItems', s.actionItems, MAX_ACTION_ITEMS],
    ];
    for (const [name, val, max] of arrays) {
      if (val !== undefined) {
        if (!Array.isArray(val)) {
          return { ok: false, status: 400, error: `summaries[${i}].${name}이(가) 배열이 아닙니다.` };
        }
        if (val.length > max) {
          return { ok: false, status: 400, error: `summaries[${i}].${name}이(가) ${max}개를 초과합니다.` };
        }
        // 개별 문자열 길이
        for (const item of val) {
          if (typeof item === 'string' && item.length > MAX_STR_LEN) {
            return { ok: false, status: 400, error: `summaries[${i}].${name} 항목이 ${MAX_STR_LEN}자를 초과합니다.` };
          }
        }
      }
    }
  }

  return { ok: true };
}

// LLM 응답 → MeetingSummary 스키마 검증 (H2/H3).
// 빈 응답 {} / 스키마 불일치 / keyPoints가 string이 아닌 경우를 잡는다.
// 검증 실패 시 throw → route.ts catch에서 error reason 전파.
export function parseMasterSummary(raw: unknown): MeetingSummary {
  const result = MasterSummarySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`masterSummary 스키마 검증 실패: ${result.error.message}`);
  }
  return result.data as MeetingSummary;
}

// 프롬프트 인젝션 완화(H1, 완화 등급).
// 사용자 회의록이 입력이라 오탐지 위험 → 차단 아님, 로깅용 boolean만 반환.
export function detectPromptInjection(text: string): boolean {
  const patterns = [
    /ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?)/i,
    /^\s*system\s*:/im,
    /^\s*assistant\s*:/im,
    /<\|[^|]+\|>/,
  ];
  return patterns.some((p) => p.test(text));
}
