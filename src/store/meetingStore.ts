import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Meeting, MeetingStep, MeetingSummary, DocType, DocStatus } from '@/types';
import { DOCUMENTS, DEPENDENCIES, docTypeToField, getAllDependents } from '@/lib/documentUtils';

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

// 전체 생성 진행 상태 (persist 제외, 새로고침 시 리셋)
export interface GenerationProgress {
  currentLevel: number;
  totalLevels: number;
  currentDoc: string;
  completedDocs: DocType[];
  status: 'generating' | 'completed' | 'error' | 'cancelled';
}

// 직렬화 불가한 캔슬 제어는 store state가 아닌 모듈 스코프에 보관.
// HMR(dev) 시 모듈 재평가로 끊기지 않도록 globalThis에 캐시.
type GenAbort = { controller: AbortController | null; cancelled: boolean };
const __g = globalThis as unknown as { __genAbort?: GenAbort };
const genAbort: GenAbort = __g.__genAbort ?? (__g.__genAbort = { controller: null, cancelled: false });

// DEPENDENCIES 위상정렬 (Kahn): 의존 문서가 먼저 오도록 14개 순서 결정
function topoSortDocs(): DocType[] {
  const allKeys = DOCUMENTS.map((d) => d.key);
  const result: DocType[] = [];
  const remaining = new Set(allKeys);
  while (remaining.size > 0) {
    let progressed = false;
    for (const k of allKeys) {
      if (!remaining.has(k)) continue;
      const depsLeft = (DEPENDENCIES[k] || []).filter((d) => remaining.has(d));
      if (depsLeft.length === 0) {
        result.push(k);
        remaining.delete(k);
        progressed = true;
      }
    }
    if (!progressed) {
      remaining.forEach((k) => result.push(k));
      break;
    }
  }
  return result;
}

interface MeetingStore {
  // 상태
  meetings: Meeting[];
  currentMeeting: Meeting | null;
  currentStep: MeetingStep;

  // 전체 생성 상태 (persist 제외)
  isGenerating: boolean;
  generationProgress: GenerationProgress | null;
  generatingMeetingId: string | null;

  // 문서 상태 관리 (meetingId -> docType -> status)
  docStatuses: Record<string, Record<DocType, DocStatus>>;
  docVersions: Record<string, Record<DocType, number>>;
  frozenDocs: Record<string, DocType[]>;  // meetingId -> frozen docTypes

  // 액션
  createMeeting: (title: string) => void;
  updateMeetingStep: (step: MeetingStep) => void;
  updateCurrentMeeting: (updates: Partial<Meeting>) => void;
  saveCurrentMeeting: () => void; // currentMeeting을 meetings 배열에 저장
  deleteMeeting: (id: string) => void;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  getMeeting: (id: string) => Meeting | undefined;

  // 학습 완료 관련 액션
  toggleCompleteDoc: (docType: DocType) => void;
  isDocCompleted: (docType: DocType) => boolean;
  getNextIncompleteDoc: () => DocType | null;
  setAutoAdvance: (enabled: boolean) => void;

  // 문서 상태 관리 액션
  setDocStatus: (meetingId: string, docType: DocType, status: DocStatus) => void;
  getDocStatus: (meetingId: string, docType: DocType) => DocStatus;
  incrementDocVersion: (meetingId: string, docType: DocType) => void;
  getDocVersion: (meetingId: string, docType: DocType) => number;
  freezeDoc: (meetingId: string, docType: DocType) => void;
  unfreezeDoc: (meetingId: string, docType: DocType) => void;
  isDocFrozen: (meetingId: string, docType: DocType) => boolean;
  markDependentsOutdated: (meetingId: string, docType: DocType) => void;
  canRegenerateDoc: (meetingId: string, docType: DocType) => { can: boolean; reason?: string };

  // 전체 문서 생성 (백그라운드 지속 + 캔슬)
  startGeneration: () => Promise<void>;
  cancelGeneration: () => void;
}

