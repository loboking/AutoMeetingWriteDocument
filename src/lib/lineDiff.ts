// 경량 라인 단위 diff (LCS). 마크다운 문서 변경 미리보기용 — 외부 의존성 없음.
export type DiffOp = 'equal' | 'add' | 'remove';
export interface DiffLine {
  op: DiffOp;
  text: string;
}

// 두 텍스트를 줄 단위로 비교해 add/remove/equal 시퀀스를 반환.
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS 길이 테이블 (n,m이 매우 크면 비용↑이나 문서 규모에선 충분)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'remove', text: a[i] });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: 'remove', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

// 변경 통계 (added/removed 줄 수)
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'add') added++;
    else if (l.op === 'remove') removed++;
  }
  return { added, removed };
}
