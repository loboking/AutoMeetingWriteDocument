import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Meeting, MeetingStep, MeetingSummary, DocType, DocStatus } from '@/types';
import { DOCUMENTS, DEPENDENCIES, docTypeToField, getAllDependents } from '@/lib/documentUtils';
import { authedFetch } from '@/lib/authFetch';
import { mapWithConcurrency } from '@/lib/concurrency';

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
  failedDocs: DocType[]; // 재시도 후에도 실패한 문서 (UI에 명시 → 사용자가 재생성 가능)
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
// controllers는 Set: 병렬 생성 시 여러 in-flight fetch를 모두 취소하기 위함.
type GenAbort = { controllers: Set<AbortController>; cancelled: boolean };
const __g = globalThis as unknown as { __genAbort?: GenAbort };
const genAbort: GenAbort = __g.__genAbort ?? (__g.__genAbort = { controllers: new Set(), cancelled: false });

// DEPENDENCIES 위상정렬을 "레벨"(같은 레벨은 상호 의존 없어 병렬 가능)로 반환.
// 각 Kahn 라운드 = 한 레벨. 예: L0 prd/user-story/feature-list/flowchart ...
function topoSortLevels(): DocType[][] {
  const allKeys = DOCUMENTS.map((d) => d.key);
  const levels: DocType[][] = [];
  const remaining = new Set(allKeys);
  while (remaining.size > 0) {
    const level = allKeys.filter(
      (k) => remaining.has(k) && (DEPENDENCIES[k] || []).every((d) => !remaining.has(d))
    );
    if (level.length === 0) {
      // 순환/이상 — 남은 것 한 레벨로 몰아 종료(무한루프 방지)
      levels.push([...remaining]);
      break;
    }
    level.forEach((k) => remaining.delete(k));
    levels.push(level);
  }
  return levels;
}

// 평탄 순서 (활성잡 order/진행UI 호환용). 레벨을 펼침.
function topoSortDocs(): DocType[] {
  return topoSortLevels().flat();
}

// 생성 루프 (start/resume 공용). activeJob을 기준으로 남은 문서를 순차 생성하고,
// 각 문서 완료 시 activeJob.completedDocs를 갱신(persist 체크포인트) → 새로고침 재개 가능.
type SetFn = (partial: Partial<MeetingStore> | ((s: MeetingStore) => Partial<MeetingStore>)) => void;
type GetFn = () => MeetingStore;

const GENERATION_LOCK = 'meeting-auto-docs:doc-generation';

// 멀티탭 중복 생성 방지: navigator.locks로 단일 탭만 루프 실행.
// 다른 탭이 락을 쥐고 있으면(ifAvailable=false) 이 탭은 생성하지 않음(중복/덮어쓰기 방지).
// Web Locks 미지원 환경은 락 없이 그대로 실행(graceful).
async function runGenerationWithLock(set: SetFn, get: GetFn): Promise<void> {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as
    | { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> }
    | undefined;
  if (!locks?.request) {
    await runGenerationLoop(set, get);
    return;
  }
  await locks.request(GENERATION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      // 다른 탭이 이미 생성 중 → 이 탭은 진행하지 않음(폴링/표시는 persist 구독으로 자동 반영)
      console.log('[generation] 다른 탭이 생성 중 — 이 탭은 대기(중복 방지)');
      return;
    }
    await runGenerationLoop(set, get);
  });
}

