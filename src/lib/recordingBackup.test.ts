import { describe, it, expect } from 'vitest';
import { groupIntoParts } from './recordingBackup';

const b = (s: string) => new Blob([s]);

describe('groupIntoParts', () => {
  it('파트별로 묶고 파트·순번 순으로 정렬한다 (이어서 녹음 = 별도 파트)', () => {
    const parts = groupIntoParts([
      { part: 1, seq: 1, blob: b('p1-1') },
      { part: 0, seq: 2, blob: b('p0-2') },
      { part: 1, seq: 0, blob: b('p1-0') },
      { part: 0, seq: 0, blob: b('p0-0') },
      { part: 0, seq: 1, blob: b('p0-1') },
    ]);
    expect(parts.map((p) => p.length)).toEqual([3, 2]);
  });

  it('v1 레코드(part 없음)는 파트 0으로 취급해 복구된다', () => {
    const parts = groupIntoParts([{ seq: 1, blob: b('a') }, { seq: 0, blob: b('b') }]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(2);
  });

  it('청크가 없으면 빈 배열', () => {
    expect(groupIntoParts([])).toEqual([]);
  });
});
