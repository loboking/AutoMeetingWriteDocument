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

// 전체 생성 진행 상태 (런타임 표시용, persist 제외)
export interface GenerationProgress {
  currentLevel: number;
  totalLevels: number;
  currentDoc: string;
  completedDocs: DocType[];
  status: 'generating' | 'completed' | 'error' | 'cancelled';
}

// 진행 중 잡 체크포인트 (persist에 저장 → 새로고침/재방문 시 "남은 문서부터" 재개).
// 완성된 문서 본문은 이미 meetings에 저장되므로 여기엔 메타만.
export interface ActiveGenerationJob {
  meetingId: string;
  order: DocType[]; // 생성 순서 스냅샷
  completedDocs: DocType[]; // 완료된 문서
  status: 'running' | 'completed' | 'cancelled' | 'error';
  updatedAt: number; // heartbeat
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

// 생성 루프 (start/resume 공용). activeJob을 기준으로 남은 문서를 순차 생성하고,
// 각 문서 완료 시 activeJob.completedDocs를 갱신(persist 체크포인트) → 새로고침 재개 가능.
type SetFn = (partial: Partial<MeetingStore> | ((s: MeetingStore) => Partial<MeetingStore>)) => void;
type GetFn = () => MeetingStore;

async function runGenerationLoop(set: SetFn, get: GetFn): Promise<void> {
  const job = get().activeJob;
  if (!job) return;
  const meetingId = job.meetingId;
  const meeting = get().meetings.find((m) => m.id === meetingId) || get().currentMeeting;
  if (!meeting?.summary) {
    set({ activeJob: null });
    return;
  }

  genAbort.cancelled = false;
  genAbort.controller = null;

  const order = job.order;
  const doneSet = new Set<DocType>(job.completedDocs);

  set({
    isGenerating: true,
    generatingMeetingId: meetingId,
    generationProgress: {
      currentLevel: doneSet.size,
      totalLevels: order.length,
      currentDoc: '',
      completedDocs: [...doneSet],
      status: 'generating',
    },
  });

  // 컨텍스트 시드: 이미 생성된 문서 본문 수집
  const generated: Record<string, string> = {};
  for (const doc of DOCUMENTS) {
    const field = docTypeToField(doc.key) as keyof Meeting;
    const val = meeting[field];
    if (typeof val === 'string' && val) generated[doc.key] = val;
  }

  const summary = meeting.summary;
  const transcript = meeting.transcript || '';
  const meetingInfo = { title: meeting.title, date: new Date(meeting.createdAt).toLocaleDateString('ko-KR') };

  let completed = doneSet.size;
  let failed = 0;

  try {
    for (let i = 0; i < order.length; i++) {
      if (genAbort.cancelled) break;
      const docType = order[i];
      if (doneSet.has(docType)) continue; // 이미 완료된 문서 스킵 (재개)

      const meta = DOCUMENTS.find((d) => d.key === docType);
      set((st) =>
        st.generationProgress
          ? { generationProgress: { ...st.generationProgress, currentLevel: completed + 1, currentDoc: meta?.title || docType } }
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
        doneSet.add(docType);
        // ★ 체크포인트: activeJob 갱신(persist 저장) + 진행률
        set((st) => ({
          activeJob: st.activeJob ? { ...st.activeJob, completedDocs: [...doneSet], updatedAt: Date.now() } : null,
          generationProgress: st.generationProgress
            ? { ...st.generationProgress, completedDocs: [...doneSet] }
            : null,
        }));
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || controller.signal.aborted || genAbort.cancelled) break;
        failed++;
        console.error(`${docType} 생성 실패 (계속 진행):`, e);
      } finally {
        genAbort.controller = null;
      }
    }

    const finalStatus = genAbort.cancelled ? 'cancelled' : failed > 0 && completed === doneSet.size && doneSet.size === 0 ? 'error' : 'completed';
    const allDone = doneSet.size >= order.length;
    set((st) => ({
      generationProgress: st.generationProgress
        ? { ...st.generationProgress, currentDoc: '', status: genAbort.cancelled ? 'cancelled' : allDone || failed === 0 ? 'completed' : 'error' }
        : null,
      // 완료/취소면 activeJob 종료 표시(다음 마운트에서 재개 안 함). 중간 실패로 안 끝났으면 running 유지(재개 대상)
      activeJob: st.activeJob
        ? { ...st.activeJob, completedDocs: [...doneSet], status: genAbort.cancelled ? 'cancelled' : allDone ? 'completed' : 'running', updatedAt: Date.now() }
        : null,
    }));
    void finalStatus;
  } finally {
    set({ isGenerating: false, generatingMeetingId: null });
    setTimeout(() => {
      const st = get();
      if (!st.isGenerating) {
        set({ generationProgress: null });
        // 완료/취소된 잡은 정리
        if (st.activeJob && st.activeJob.status !== 'running') set({ activeJob: null });
      }
    }, 4000);
  }
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
  // 진행 중 잡 체크포인트 (persist 저장 → 새로고침 재개용)
  activeJob: ActiveGenerationJob | null;

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

