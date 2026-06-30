import { describe, it, expect } from 'vitest';
import { diffLines, diffStats } from './lineDiff';

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
