// MeetingNote(① 회의록 모드 독립 산출) CRUD + 타입 컴파일 검증.
// 14문서/Project FK 없이 가벼운 산출 — Meeting과 분리됨을 회귀 방지.
import { describe, it, expect, beforeEach } from 'vitest';
import { useMeetingStore } from './meetingStore';
import type { MeetingNote, MeetingSummary } from '@/types';
import type { TranscriptSegment } from '@/lib/stt/types';

const mkSummary = (prefix = 's'): MeetingSummary => ({
  overview: `${prefix}-overview`,
  keyPoints: [`${prefix}-kp`],
  decisions: [],
  actionItems: [],
});

const mkSegments = (): TranscriptSegment[] => [
  { speaker: '화자 1', text: '안녕', start: 0, end: 0 },
  { speaker: '화자 2', text: '네', start: 0, end: 0 },
];

// 타입 컴파일 검증: MeetingNote는 14문서 필드를 갖지 않는다(YAGNI 불변식).
// (이 객체 리터럴이 tsc를 통과하면 타입이 올바름 — 14문서/Project FK 없는 가벼운 산출)
describe('MeetingNote 타입', () => {
  it('14문서 필드(prd 등) 없이 생성할 수 있다', () => {
    const note: MeetingNote = {
      id: 'n1',
      title: '주간 회의',
      createdAt: new Date(),
      transcript: '녹음 내용',
      summary: mkSummary(),
    };
    expect(note.id).toBe('n1');
    // prd는 MeetingNote 스키마에 없으므로 런타임에도 undefined
    expect((note as unknown as Record<string, unknown>).prd).toBeUndefined();
  });
});

describe('MeetingNote store CRUD', () => {
  beforeEach(() => {
    useMeetingStore.setState({ meetingNotes: [] });
  });

  it('createMeetingNote로 생성 후 getMeetingNote로 조회된다', () => {
    const created = useMeetingStore.getState().createMeetingNote({
      id: 'n1',
      title: '주간 회의',
      transcript: '녹음 내용',
      summary: mkSummary(),
      transcriptSegments: mkSegments(),
      duration: 510,
      source: 'recording',
    });

    expect(created.id).toBe('n1');
    expect(created.transcriptSegments).toHaveLength(2);

    const got = useMeetingStore.getState().getMeetingNote('n1');
    expect(got).toBeDefined();
    expect(got?.title).toBe('주간 회의');
    expect(got?.source).toBe('recording');
  });

  it('updateMeetingNote로 부분 갱신하면 updatedAt이 찍힌다', () => {
    useMeetingStore.getState().createMeetingNote({
      id: 'n1',
      title: '구 제목',
      transcript: 'x',
      summary: mkSummary(),
    });
    const before = useMeetingStore.getState().getMeetingNote('n1')!;

    useMeetingStore.getState().updateMeetingNote('n1', { title: '새 제목' });

    const after = useMeetingStore.getState().getMeetingNote('n1')!;
    expect(after.title).toBe('새 제목');
    expect(after.updatedAt?.getTime()).toBeGreaterThanOrEqual(before.createdAt.getTime());
  });

  it('존재하지 않는 id update는 무시한다(에러 없음)', () => {
    expect(() => useMeetingStore.getState().updateMeetingNote('nope', { title: 'x' })).not.toThrow();
    expect(useMeetingStore.getState().meetingNotes).toHaveLength(0);
  });

  it('deleteMeetingNote로 삭제된다', () => {
    useMeetingStore.getState().createMeetingNote({
      id: 'n1',
      title: 't',
      transcript: 'x',
      summary: mkSummary(),
    });
    useMeetingStore.getState().deleteMeetingNote('n1');
    expect(useMeetingStore.getState().getMeetingNote('n1')).toBeUndefined();
  });

  it('여러 노트가 최신 생성순(unshift)으로 맨 앞에 쌓인다', () => {
    useMeetingStore.getState().createMeetingNote({ id: 'n1', title: '1', transcript: '', summary: mkSummary() });
    useMeetingStore.getState().createMeetingNote({ id: 'n2', title: '2', transcript: '', summary: mkSummary() });
    const notes = useMeetingStore.getState().meetingNotes;
    expect(notes[0].id).toBe('n2'); // 최신이 맨 앞
    expect(notes[1].id).toBe('n1');
  });
});
