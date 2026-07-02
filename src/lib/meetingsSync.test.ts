// env는 vitest.config.ts의 test.env로 주입됨(supabase 클라 로드용).
import { describe, it, expect } from 'vitest';
import { mergeServer } from './meetingsSync';
import type { Meeting } from '@/types';

// persist 복원 시 실제로는 문자열 날짜가 들어오므로(mergeServer는 문자열도 처리),
// 테스트도 그 실상황을 반영해 문자열로 두고 타입만 맞춘다.
const mk = (id: string, updatedAt: string): Meeting =>
  ({ id, title: id, createdAt: updatedAt, updatedAt, step: 'done' } as unknown as Meeting);

describe('mergeServer', () => {
  it('로컬+서버 합집합, 같은 id는 최신(updatedAt) 채택', () => {
    const local = [mk('a', '2026-07-01T00:00:00Z')];
    const server = [mk('a', '2026-07-02T00:00:00Z'), mk('b', '2026-07-01T00:00:00Z')];
    const r = mergeServer(local, server);
    expect(r.find((m) => m.id === 'a')?.updatedAt).toBe('2026-07-02T00:00:00Z'); // 서버 최신
    expect(r.find((m) => m.id === 'b')).toBeTruthy(); // 서버에만 있는 것도 포함
    expect(r).toHaveLength(2);
  });

  // ★ 삭제 부활 버그 회귀 방지: 로컬에서 지운 회의가 서버에 남아있어도 되살아나면 안 됨
  it('deletedIds에 있는 회의는 서버에 남아있어도 부활하지 않는다', () => {
    const local: Meeting[] = []; // 방금 삭제해서 로컬엔 없음
    const server = [mk('deleted-1', '2026-07-01T00:00:00Z')]; // 서버 삭제가 아직 안 끝나 남아있음
    const r = mergeServer(local, server, ['deleted-1']);
    expect(r.find((m) => m.id === 'deleted-1')).toBeUndefined(); // 부활 안 함
    expect(r).toHaveLength(0);
  });

  it('deletedIds가 로컬에도 남아있으면 그것도 제외', () => {
    const local = [mk('x', '2026-07-01T00:00:00Z'), mk('y', '2026-07-01T00:00:00Z')];
    const server = [mk('x', '2026-07-01T00:00:00Z')];
    const r = mergeServer(local, server, ['x']);
    expect(r.find((m) => m.id === 'x')).toBeUndefined();
    expect(r.find((m) => m.id === 'y')).toBeTruthy();
  });

  it('deletedIds 없으면 기존 동작(부활O) — 버그 재현 확인용', () => {
    const local: Meeting[] = [];
    const server = [mk('z', '2026-07-01T00:00:00Z')];
    const r = mergeServer(local, server); // deletedIds 안 넘김
    expect(r.find((m) => m.id === 'z')).toBeTruthy(); // 옛 동작: 서버 것 부활
  });
});