export const useMeetingStore = create<MeetingStore>()(
  persist(
    (set, get) => ({
      meetings: [],
      currentMeeting: null,
      currentStep: 'idle',
      docStatuses: {},
      docVersions: {},
      frozenDocs: {},
      isGenerating: false,
      generationProgress: null,
      generatingMeetingId: null,

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

      // 학습 완료 관련 액션
      toggleCompleteDoc: (docType) => {
        const current = get().currentMeeting;
        if (!current) return;

        const completedDocs = current.completedDocs || [];
        const isCompleted = completedDocs.includes(docType);

        let newCompletedDocs: DocType[];
        if (isCompleted) {
          // 완료 취소
          newCompletedDocs = completedDocs.filter(d => d !== docType);
        } else {
          // 완료 추가
          newCompletedDocs = [...completedDocs, docType];
        }

        get().updateCurrentMeeting({ completedDocs: newCompletedDocs });
      },

      isDocCompleted: (docType) => {
        const current = get().currentMeeting;
        if (!current) return false;
        return (current.completedDocs || []).includes(docType);
      },

      getNextIncompleteDoc: () => {
        const current = get().currentMeeting;
        if (!current) return null;

        const completedDocs = current.completedDocs || [];

        for (const doc of DOCUMENTS) {
          // 문서가 생성되어 있고 완료되지 않은 문서 반환
          const docField = doc.key === 'feature-list' ? 'featureList' :
                          doc.key === 'screen-list' ? 'screenList' :
                          doc.key === 'user-story' ? 'userStory' :
                          doc.key === 'api-spec' ? 'apiSpec' :
                          doc.key === 'test-plan' ? 'testPlan' :
                          doc.key === 'test-case' ? 'testCase' :
                          doc.key;
          const hasDoc = !!current[docField as keyof Meeting];
          if (hasDoc && !completedDocs.includes(doc.key)) {
            return doc.key;
          }
        }
        return null;
      },

      setAutoAdvance: (enabled) => {
        get().updateCurrentMeeting({ autoAdvance: enabled });
      },

      // 문서 상태 관리 액션
      setDocStatus: (meetingId, docType, status) => {
        const docStatuses = { ...get().docStatuses };
        if (!docStatuses[meetingId]) {
          docStatuses[meetingId] = {} as Record<DocType, DocStatus>;
        }
        docStatuses[meetingId] = {
          ...docStatuses[meetingId],
          [docType]: status,
        };
        set({ docStatuses });
      },

      getDocStatus: (meetingId, docType) => {
        const { docStatuses, frozenDocs } = get();
        const meetingFrozenDocs = frozenDocs[meetingId] || [];

        // frozen 상태면 frozen 반환
        if (meetingFrozenDocs.includes(docType)) {
          return 'frozen';
        }

        return docStatuses[meetingId]?.[docType] || 'latest';
      },

      incrementDocVersion: (meetingId, docType) => {
        const docVersions = { ...get().docVersions };
        if (!docVersions[meetingId]) {
          docVersions[meetingId] = {} as Record<DocType, number>;
        }
        const currentVersion = docVersions[meetingId][docType] || 0;
        docVersions[meetingId] = {
          ...docVersions[meetingId],
          [docType]: currentVersion + 1,
        };
        set({ docVersions });
      },

      getDocVersion: (meetingId, docType) => {
        return get().docVersions[meetingId]?.[docType] || 0;
      },

      freezeDoc: (meetingId, docType) => {
        const frozenDocs = { ...get().frozenDocs };
        const meetingFrozenDocs = frozenDocs[meetingId] || [];
        if (!meetingFrozenDocs.includes(docType)) {
          frozenDocs[meetingId] = [...meetingFrozenDocs, docType];
          set({ frozenDocs });
        }
      },

      unfreezeDoc: (meetingId, docType) => {
        const frozenDocs = { ...get().frozenDocs };
        const meetingFrozenDocs = frozenDocs[meetingId] || [];
        frozenDocs[meetingId] = meetingFrozenDocs.filter(d => d !== docType);
        set({ frozenDocs });
      },

      isDocFrozen: (meetingId, docType) => {
        const meetingFrozenDocs = get().frozenDocs[meetingId] || [];
        return meetingFrozenDocs.includes(docType);
      },

      markDependentsOutdated: (meetingId, docType) => {
        const dependents = getAllDependents(docType);
        const { frozenDocs, docStatuses } = get();
        const meetingFrozenDocs = frozenDocs[meetingId] || [];

        const newStatuses = { ...docStatuses };
        if (!newStatuses[meetingId]) {
          newStatuses[meetingId] = {} as Record<DocType, DocStatus>;
        }

        dependents.forEach(dep => {
          // frozen 문서는 outdated로 표시하지 않음
          if (!meetingFrozenDocs.includes(dep)) {
            newStatuses[meetingId][dep] = 'outdated';
          }
        });

        set({ docStatuses: newStatuses });
      },

      canRegenerateDoc: (meetingId, docType) => {
        const { isDocFrozen } = get();
        if (isDocFrozen(meetingId, docType)) {
          return { can: false, reason: '문서가 고정되어 있습니다' };
        }
        return { can: true };
      },

      // 전체 문서 생성: 14개를 의존성 순서대로 1개씩 개별 API 호출.
      // 루프가 store(React 밖)에서 돌아 PrdViewer 언마운트(탭 이동)에도 지속됨.
      startGeneration: async () => {
        if (get().isGenerating) return; // 중복 방지
        const meeting = get().currentMeeting;
        if (!meeting?.summary) return;

        const meetingId = meeting.id; // 회의 전환 가드용 캡쳐
        genAbort.cancelled = false;
        genAbort.controller = null;

        const order = topoSortDocs();
        set({
          isGenerating: true,
          generatingMeetingId: meetingId,
          generationProgress: {
            currentLevel: 0,
            totalLevels: order.length,
            currentDoc: '',
            completedDocs: [],
            status: 'generating',
          },
        });

        // 이미 생성된 문서를 컨텍스트 시드로 수집
        const generated: Record<string, string> = {};
        for (const doc of DOCUMENTS) {
          const field = docTypeToField(doc.key) as keyof Meeting;
          const val = meeting[field];
          if (typeof val === 'string' && val) generated[doc.key] = val;
        }

        const summary = meeting.summary;
        const transcript = meeting.transcript || '';
        const meetingInfo = {
          title: meeting.title,
          date: new Date(meeting.createdAt).toLocaleDateString('ko-KR'),
        };

        let completed = 0;
        let failed = 0;

        try {
          for (let i = 0; i < order.length; i++) {
            if (genAbort.cancelled) break; // 반복 전 캔슬 가드

            const docType = order[i];
            const meta = DOCUMENTS.find((d) => d.key === docType);
            set((st) =>
              st.generationProgress
                ? { generationProgress: { ...st.generationProgress, currentLevel: i + 1, currentDoc: meta?.title || docType } }
                : {}
            );

            const contextDocs: Record<string, string> = {};
            for (const dep of DEPENDENCIES[docType] || []) {
              if (generated[dep]) contextDocs[dep] = generated[dep];
            }

            const controller = new AbortController();
            genAbort.controller = controller;
            try {
              const res = await fetch('/api/generate-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docType, summary, transcript, meetingInfo, contextDocs, review: false }),
                signal: controller.signal,
              });
              if (!res.ok) throw new Error((await res.text()) || `${docType} 생성 실패`);
              const { content } = await res.json();
              if (!content) throw new Error(`${docType} 빈 응답`);

              generated[docType] = content;
              const field = docTypeToField(docType);
              // 회의 전환 가드: 같은 회의일 때만 currentMeeting 갱신, 아니면 meetings 배열 직접 패치
              if (get().currentMeeting?.id === meetingId) {
                get().updateCurrentMeeting({ [field]: content });
              } else {
                const meetings = get().meetings;
                const idx = meetings.findIndex((m) => m.id === meetingId);
                if (idx >= 0) {
                  const updated = [...meetings];
                  updated[idx] = { ...updated[idx], [field]: content };
                  set({ meetings: updated });
                }
              }
              completed++;
              set((st) =>
                st.generationProgress
                  ? { generationProgress: { ...st.generationProgress, completedDocs: [...st.generationProgress.completedDocs, docType] } }
                  : {}
              );
            } catch (e) {
              // 캔슬(AbortError)은 실패로 세지 않고 루프 종료
              if ((e as Error)?.name === 'AbortError' || controller.signal.aborted || genAbort.cancelled) break;
              failed++;
              console.error(`${docType} 생성 실패 (계속 진행):`, e);
            } finally {
              genAbort.controller = null;
            }
          }

          set((st) => ({
            generationProgress: st.generationProgress
              ? {
                  ...st.generationProgress,
                  currentDoc: '',
                  status: genAbort.cancelled ? 'cancelled' : failed > 0 && completed === 0 ? 'error' : 'completed',
                }
              : null,
          }));
        } finally {
          set({ isGenerating: false, generatingMeetingId: null });
          setTimeout(() => {
            if (!get().isGenerating) set({ generationProgress: null });
          }, 4000);
        }
      },

      cancelGeneration: () => {
        if (!get().isGenerating) return;
        genAbort.cancelled = true;
        genAbort.controller?.abort();
        set((st) =>
          st.generationProgress ? { generationProgress: { ...st.generationProgress, status: 'cancelled', currentDoc: '' } } : {}
        );
      },
    }),
    {
      name: 'meeting-storage',
      partialize: (state) => ({
        meetings: state.meetings,
        currentMeeting: state.currentMeeting,
        docStatuses: state.docStatuses,
        docVersions: state.docVersions,
        frozenDocs: state.frozenDocs,
      }),
      // 새로고침 후 좀비 생성 상태 리셋 (partialize에서 제외했으나 안전망)
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isGenerating = false;
          state.generationProgress = null;
          state.generatingMeetingId = null;
        }
      },
    }
  )
);
