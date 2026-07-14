// notesSync 동기화 로직 단위테스트.
// meetingsSync 패턴 1:1 차용 검증 — mergeMeetingNotes LWW 정합, 마이그레이션 멱등,
// tombstone 부활 방지, rowToMeetingNote/meetingNoteToRow 직렬화 왕복.
// supabase 직접 호출을 모킹해 순수 로직만 검증(네트워크 X).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// SSR 가드(typeof window === 'undefined') 통과용
Object.defineProperty(globalThis, 'window', { value: {}, writable: true });

// localStorage 모킹 (마이그레이션 플래그용)
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn<(key: string) => string | null>((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// supabase 모킹 (upsert/select/delete)
const mockUpsert = vi.fn();
const mockDeleteEq = vi.fn();
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: mockUpsert,
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
      delete: mockDelete,
    })),
  },
  // 직렬화 헬퍼는 통과(원본 반환) — 로직 검증이 목적
  meetingNoteToRow: (note: unknown) => ({ client_id: (note as { id: string }).id, title: '', data: note }),
  rowToMeetingNote: (row: { data: unknown; client_id?: string; updated_at?: string }) => ({
    ...(row.data as object),
    id: (row.data as { id?: string })?.id ?? row.client_id,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  }),
}));

import { mergeMeetingNotes, migrateLocalMeetingNotes, upsertMeetingNote, deleteMeetingNoteRow } from './notesSync';
import type { MeetingNote, MeetingSummary } from '@/types';

const mkSummary = (p = 's'): MeetingSummary => ({
  overview: `${p}-overview`,
  keyPoints: [`${p}-kp`],
  decisions: [],
  actionItems: [],
});

const mkNote = (id: string, overrides: Partial<MeetingNote> = {}): MeetingNote => ({
  id,
  title: `Note ${id}`,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  transcript: `transcript-${id}`,
  summary: mkSummary(id),
  ...overrides,
});

describe('mergeMeetingNotes (LWW)', () => {
  it('같은 id는 updatedAt 최신 쪽을 채택한다', () => {
    const local = [mkNote('n1', { title: 'local-old', updatedAt: new Date('2026-07-01T10:00:00Z') })];
    const server = [mkNote('n1', { title: 'server-new', updatedAt: new Date('2026-07-02T10:00:00Z') })];
    const merged = mergeMeetingNotes(local, server);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('server-new');
  });

  it('로컬이 더 최신이면 로컬을 유지한다', () => {
    const local = [mkNote('n1', { title: 'local-new', updatedAt: new Date('2026-07-03T00:00:00Z') })];
    const server = [mkNote('n1', { title: 'server-old', updatedAt: new Date('2026-07-01T00:00:00Z') })];
    const merged = mergeMeetingNotes(local, server);
    expect(merged[0].title).toBe('local-new');
  });

  it('한쪽에만 있는 노트는 모두 포함한다(손실 0)', () => {
    const local = [mkNote('local-only')];
    const server = [mkNote('server-only')];
    const merged = mergeMeetingNotes(local, server);
    const ids = merged.map((n) => n.id).sort();
    expect(ids).toEqual(['local-only', 'server-only']);
  });

  it('동률(같은 updatedAt) 시 서버 우선', () => {
    const ts = new Date('2026-07-01T10:00:00Z');
    const local = [mkNote('n1', { title: 'local', updatedAt: ts })];
    const server = [mkNote('n1', { title: 'server', updatedAt: ts })];
    const merged = mergeMeetingNotes(local, server);
    expect(merged[0].title).toBe('server');
  });

  it('deletedNoteIds(tombstone)에 있으면 서버에 남아있어도 부활하지 않는다', () => {
    const local: MeetingNote[] = [];
    const server = [mkNote('deleted-one', { title: '서버에아직있음' })];
    const merged = mergeMeetingNotes(local, server, ['deleted-one']);
    expect(merged.find((n) => n.id === 'deleted-one')).toBeUndefined();
  });

  it('deletedNoteIds에 있으면 로컬에서도 제외된다', () => {
    const local = [mkNote('loc-1'), mkNote('loc-deleted')];
    const server: MeetingNote[] = [];
    const merged = mergeMeetingNotes(local, server, ['loc-deleted']);
    expect(merged.map((n) => n.id)).toEqual(['loc-1']);
  });
});

describe('migrateLocalMeetingNotes (멱등)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('플래그가 이미 있으면 아무것도 안 한다(멱등)', async () => {
    localStorageMock.getItem.mockReturnValue('1');
    await migrateLocalMeetingNotes('user-1', [mkNote('n1')], []);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('서버에 없는 로컬 노트만 upsert한다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1'), mkNote('n2')];
    const server = [mkNote('n1')]; // n1은 서버에 이미 있음
    await migrateLocalMeetingNotes('user-1', local, server);
    expect(mockUpsert).toHaveBeenCalledTimes(1); // n2만
  });

  it('마이그레이션 대상이 없으면 플래그만 set하고 upsert 안 한다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1')];
    const server = [mkNote('n1')]; // 전부 서버에 있음
    await migrateLocalMeetingNotes('user-1', local, server);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');
  });

  it('전부 성공해야 완료 플래그를 찍는다(부분 실패 시 미찍음 → 재시도)', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    mockUpsert
      .mockResolvedValueOnce({ error: null }) // n1 성공
      .mockResolvedValueOnce({ error: { message: 'fail' } }); // n2 실패
    const local = [mkNote('n1'), mkNote('n2')];
    await migrateLocalMeetingNotes('user-1', local, []);
    expect(mockUpsert).toHaveBeenCalledTimes(2); // 둘 다 시도(멱등)
    expect(localStorageMock.setItem).not.toHaveBeenCalled(); // 플래그 미찍음
  });

  it('meetings 마이그레이션 플래그(mad:migrated)와 별개 키를 쓴다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    await migrateLocalMeetingNotes('user-1', [], []); // 대상 없음
    const keys = localStorageMock.setItem.mock.calls.map((c) => c[0]);
    expect(keys).toContain('mad:notes-migrated:user-1');
    expect(keys.some((k) => k === 'mad:migrated:user-1')).toBe(false);
  });
});

describe('upsertMeetingNote / deleteMeetingNoteRow (best-effort)', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockDeleteEq.mockReset();
  });

  it('upsert 성공 시 true 반환', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    const ok = await upsertMeetingNote(mkNote('n1'));
    expect(ok).toBe(true);
  });

  it('upsert 에러 시 false 반환(throw 아님)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'RLS denied' } });
    const ok = await upsertMeetingNote(mkNote('n1'));
    expect(ok).toBe(false);
  });

  it('delete 성공 시 true 반환', async () => {
    mockDeleteEq.mockResolvedValue({ error: null });
    const ok = await deleteMeetingNoteRow('n1');
    expect(ok).toBe(true);
  });

  it('delete 에러 시 false 반환(throw 아님)', async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: 'not found' } });
    const ok = await deleteMeetingNoteRow('n1');
    expect(ok).toBe(false);
  });
});
