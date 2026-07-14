// notesMigrate 마이그레이션 로직 단위테스트.
// supabase 직접 호출을 모킹해 필터링/플래그/멱등/손실0 검증.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// SSR 가드(typeof window === 'undefined')를 통과하기 위해 window를 정의
Object.defineProperty(globalThis, 'window', { value: {}, writable: true });

// localStorage 환경 모킹 (SSR 가드용 window check)
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn<(key: string) => string | null>((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// supabase 모킹
const mockUpsert = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: mockUpsert,
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
  },
  meetingNoteToRow: (note: unknown) => note,
  rowToMeetingNote: (row: unknown) => row,
}));

import { migrateLocalMeetingNotes } from './notesMigrate';
import type { MeetingNote, MeetingSummary } from '@/types';

const mkSummary = (): MeetingSummary => ({
  overview: 'test',
  keyPoints: [],
  decisions: [],
  actionItems: [],
});

const mkNote = (id: string): MeetingNote => ({
  id,
  title: `Note ${id}`,
  createdAt: new Date('2026-07-01'),
  transcript: 'test transcript',
  summary: mkSummary(),
});

describe('migrateLocalMeetingNotes', () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('플래그 이미 있으면 아무것도 안 한다(멱등)', async () => {
    localStorageMock.getItem.mockReturnValue('1');
    await migrateLocalMeetingNotes('user-1', [mkNote('n1')], []);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('서버에 없는 로컬 노트만 upsert한다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1'), mkNote('n2')];
    const server = [mkNote('n1')]; // n1은 서버에 이미 있음

    await migrateLocalMeetingNotes('user-1', local, server);

    // n2만 upsert 호출되어야 함
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('서버에 모두 있으면 플래그만 set하고 upsert 안 한다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1'), mkNote('n2')];
    const server = [mkNote('n1'), mkNote('n2')];

    await migrateLocalMeetingNotes('user-1', local, server);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');
  });

  it('전부 성공하면 플래그를 set한다', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1')];
    const server: MeetingNote[] = [];

    await migrateLocalMeetingNotes('user-1', local, server);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');
  });

  it('부분 실패 시 플래그를 set하지 않는다(다음 tick 재시도)', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1'), mkNote('n2'), mkNote('n3')];

    // n2만 실패
    mockUpsert.mockImplementation(() => {
      const callCount = mockUpsert.mock.calls.length;
      if (callCount === 1) return Promise.resolve({ error: null }); // n1 성공
      return Promise.resolve({ error: { message: 'fail' } });     // n2,n3 실패
    });

    await migrateLocalMeetingNotes('user-1', local, []);

    // n3은 n2 실패 후에도 계속 시도됨(멱등 보장)
    expect(mockUpsert).toHaveBeenCalledTimes(3);
    // 부분 실패 → 플래그 미설정
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');
  });

  it('로컬 노트가 없으면 플래그를 set한다(빈 상태에서도 완료 처리)', async () => {
    localStorageMock.getItem.mockReturnValue(null);

    await migrateLocalMeetingNotes('user-1', [], []);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');
  });

  it('재실행 시 멱등 — 이미 플래그가 있으면 서버 호출 없음', async () => {
    // 첫 실행: 마이그레이션 완료
    localStorageMock.getItem.mockReturnValueOnce(null);
    await migrateLocalMeetingNotes('user-1', [mkNote('n1')], []);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('mad:notes-migrated:user-1', '1');

    // 두 번째 실행: 플래그 있음
    localStorageMock.getItem.mockReturnValue('1');
    await migrateLocalMeetingNotes('user-1', [mkNote('n1'), mkNote('n2')], []);
    expect(mockUpsert).toHaveBeenCalledTimes(1); // 첫 실행의 1회만
  });

  it('손실 0: 로컬 노트 수 ≥ upsert 호출 수 (서버에 있는 건 제외)', async () => {
    localStorageMock.getItem.mockReturnValue(null);
    const local = [mkNote('n1'), mkNote('n2'), mkNote('n3')];
    const server = [mkNote('n2')]; // n2는 이미 서버에 있음

    await migrateLocalMeetingNotes('user-1', local, server);

    // n1, n3만 upsert → 2회
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });
});
