import { describe, it, expect } from 'vitest';
import { applyPatches } from './docPatch';

const DOC = `# PRD

## 1. 개요
출시 기간은 8주입니다.

## 2. 목표
- 사진 기록
- 주간 리포트`;

describe('applyPatches', () => {
  it('replace: 정확히 일치하면 치환', () => {
    const r = applyPatches(DOC, [{ find: '8주', replace: '10주' }]);
    expect(r.content).toContain('출시 기간은 10주입니다.');
    expect(r.applied).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('replace: 일치 안 하면 건너뛰고 실패 기록(원본 보존)', () => {
    const r = applyPatches(DOC, [{ find: '없는텍스트12345', replace: 'X' }]);
    expect(r.content).toBe(DOC); // 원본 그대로
    expect(r.applied).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.failedFinds.length).toBe(1);
  });

  it('insert: after 직후에 삽입', () => {
    const r = applyPatches(DOC, [{ after: '## 2. 목표', insert: '\n(추가된 줄)' }]);
    expect(r.content).toContain('## 2. 목표\n(추가된 줄)');
    expect(r.applied).toBe(1);
  });

  it('append: 문서 끝에 추가', () => {
    const r = applyPatches(DOC, [{ append: '## 3. 경쟁사\n내용' }]);
    expect(r.content).toContain('## 3. 경쟁사\n내용');
    expect(r.content.indexOf('## 3.')).toBeGreaterThan(r.content.indexOf('## 2.'));
  });

  it('여러 패치 혼합 — 성공/실패 카운트', () => {
    const r = applyPatches(DOC, [
      { find: '8주', replace: '12주' },
      { find: '존재안함', replace: 'Y' },
      { append: '## 끝' },
    ]);
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.content).toContain('12주');
    expect(r.content).toContain('## 끝');
  });

  it('첫 일치만 치환(중복 텍스트 안전)', () => {
    const r = applyPatches('A B A', [{ find: 'A', replace: 'X' }]);
    expect(r.content).toBe('X B A');
  });
});
