// 인라인 마크다운 강조(**bold**/*italic*/`code`/~~del~~)를 Run[]로 파싱.
// astParser.inlineText가 마커를 보존(strong→**..**)한 텍스트를 docx/pptx 렌더가
// 각각 TextRun / addText options로 소비. 마커 평문화(서식 영구 누락) 회귀 복원.
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}

// 마커를 Run 단위로 분해. astParser가 정확한 페어로 생성한다는 가정(불균형 리터럴은 통째 텍스트).
export function parseInlineRuns(input: string): Run[] {
  if (!input) return [];
  const runs: Run[] = [];
  // 순서: ** (strong) → ` (code) → ~~ (del) → * (em). ** 가 * 보다 먼저 매칭.
  const re = /(\*\*([^*]+?)\*\*|`([^`]+?)`|~~([^~]+?)~~|\*([^*]+?)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) runs.push({ text: input.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) runs.push({ text: m[3], code: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], strike: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], italic: true });
    last = m.index + m[0].length;
  }
  if (last < input.length) runs.push({ text: input.slice(last) });
  // 빈 run 제거(단, 전체가 빈 입력이면 빈 배열).
  const filtered = runs.filter((r) => r.text !== '');
  return filtered.length ? filtered : [{ text: input }];
}