  // 전체 문서 생성 (백그라운드 지속 + 캔슬 + 새로고침 재개)
  startGeneration: () => Promise<void>;
  cancelGeneration: () => void;
  resumeGeneration: () => Promise<void>; // 미완성 잡 재개 (새로고침/재방문)
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
      activeJob: null,

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
      // 루프가 store(React 밖)에서 돌아 탭 이동에도 지속. 각 문서 완료 시 activeJob(persist)에
      // 체크포인트를 기록해, 새로고침/재방문 후에도 "남은 문서부터" 재개 가능.
      startGeneration: async () => {
        if (get().isGenerating) return; // 중복 방지
        const meeting = get().currentMeeting;
        if (!meeting?.summary) return;

        const order = topoSortDocs();
        // 이미 생성된(완료로 간주) 문서를 시작 시점 completedDocs에 반영
        const preCompleted = order.filter((dt) => {
          const v = meeting[docTypeToField(dt) as keyof Meeting];
          return typeof v === 'string' && v;
        });

        set({
          activeJob: { meetingId: meeting.id, order, completedDocs: preCompleted, status: 'running', updatedAt: Date.now() },
        });
        await runGenerationLoop(set, get);
      },

      // 미완성 잡 재개 (새로고침/재방문). activeJob.status가 'running'이고 남은 문서가 있을 때.
      resumeGeneration: async () => {
        if (get().isGenerating) return;
        const job = get().activeJob;
        if (!job || job.status !== 'running') return;
        const meeting = get().meetings.find((m) => m.id === job.meetingId) || get().currentMeeting;
        if (!meeting?.summary) {
          set({ activeJob: null }); // 회의 사라짐 → 잡 폐기
          return;
        }
        // 실제 meetings에 저장된 문서를 기준으로 completedDocs 보정(저장 누락 방지)
        const completed = job.order.filter((dt) => {
          const v = meeting[docTypeToField(dt) as keyof Meeting];
          return typeof v === 'string' && v;
        });
        if (completed.length >= job.order.length) {
          set({ activeJob: null }); // 이미 다 됨
          return;
        }
        set({ activeJob: { ...job, completedDocs: completed, updatedAt: Date.now() } });
        await runGenerationLoop(set, get);
      },

      cancelGeneration: () => {
        if (!get().isGenerating) return;
        genAbort.cancelled = true;
        genAbort.controller?.abort();
        set((st) => ({
          generationProgress: st.generationProgress ? { ...st.generationProgress, status: 'cancelled', currentDoc: '' } : null,
          activeJob: st.activeJob ? { ...st.activeJob, status: 'cancelled', updatedAt: Date.now() } : null,
        }));
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
        // 진행 중 잡 체크포인트 저장 → 새로고침/재방문 후 재개
        activeJob: state.activeJob,
      }),
      // 새로고침 후: 런타임 생성 상태는 리셋(좀비 방지), activeJob은 보존(재개 대상).
      // 실제 재개는 useGenerationRecovery 훅이 마운트 시 resumeGeneration() 호출로 수행.
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isGenerating = false;
          state.generationProgress = null;
          state.generatingMeetingId = null;
          // activeJob.status='running'이면 그대로 둠(재개). cancelled/completed면 정리.
          if (state.activeJob && state.activeJob.status !== 'running') {
            state.activeJob = null;
          }
        }
      },
    }
  )
);
