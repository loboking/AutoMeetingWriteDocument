import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meeting, MeetingNote } from '@/types';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase')>();
  return {
    ...actual,
    supabase: { from: () => ({ select: () => ({ order: query }) }) },
  };
});

import { fetchMeetings } from './meetingsSync';
import { fetchMeetingNotes } from './notesSync';
import { useMeetingStore } from '@/store/meetingStore';

const meeting: Meeting = {
  id: 'local-meeting', title: '기존 기획서', createdAt: new Date(), step: 'done',
  prd: '# 원본 설계\n\n이 내용은 조회 실패 시에도 보존되어야 한다.',
};
const note: MeetingNote = {
  id: 'local-note', title: '기존 회의록', createdAt: new Date(),
  transcript: '보존할 녹취록',
  summary: { overview: '보존할 요약', keyPoints: [], decisions: [], actionItems: [] },
};

beforeEach(() => {
  query.mockReset();
  useMeetingStore.setState({
    meetings: [meeting], currentMeeting: meeting, meetingNotes: [note],
    isSyncing: false, isSyncingNotes: false, syncError: null, notesSyncError: null,
  });
});

describe('조회 실패를 빈 동기화 결과로 처리하지 않는다', () => {
  it.each([
    ['기획서', fetchMeetings], ['회의록', fetchMeetingNotes],
  ])('%s 조회 실패는 호출자에게 전달한다', async (_label, fetch) => {
    query.mockResolvedValue({ data: null, error: { message: 'connection unavailable' } });
    await expect(fetch()).rejects.toThrow('connection unavailable');
  });

  it('정상적으로 비어 있는 계정은 빈 결과를 반환한다', async () => {
    query.mockResolvedValue({ data: [], error: null });
    await expect(fetchMeetings()).resolves.toEqual([]);
    await expect(fetchMeetingNotes()).resolves.toEqual([]);
  });

  it('기획서 동기화 실패를 알리고 열린 문서와 목록을 그대로 보존한다', async () => {
    query.mockResolvedValue({ data: null, error: { message: 'meeting read failed' } });
    await expect(useMeetingStore.getState().syncFromServer()).rejects.toThrow('meeting read failed');
    const state = useMeetingStore.getState();
    expect(state.currentMeeting).toBe(meeting);
    expect(state.meetings).toEqual([meeting]);
    expect(state.isSyncing).toBe(false);
    expect(state.syncError).toContain('동기화에 실패');
  });

  it('회의록 동기화 실패를 알리고 원문·요약을 그대로 보존한다', async () => {
    query.mockResolvedValue({ data: null, error: { message: 'note read failed' } });
    await expect(useMeetingStore.getState().syncMeetingNotesFromServer()).rejects.toThrow('note read failed');
    const state = useMeetingStore.getState();
    expect(state.meetingNotes).toEqual([note]);
    expect(state.isSyncingNotes).toBe(false);
    expect(state.notesSyncError).toContain('동기화에 실패');
  });
});