async function runGenerationLoop(set: SetFn, get: GetFn): Promise<void> {
  const job = get().activeJob;
  if (!job) return;
  const meetingId = job.meetingId;
  // job.meetingId와 일치하는 회의만 사용. currentMeeting은 id가 같을 때만 fallback
  // (새 회의가 meetings 배열에 아직 동기화 안 된 경우 대비). 다른 회의에 저장 방지.
  const cur = get().currentMeeting;
  const meeting = get().meetings.find((m) => m.id === meetingId) || (cur?.id === meetingId ? cur : undefined);
  if (!meeting?.summary) {
    set({ activeJob: null });
    return;
  }

  genAbort.cancelled = false;
  genAbort.controllers.clear();

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
      failedDocs: [],
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

  let failed = 0;

  // 단일 문서 생성 + 저장 + 체크포인트. 성공 true / 실패 false.
  // 같은 레벨은 상호 의존 없으므로 contextDocs는 레벨 시작 시점 generated 스냅샷만 참조.
  const processDoc = async (docType: DocType): Promise<boolean> => {
    if (genAbort.cancelled || doneSet.has(docType)) return doneSet.has(docType);

    const meta = DOCUMENTS.find((d) => d.key === docType);
    // 진행중 문서 표시(병렬이라 마지막 set이 보이지만 '생성 중'은 동일)
    set((st) =>
      st.generationProgress
        ? { generationProgress: { ...st.generationProgress, currentDoc: meta?.title || docType } }
        : {}
    );

    const contextDocs: Record<string, string> = {};
    for (const dep of DEPENDENCIES[docType] || []) {
      if (generated[dep]) contextDocs[dep] = generated[dep];
    }

    const attemptOnce = async (): Promise<string> => {
      const controller = new AbortController();
      genAbort.controllers.add(controller);
      try {
        const res = await authedFetch('/api/generate-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docType, summary, transcript, meetingInfo, contextDocs, review: false }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = new Error((await res.text()) || `${docType} 생성 실패`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        const { content } = await res.json();
        if (!content) throw new Error(`${docType} 빈 응답`);
        return content;
      } finally {
        genAbort.controllers.delete(controller);
      }
    };

    // 일시 실패(타임아웃/빈응답/429) 재시도. 429는 지수 backoff로 더 길게.
    let content: string | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (genAbort.cancelled) break;
      try {
        content = await attemptOnce();
        break;
      } catch (e) {
        lastErr = e;
        if ((e as Error)?.name === 'AbortError' || genAbort.cancelled) { content = null; break; }
        if (attempt === 0) {
          const is429 = (e as { status?: number })?.status === 429;
          const delay = is429 ? 5000 : 2000;
          console.warn(`${docType} 생성 실패 → ${delay / 1000}초 후 재시도${is429 ? '(429)' : ''}:`, e);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (content) {
      generated[docType] = content;
      const field = docTypeToField(docType);
      // 저장은 함수형 set으로 — 병렬 worker 간 last-write 경쟁 방지
      if (get().currentMeeting?.id === meetingId) {
        get().updateCurrentMeeting({ [field]: content });
      } else {
        set((st) => {
          const idx = st.meetings.findIndex((m) => m.id === meetingId);
          if (idx < 0) return {};
          const updated = [...st.meetings];
          updated[idx] = { ...updated[idx], [field]: content };
          return { meetings: updated };
        });
      }
      doneSet.add(docType);
      // ★ 체크포인트: 문서 완료마다 갱신(재개 정합). 함수형 set.
      set((st) => ({
        activeJob: st.activeJob ? { ...st.activeJob, completedDocs: [...doneSet], updatedAt: Date.now() } : null,
        generationProgress: st.generationProgress
          ? { ...st.generationProgress, completedDocs: [...doneSet] }
          : null,
      }));
      return true;
    } else {
      failed++;
      console.error(`${docType} 생성 최종 실패 (계속 진행):`, lastErr);
      set((st) => ({
        generationProgress: st.generationProgress
          ? { ...st.generationProgress, failedDocs: [...st.generationProgress.failedDocs, docType] }
          : null,
      }));
      return false;
    }
  };

  const LEVEL_CONCURRENCY = 3;

  try {
    // 레벨 순차, 레벨 내 병렬(동시3). 같은 레벨은 상호 의존 없어 안전.
    const levels = topoSortLevels();
    for (const level of levels) {
      if (genAbort.cancelled) break;
      const pending = level.filter((dt) => !doneSet.has(dt));
      if (pending.length === 0) continue;

      // PRD는 내부적으로 CONCURRENCY=3 청킹이라 z.ai 슬롯을 점유 → 단독 선행(429 방어).
      if (pending.includes('prd')) {
        await processDoc('prd');
        const rest = pending.filter((dt) => dt !== 'prd');
        if (rest.length > 0 && !genAbort.cancelled) {
          await mapWithConcurrency(rest, LEVEL_CONCURRENCY, (dt) => processDoc(dt));
        }
      } else {
        await mapWithConcurrency(pending, LEVEL_CONCURRENCY, (dt) => processDoc(dt));
      }
    }

    const allDone = doneSet.size >= order.length;
    // 잡 최종 상태 결정:
    // - 취소: cancelled
    // - 전부 완료: completed
    // - 실패가 있어 미완료로 끝남: error (★running 유지하면 매 마운트마다 무한 재개되므로 금지)
    // - 그 외(실패 0인데 미완료 — 정상적으론 발생 안 함): completed로 종료
    const jobStatus: ActiveGenerationJob['status'] = genAbort.cancelled
      ? 'cancelled'
      : allDone
        ? 'completed'
        : failed > 0
          ? 'error'
          : 'completed';
    set((st) => ({
      generationProgress: st.generationProgress
        ? { ...st.generationProgress, currentDoc: '', status: jobStatus === 'cancelled' ? 'cancelled' : jobStatus === 'error' ? 'error' : 'completed' }
        : null,
      activeJob: st.activeJob
        ? { ...st.activeJob, completedDocs: [...doneSet], status: jobStatus, updatedAt: Date.now() }
        : null,
    }));
  } finally {
    set({ isGenerating: false, generatingMeetingId: null });
    // 종료된 잡(completed/cancelled/error)은 즉시 정리 → 재마운트 시 재개 안 함(좀비 방지).
    // running이 아닌데도 남아있으면 useGenerationRecovery가 건드리지 않으나, 명시적으로 비운다.
    {
      const st = get();
      if (st.activeJob && st.activeJob.status !== 'running') {
        set({ activeJob: null });
      }
    }
    // 진행바는 사용자가 완료/실패 결과를 읽을 수 있도록 정리 지연.
    // 실패가 있으면 더 오래(실패 문서명 확인), 아니면 짧게.
    const hadFailure = (get().generationProgress?.failedDocs?.length ?? 0) > 0;
    setTimeout(() => {
      if (!get().isGenerating) set({ generationProgress: null });
    }, hadFailure ? 12000 : 5000);
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
  setMeetings: (meetings: Meeting[]) => void; // 서버 동기화 결과로 교체 (로그인 시)
  resetForSignOut: () => void; // 로그아웃 시 메모리 상태 전체 리셋 (이전 사용자 데이터 잔류 차단)

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
        const now = new Date();
        const newMeeting: Meeting = {
          id: generateId(),
          title,
          createdAt: now,
          updatedAt: now, // LWW 머지 기준 안정화
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
        const cur = get().currentMeeting;
        if (!cur) return;
        // updatedAt이 없으면 채워 LWW 머지 기준을 안정화
        const current = cur.updatedAt ? cur : { ...cur, updatedAt: new Date() };

        const meetings = get().meetings;
        const existingIndex = meetings.findIndex((m) => m.id === current.id);

        if (existingIndex >= 0) {
          // 이미 있으면 업데이트
          const updatedMeetings = [...meetings];
          updatedMeetings[existingIndex] = current;
          set({ meetings: updatedMeetings, currentMeeting: current });
        } else {
          // 없으면 추가
          set({ meetings: [...meetings, current], currentMeeting: current });
        }
      },

      setMeetings: (meetings) => set({ meetings }),

      resetForSignOut: () => {
        // 이전 사용자 데이터가 메모리에 남지 않도록 전부 비움.
        // (persist.clearStorage는 AuthGate에서 별도 호출)
        set({
          meetings: [],
          currentMeeting: null,
          currentStep: 'idle',
          docStatuses: {},
          docVersions: {},
          frozenDocs: {},
          activeJob: null,
          isGenerating: false,
          generationProgress: null,
          generatingMeetingId: null,
        });
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
        await runGenerationWithLock(set, get);
      },

      // 미완성 잡 재개 (새로고침/재방문). activeJob.status가 'running'이고 남은 문서가 있을 때.
      resumeGeneration: async () => {
        if (get().isGenerating) return;
        const job = get().activeJob;
        if (!job || job.status !== 'running') return;
        // ★ job.meetingId로만 회의를 찾는다. currentMeeting fallback 금지
        //   (회의 삭제됐는데 currentMeeting이 다른 회의면 엉뚱한 곳에 문서 저장됨)
        const meeting = get().meetings.find((m) => m.id === job.meetingId);
        if (!meeting?.summary) {
          set({ activeJob: null }); // 회의 없음/요약 없음 → 잡 폐기
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
        await runGenerationWithLock(set, get);
      },

      cancelGeneration: () => {
        if (!get().isGenerating) return;
        genAbort.cancelled = true;
        // 병렬 in-flight 전부 취소
        genAbort.controllers.forEach((c) => c.abort());
        genAbort.controllers.clear();
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
