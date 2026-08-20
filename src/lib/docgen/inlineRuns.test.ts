import { describe, it, expect } from 'vitest';
import { parseInlineRuns } from './inlineRuns';

describe('parseInlineRuns', () => {
  it('**bold** → bold run', () => {
    expect(parseInlineRuns('a **b** c')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c' },
    ]);
  });

  it('`code` → code run', () => {
    expect(parseInlineRuns('call `foo()` now')).toEqual([
      { text: 'call ' },
      { text: 'foo()', code: true },
      { text: ' now' },
    ]);
  });

  it('*italic* → italic run (**와 구분)', () => {
    expect(parseInlineRuns('**b** *i*')).toEqual([
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'i', italic: true },
    ]);
  });

  it('~~strike~~ → strike run', () => {
    const runs = parseInlineRuns('~~취소~~');
    expect(runs[0]).toEqual({ text: '취소', strike: true });
  });

  it('마커 없으면 통째 텍스트 1개', () => {
    expect(parseInlineRuns('평문')).toEqual([{ text: '평문' }]);
  });

  it('혼합 — 결정 강조 + 코드 태그', () => {
    const runs = parseInlineRuns('**결정**: `deploy()` 실행');
    expect(runs.some((r) => r.bold && r.text === '결정')).toBe(true);
    expect(runs.some((r) => r.code && r.text === 'deploy()')).toBe(true);
  });
});
