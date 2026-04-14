import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Meeting, MeetingStep, MeetingSummary } from '@/types';

// UUID 생성 유틸 (브라우저 호환성)
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface MeetingStore {
  // 상태
  meetings: Meeting[];
  currentMeeting: Meeting | null;
  currentStep: MeetingStep;

  // 액션
  createMeeting: (title: string) => void;
  updateMeetingStep: (step: MeetingStep) => void;
  updateCurrentMeeting: (updates: Partial<Meeting>) => void;
  saveCurrentMeeting: () => void; // currentMeeting을 meetings 배열에 저장
  deleteMeeting: (id: string) => void;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  getMeeting: (id: string) => Meeting | undefined;
}

export const useMeetingStore = create<MeetingStore>()(
  persist(
    (set, get) => ({
      meetings: [],
      currentMeeting: null,
      currentStep: 'idle',

      createMeeting: (title) => {
        const newMeeting: Meeting = {
          id: generateId(),
          title,
          createdAt: new Date(),
          step: 'idle',
        };
        set({ currentMeeting: newMeeting, currentStep: 'idle', meetings: [...get().meetings, newMeeting] });
        return newMeeting;
      },

      updateMeetingStep: (step) => {
        set({ currentStep: step });
        if (get().currentMeeting) {
          set({
            currentMeeting: { ...get().currentMeeting!, step },
          });
        }
      },

      updateCurrentMeeting: (updates) => {
        const current = get().currentMeeting;
        if (current) {
          const updated = { ...current, ...updates, updatedAt: new Date() };
          set({ currentMeeting: updated });

          // meetings 배열에도 동기화 (이미 있으면 업데이트, 없으면 추가)
          const meetings = get().meetings;
          const existingIndex = meetings.findIndex((m) => m.id === updated.id);
          if (existingIndex >= 0) {
            const updatedMeetings = [...meetings];
            updatedMeetings[existingIndex] = updated;
            set({ meetings: updatedMeetings });
          }
        }
      },

      saveCurrentMeeting: () => {
        const current = get().currentMeeting;
        if (!current) return;

        const meetings = get().meetings;
        const existingIndex = meetings.findIndex((m) => m.id === current.id);

        if (existingIndex >= 0) {
          // 이미 있으면 업데이트
          const updatedMeetings = [...meetings];
          updatedMeetings[existingIndex] = current;
          set({ meetings: updatedMeetings });
        } else {
          // 없으면 추가
          set({ meetings: [...meetings, current] });
        }
      },

      deleteMeeting: (id) => {
        set({ meetings: get().meetings.filter((m) => m.id !== id) });
      },

      setCurrentMeeting: (meeting) => {
        if (!meeting) {
          set({ currentMeeting: null, currentStep: 'idle' });
          return;
        }

        // 실제 데이터를 기반으로 step 자동 추론
        const hasDocuments = !!meeting.prd || !!meeting.userStory ||
                            !!meeting.featureList || !!meeting.screenList ||
                            !!meeting.apiSpec || !!meeting.wireframe ||
                            !!meeting.storyboard || !!meeting.testPlan ||
                            !!meeting.testCase || !!meeting.database ||
                            !!meeting.wbs || !!meeting.deployment ||
                            !!meeting.flowchart || !!meeting.ia;
        const hasSummary = !!meeting.summary;
        const hasTranscript = !!meeting.transcript?.trim();

        let inferredStep: MeetingStep = 'idle';
        if (hasDocuments || hasSummary) {
          inferredStep = 'done';
        } else if (hasTranscript) {
          inferredStep = 'summarizing';
        } else if (meeting.audioUrl) {
          inferredStep = 'transcribing';
        }

        // 저장된 step이 있으면 우선, 없으면 추론된 step 사용
        const step = meeting.step || inferredStep;
        set({ currentMeeting: meeting, currentStep: step });
      },

      getMeeting: (id) => {
        return get().meetings.find((m) => m.id === id);
      },
    }),
    {
      name: 'meeting-storage',
      partialize: (state) => ({
        meetings: state.meetings,
        currentMeeting: state.currentMeeting,
      }),
    }
  )
);
