import { describe, it, expect } from 'vitest';
import { diffLines, diffStats, collapseUnchanged } from './lineDiff';

describe('diffLines', () => {
  it('동일 텍스트는 모두 equal', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc');
    expect(d.every((l) => l.op === 'equal')).toBe(true);
    expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
  });

  it('한 줄 추가를 add로 잡는다', () => {
    const d = diffLines('a\nb', 'a\nx\nb');
    expect(diffStats(d)).toEqual({ added: 1, removed: 0 });
    expect(d.find((l) => l.op === 'add')?.text).toBe('x');
  });

  it('한 줄 삭제를 remove로 잡는다', () => {
    const d = diffLines('a\nb\nc', 'a\nc');
    expect(diffStats(d)).toEqual({ added: 0, removed: 1 });
    expect(d.find((l) => l.op === 'remove')?.text).toBe('b');
  });

  it('교체는 remove+add 조합', () => {
    const d = diffLines('hello', 'world');
    const s = diffStats(d);
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
  });

  it('빈 문자열 → 내용은 전부 add', () => {
    const d = diffLines('', 'a\nb');
    expect(diffStats(d).added).toBeGreaterThanOrEqual(2);
  });
});

describe('collapseUnchanged', () => {
  it('긴 unchanged 구간은 gap으로 접힌다', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const after = before.replace('line10', 'line10-수정');
    const hunks = collapseUnchanged(diffLines(before, after), 2);
    // 변경 주변만 남고 나머지는 gap
    expect(hunks.some((h) => h.op === 'gap')).toBe(true);
    expect(hunks.some((h) => h.op === 'add')).toBe(true);
    // 전체 40줄(add+remove+equal)보다 훨씬 짧아야
    expect(hunks.length).toBeLessThan(15);
  });

  it('변경 없으면 빈 배열', () => {
    expect(collapseUnchanged(diffLines('a\nb', 'a\nb'))).toEqual([]);
  });

  it('gap의 hidden은 숨긴 줄 수', () => {
    const before = Array.from({ length: 10 }, (_, i) => `L${i}`).join('\n');
    const after = before + '\n추가줄';
    const hunks = collapseUnchanged(diffLines(before, after), 1);
    const gap = hunks.find((h) => h.op === 'gap');
    if (gap && gap.op === 'gap') expect(gap.hidden).toBeGreaterThan(0);
  });
});
