import type { MeetingSummary } from '@/types';
export const LOCAL_SUMMARY_MODEL = 'onnx-community/Qwen3-0.6B-ONNX';
export const LOCAL_SUMMARY_MAX_CHARS = 10000;
export function splitLocalSummaryInput(text: string): string[] {
  if (!text.trim()) throw new Error('요약할 회의 내용이 없습니다.');
  if (text.length > LOCAL_SUMMARY_MAX_CHARS) throw new Error('기기 요약 시험 모드는 10,000자까지 지원합니다. 원문을 줄이거나 API 요약을 선택해주세요.');
  const chars = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 2000) parts.push(chars.slice(i, i + 2000).join(''));
  return parts;
}
export function parseLocalSummary(raw: string): MeetingSummary {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(clean); } catch { throw new Error('기기 AI가 완성된 요약을 만들지 못했습니다. 다시 시도하거나 API 요약을 선택해주세요.'); }
  if (!value || typeof value !== 'object') throw new Error('요약 형식이 올바르지 않습니다.');
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(y => typeof y === 'string');
  if (typeof v.overview !== 'string' || !v.overview.trim() || !strings(v.keyPoints) || !strings(v.decisions) || !Array.isArray(v.actionItems)) throw new Error('요약 필수 항목이 누락됐습니다.');
  const actions = v.actionItems.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('작업 항목 형식이 올바르지 않습니다.');
    const a = item as Record<string, unknown>;
    if (typeof a.task !== 'string' || !a.task.trim()) throw new Error('작업 내용이 누락됐습니다.');
    for (const key of ['assignee', 'deadline']) if (a[key] != null && typeof a[key] !== 'string') throw new Error('담당자·기한 형식이 올바르지 않습니다.');
    if (a.priority != null && !['high','medium','low'].includes(String(a.priority))) throw new Error('우선순위 형식이 올바르지 않습니다.');
    return { task: a.task, ...(a.assignee ? { assignee: String(a.assignee) } : {}), ...(a.deadline ? { deadline: String(a.deadline) } : {}), ...(a.priority ? { priority: a.priority as 'high' | 'medium' | 'low' } : {}) };
  });
  return { overview: v.overview, keyPoints: v.keyPoints, decisions: v.decisions, actionItems: actions };
}

/** Fail closed on invented owners/dates. This is a minimum check, not a semantic quality guarantee. */
export function validateLocalSummarySource(summary: MeetingSummary, source: string): void {
  const normalizedSource = source.replace(/\s+/g, '').toLowerCase();
  for (const action of summary.actionItems) {
    for (const field of [action.assignee, action.deadline]) {
      if (field && !normalizedSource.includes(field.replace(/\s+/g, '').toLowerCase())) {
        throw new Error('기기 요약에 원문에서 확인할 수 없는 담당자 또는 기한이 포함되어 저장을 중단했습니다. 원문으로 다시 시도하거나 API 요약을 선택해주세요.');
      }
    }
  }
}
