// env는 vitest.config.ts의 test.env로 주입됨(supabase 클라 로드용).
import { describe, it, expect, beforeEach } from 'vitest';
import { useMeetingStore } from './meetingStore';
import type { Meeting } from '@/types';

// setMeetings(서버 동기화 결과 반영)가 화면이 보는 currentMeeting까지
// 갱신하는지 — "다른 기기 변경이 화면(열린 회의)에 반영 안 됨" 회귀 방지.
const mk = (id: string, prd: string): Meeting => ({
  id,
  title: 't',
  createdAt: new Date(),
  updatedAt: new Date(),
  step: 'done',
  prd,
});

describe('setMeetings → currentMeeting 동기화', () => {
  beforeEach(() => {
    useMeetingStore.setState({ meetings: [], currentMeeting: null });
  });

  it('열려있는 회의가 동기화 결과에 있으면 currentMeeting도 최신본으로 교체', () => {
    const old = mk('m1', '옛날 내용');
    useMeetingStore.setState({ meetings: [old], currentMeeting: old });

    const fresh = mk('m1', '서버 최신 내용'); // 같은 id, 다른 객체
    useMeetingStore.getState().setMeetings([fresh]);

    expect(useMeetingStore.getState().currentMeeting?.prd).toBe('서버 최신 내용');
    expect(useMeetingStore.getState().meetings[0].prd).toBe('서버 최신 내용');
  });

  it('currentMeeting이 없으면 meetings만 갱신(에러 없음)', () => {
    useMeetingStore.getState().setMeetings([mk('m2', 'x')]);
    expect(useMeetingStore.getState().currentMeeting).toBeNull();
    expect(useMeetingStore.getState().meetings).toHaveLength(1);
  });

  it('동기화 결과에 열린 회의가 없으면 currentMeeting 유지', () => {
    const cur = mk('m1', 'A');
    useMeetingStore.setState({ meetings: [cur], currentMeeting: cur });
    useMeetingStore.getState().setMeetings([mk('m9', 'B')]);
    expect(useMeetingStore.getState().currentMeeting?.id).toBe('m1');
  });
});
