// 긴 회의록 텍스트를 분할 요약(map-reduce)하기 위한 순수 함수.
// 루트 원인: summarize가 전체 텍스트를 1회 LLM 호출에 통째 → 출력 JSON이 8192 토큰을 넘으면
// 중간에 잘려 JSON.parse 실패 → getMockSummary(가짜) 반환. 사용자는 "회의가 짤렸다"고 인식.
// 해결: 입력이 임계치 넘으면 문단/줄 단위 청크로 나눠 각각 요약(GLM 안정 8192) 후 병합.
// maxTokens 상향(16384)은 GLM 500 실패 위험(prdChunkGenerator 관측)이라 쓰지 않는다.
import type { MeetingSummary } from '@/types';

// 이 길이(자) 초과 시 분할. 한국어 ~6K 토큰 — GLM 128K context에 넉넉, 응답 8192와 균형.
export const CHUNK_CHAR_THRESHOLD = 12000;
// 청크 목표 크기(자). 임계치를 넘었을 때 이 크기 단위로 자른다.
export const CHUNK_TARGET_CHARS = 10000;

// 회의록 텍스트를 문단(빈 줄) 우선, 너무 길면 줄 단위로 청크 분할.
// 빈 결과/빈 입력은 [''] 가 아닌 빈 배열 또는 원본 1개 반환(호출부가 빈 청크 요약 안 하도록).
export function splitTranscript(text: string, target = CHUNK_TARGET_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= target) return [trimmed];

  const paragraphs = trimmed.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    const t = cur.trim();
    if (t) chunks.push(t);
    cur = '';
  };

  for (const para of paragraphs) {
    // 문단 자체가 target보다 크면 줄 단위로 쪼갠다(재귀 대신 인라인 — 1단계면 충분).
    if (para.length > target) {
      flush();
      const lines = para.split('\n');
      let lineBuf = '';
      for (const ln of lines) {
        const candidate = lineBuf ? lineBuf + '\n' + ln : ln;
        if (candidate.length > target && lineBuf) {
          chunks.push(lineBuf.trim());
          lineBuf = ln;
        } else {
          lineBuf = candidate;
        }
      }
      if (lineBuf.trim()) cur = lineBuf; // 남은 줄은 다음 문단과 합칠 수 있게 cur로
      continue;
    }
    const candidate = cur ? cur + '\n\n' + para : para;
    if (candidate.length > target && cur) {
      flush();
      cur = para;
    } else {
      cur = candidate;
    }
  }
  flush();

  // 분할 결과가 1개 이하면 원본 통째(분할 무의미).
  return chunks.length > 1 ? chunks : [trimmed];
}

// 분량이 임계치를 넘는지(=분할 필요) 판정. route가 이 값으로 분기.
export function needsChunking(text: string, threshold = CHUNK_CHAR_THRESHOLD): boolean {
  return text.length > threshold;
}

// 비교 정규화 — 공백 전부 제거 + 소문자로 중복 판정.
// 공백 축소가 아니라 제거인 이유: '결정1'과 '결정 1'을 같은 안건으로 본다. 한국어 요약
// 항목 수준에서 공백 차이는 같은 문장의 변주일 가능성이 높고, 중복 제거가 목적이므로.
function norm(s: string): string {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

// 문자열 배열에서 정규화 기준 중복 제거(첫 등장 순서 보존).
function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const key = norm(x);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

// 청크별 요약을 하나로 병합.
// - overview: 각 청크 overview를 문단 구분자로 이어붙임(회의 흐름 보존).
// - keyPoints/decisions: 전체 concat 후 중복 제거(같은 안건이 여러 청크에 걸쳐 중복 등장).
// - actionItems: task 기준 중복 제거.
export function mergeSummaries(parts: MeetingSummary[]): MeetingSummary {
  const nonEmpty = parts.filter(Boolean);
  const overview = nonEmpty
    .map((p) => (p.overview || '').trim())
    .filter(Boolean)
    .join('\n\n');

  const keyPoints = dedupeStrings(nonEmpty.flatMap((p) => p.keyPoints || []));
  const decisions = dedupeStrings(nonEmpty.flatMap((p) => p.decisions || []));

  const seenTasks = new Set<string>();
  const actionItems = nonEmpty
    .flatMap((p) => p.actionItems || [])
    .filter((a) => {
      const key = norm(a.task);
      if (!key || seenTasks.has(key)) return false;
      seenTasks.add(key);
      return true;
    });

  return { overview, keyPoints, decisions, actionItems };
}
