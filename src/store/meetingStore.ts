import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Meeting, MeetingStep, DocType, DocStatus, DocVersion, DocVersionSource } from '@/types';
import { DOCUMENTS, DEPENDENCIES, docTypeToField, getAllDependents, topoSortLevels, levelsFor, topoSortDocs } from '@/lib/documentUtils';
import { authedFetch } from '@/lib/authFetch';
import { mapWithConcurrency } from '@/lib/concurrency';
import { deleteMeetingRow } from '@/lib/meetingsSync';

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

// DocHelper 대화 메시지 (회의별 persist). 영속 대상이라 직렬화 가능한 형태만.
export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
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
  // running: 진행/재개 대상. error: 일부 실패로 미완(복귀 시 자동 재개 대상, 단 횟수 상한).
  // completed/cancelled: 종료(재개 안 함).
  status: 'running' | 'completed' | 'cancelled' | 'error';
  updatedAt: number; // heartbeat
  resumeAttempts?: number; // error 잡 자동 재개 횟수(무한 재개 방지용 상한 카운터)
  // full: 전체 14종 생성(기본). regen: 일부 문서만 일괄 재생성(영향배너 '모두 갱신').
  // undefined(구 persist 잡)는 'full'로 취급 → 하위호환.
  // regen에서만 docStatuses 전이훅(regenerating→latest/outdated)이 동작하고,
  // 재개 시 본문 존재가 아닌 completedDocs 체크포인트로 완료를 판정한다.
  mode?: 'full' | 'regen';
}

// error로 끝난 잡을 복귀 시 몇 번까지 자동 재개할지. 초과하면 사용자 수동 재생성에 위임.
const MAX_RESUME_ATTEMPTS = 3;
// 문서당 보관할 버전 수 상한 (localStorage/jsonb 비대 방지)
const MAX_DOC_VERSIONS = 30;
// 회의당 보관할 DocHelper 대화 수 상한
const MAX_CHAT_MESSAGES = 100;

// 직렬화 불가한 캔슬 제어는 store state가 아닌 모듈 스코프에 보관.
// HMR(dev) 시 모듈 재평가로 끊기지 않도록 globalThis에 캐시.
// controllers는 Set: 병렬 생성 시 여러 in-flight fetch를 모두 취소하기 위함.
type GenAbort = { controllers: Set<AbortController>; cancelled: boolean };
const __g = globalThis as unknown as { __genAbort?: GenAbort };
const genAbort: GenAbort = __g.__genAbort ?? (__g.__genAbort = { controllers: new Set(), cancelled: false });

// 위상정렬 헬퍼(topoSortLevels/levelsFor/topoSortDocs)는 순수 함수라 단위 테스트를 위해
// documentUtils로 이동했다. 여기서는 import해서 그대로 사용(런타임 동작 변화 없음).

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
  // regen(일괄 재생성)에서만 docStatuses 상태배지를 전이시킨다(regenerating→latest/outdated).
  // full(전체 생성)은 docStatuses를 일절 건드리지 않음(불변식 유지).
  const isRegen = job.mode === 'regen';

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

    // regen: 이 문서를 '갱신 중'으로 표시(frozen은 제외 — getDocStatus가 frozen 우선반환).
    if (isRegen && !get().isDocFrozen(meetingId, docType)) {
      get().setDocStatus(meetingId, docType, 'regenerating');
    }

    const contextDocs: Record<string, string> = {};
    for (const dep of DEPENDENCIES[docType] || []) {
      if (generated[dep]) contextDocs[dep] = generated[dep];
    }

    const attemptOnce = async (): Promise<string> => {
      const controller = new AbortController();
      genAbort.controllers.add(controller);
      // ★ 클라 타임아웃: 모바일 백그라운드 등으로 fetch가 영영 settle 안 되면 isGenerating이
      //   영구 고착(@finally 미도달)→복귀 재개 영구 차단(데드락). 시간 상한으로 강제 abort해
      //   AbortError(reason=TimeoutError)로 떨어뜨려 재시도/실패 경로를 타게 한다.
      //   PRD는 내부 청킹으로 길어 별도 상향. 서버 maxDuration=300s를 살짝 넘겨 잡음.
      const TIMEOUT_MS = docType === 'prd' ? 600_000 : 320_000;
      const to = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
      try {
        const res = await authedFetch('/api/generate-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docType, summary, transcript, meetingInfo, contextDocs, review: false, meetingId }),
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
        clearTimeout(to);
        genAbort.controllers.delete(controller);
      }
    };

    // 일시 실패(타임아웃/빈응답/429/모바일 백그라운드 복귀 시 네트워크 끊김) 재시도.
    // 모바일에서 백그라운드 진입 시 in-flight fetch가 'TypeError: Load failed' 등으로 떨어질 수
    // 있어, 재시도 횟수를 늘려(총 3회) 복귀 후 자동 복구율을 높인다. 429는 더 길게 backoff.
    const MAX_ATTEMPTS = 3;
    let content: string | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (genAbort.cancelled) break;
      try {
        content = await attemptOnce();
        break;
      } catch (e) {
        lastErr = e;
        // 사용자 취소(cancel 버튼)만 즉시 중단. 타임아웃 abort(TimeoutError)·네트워크 끊김
        // (TypeError: Load failed) 등은 일시 실패로 보고 재시도로 흘려 복귀 후 자동 복구.
        if (genAbort.cancelled) { content = null; break; }
        if (attempt < MAX_ATTEMPTS - 1) {
          const is429 = (e as { status?: number })?.status === 429;
          // 429: 5s,10s / 그 외: 2s,4s (지수 backoff)
          const delay = (is429 ? 5000 : 2000) * Math.pow(2, attempt);
          console.warn(`${docType} 생성 실패 → ${delay / 1000}초 후 재시도${is429 ? '(429)' : ''}:`, e);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (content) {
      generated[docType] = content;
      const field = docTypeToField(docType);
      // 덮어쓰기 직전 기존 내용을 버전 스냅샷으로 보존(재생성 이력). 최초 생성이면 기존 빈값이라 skip.
      const meetingForSnap = get().meetings.find((m) => m.id === meetingId)
        ?? (get().currentMeeting?.id === meetingId ? get().currentMeeting : undefined);
      const prevContent = (meetingForSnap?.[field as keyof Meeting] as string | undefined) ?? '';
      if (prevContent.trim() && prevContent !== content) {
        get().recordDocVersion(meetingId, docType, prevContent, 'generated', '재생성 전 버전');
      }
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
      // regen: 갱신 성공 → latest + 버전++. (frozen 제외.)
      // markDependentsOutdated는 호출하지 않음 — 배치 내 하위가 이미 order에 포함돼 있어
      // 위상순서대로 차례차례 latest가 되므로, 재전파하면 방금 푼 배지를 도로 outdated로 만든다.
      if (isRegen && !get().isDocFrozen(meetingId, docType)) {
        get().setDocStatus(meetingId, docType, 'latest');
        get().incrementDocVersion(meetingId, docType);
      }
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
      // regen: 최종 실패 → regenerating 좀비를 outdated로 복원(갱신 미완 = 여전히 오래됨).
      if (isRegen && !get().isDocFrozen(meetingId, docType)) {
        get().setDocStatus(meetingId, docType, 'outdated');
      }
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
    // regen(일괄 재생성)은 job.order(targets)에 속한 문서만의 부분 레벨로 생성.
    const levels = job.mode === 'regen' ? levelsFor(job.order) : topoSortLevels();
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
    // 잡 정리 정책:
    // - completed/cancelled: 즉시 정리(재개 안 함, 좀비 방지).
    // - error: 보존 → 복귀 시 자동 재개(남은/실패 문서 재시도). 단 resumeAttempts가 상한을
    //   넘었으면 무한 재개 방지 위해 정리(사용자 수동 재생성에 위임).
    {
      const st = get();
      const job = st.activeJob;
      if (job && job.status !== 'running') {
        const keepForResume =
          job.status === 'error' && (job.resumeAttempts ?? 0) < MAX_RESUME_ATTEMPTS;
        if (!keepForResume) set({ activeJob: null });
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
  // 현재 보고 있는 문서 타입 (PrdViewer가 동기화 → 채팅 도우미가 컨텍스트로 사용). persist 제외.
  activeDocType: DocType | null;
  setActiveDocType: (docType: DocType | null) => void;

  // DocHelper 대화 기록 (회의별). persist 포함 → 같은 프로젝트 복귀/새로고침 시 복원.
  chatMessages: Record<string, ChatMsg[]>;
  appendChatMessage: (meetingId: string, msg: ChatMsg) => void;
  clearChatMessages: (meetingId: string) => void;

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

  // 문서 버전 히스토리 액션
  recordDocVersion: (meetingId: string, docType: DocType, content: string, source: DocVersionSource, note?: string) => void;
  getDocVersions: (meetingId: string, docType: DocType) => DocVersion[];
  restoreDocVersion: (meetingId: string, versionId: string) => void;

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
  // 일부 문서만 의존 순서대로 일괄 재생성 (영향배너 '순서대로 모두 갱신').
  // 전체생성과 같은 잡/락/재개 인프라(activeJob, GENERATION_LOCK, genAbort) 재사용.
  regenerateDocs: (meetingId: string, targets: DocType[]) => Promise<void>;
}

export const useMeetingStore = create<MeetingStore>()(
  persist(
    (set, get) => ({
      meetings: [],
      currentMeeting: null,
      currentStep: 'idle',
      activeDocType: null,
      chatMessages: {},
      docStatuses: {},
      docVersions: {},
      frozenDocs: {},
      isGenerating: false,
      generationProgress: null,
      generatingMeetingId: null,
      activeJob: null,

      setActiveDocType: (docType) => set({ activeDocType: docType }),

      appendChatMessage: (meetingId, msg) => {
        const all = get().chatMessages;
        const prev = all[meetingId] ?? [];
        // 회의당 최근 MAX_CHAT_MESSAGES개만 유지(localStorage 비대 방지)
        const next = [...prev, msg].slice(-MAX_CHAT_MESSAGES);
        set({ chatMessages: { ...all, [meetingId]: next } });
      },

      clearChatMessages: (meetingId) => {
        const all = { ...get().chatMessages };
        delete all[meetingId];
        set({ chatMessages: all });
      },

      createMeeting: (title) => {
        const now = new Date();
        // 회의 생성 즉시 녹음 단계로 진입 — 'idle'은 표시 탭이 없어 빈 화면이 뜨므로,
        // "회의 시작하기" → 곧바로 녹음 화면이 보이도록 'recording'으로 시작한다.
        const newMeeting: Meeting = {
          id: generateId(),
          title,
          createdAt: now,
          updatedAt: now, // LWW 머지 기준 안정화
          step: 'recording',
        };
        set({ currentMeeting: newMeeting, currentStep: 'recording', meetings: [...get().meetings, newMeeting] });
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

      // 문서 버전 히스토리 ----------------------------------------------------
      // 문서 내용이 바뀌기 "직전" 호출 → 현재(=이전) 내용을 스냅샷으로 1건 적재.
      // 문서별 최근 MAX_DOC_VERSIONS개만 유지(jsonb 비대 방지). meetings 배열을
      // 갱신하므로 AuthGate 구독이 자동 디바운스 upsert → Supabase 영속화.
      recordDocVersion: (meetingId, docType, content, source, note) => {
        if (!content || !content.trim()) return; // 빈 문서는 기록 안 함
        const apply = (m: Meeting): Meeting => {
          const prev = m.docVersions ?? [];
          // 같은 문서의 직전 버전과 내용 동일하면 중복 적재 skip
          const lastSame = [...prev].reverse().find((v) => v.docType === docType);
          if (lastSame && lastSame.content === content) return m;
          const entry: DocVersion = {
            id: generateId(),
            docType,
            content,
            createdAt: new Date(),
            source,
            note,
          };
          // 이 문서 타입 버전만 골라 cap 적용(다른 문서 버전은 보존)
          const others = prev.filter((v) => v.docType !== docType);
          const sameType = prev.filter((v) => v.docType === docType);
          const trimmed = [...sameType, entry].slice(-MAX_DOC_VERSIONS);
          return { ...m, docVersions: [...others, ...trimmed], updatedAt: new Date() };
        };
        const cur = get().currentMeeting;
        const meetings = get().meetings;
        const idx = meetings.findIndex((m) => m.id === meetingId);
        const updates: Partial<MeetingStore> = {};
        if (idx >= 0) {
          const next = [...meetings];
          next[idx] = apply(next[idx]);
          updates.meetings = next;
        }
        if (cur && cur.id === meetingId) updates.currentMeeting = apply(cur);
        set(updates);
      },

      getDocVersions: (meetingId, docType) => {
        const m = get().meetings.find((x) => x.id === meetingId)
          ?? (get().currentMeeting?.id === meetingId ? get().currentMeeting : undefined);
        const list = (m?.docVersions ?? []).filter((v) => v.docType === docType);
        // 최신 우선
        return [...list].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      },

      // 과거 버전으로 복원: 현재 내용을 먼저 'restored' 스냅샷으로 남기고(무손실),
      // 해당 버전 content를 현재 문서 필드에 반영.
      restoreDocVersion: (meetingId, versionId) => {
        const m = get().meetings.find((x) => x.id === meetingId)
          ?? (get().currentMeeting?.id === meetingId ? get().currentMeeting : undefined);
        if (!m) return;
        const target = (m.docVersions ?? []).find((v) => v.id === versionId);
        if (!target) return;
        const field = docTypeToField(target.docType) as keyof Meeting;
        const currentContent = (m[field] as string | undefined) ?? '';
        // 1) 현재 내용 보존(복원 직전 스냅샷)
        if (currentContent.trim()) {
          get().recordDocVersion(meetingId, target.docType, currentContent, 'restored',
            `복원 전 자동 백업 (${new Date().toLocaleString('ko-KR')})`);
        }
        // 2) 선택 버전 내용 반영
        if (get().currentMeeting?.id === meetingId) {
          get().updateCurrentMeeting({ [field]: target.content });
        } else {
          const meetings = get().meetings;
          const idx = meetings.findIndex((x) => x.id === meetingId);
          if (idx >= 0) {
            const next = [...meetings];
            next[idx] = { ...next[idx], [field]: target.content, updatedAt: new Date() };
            set({ meetings: next });
          }
        }
        // 복원된 문서는 최신 취급
        get().setDocStatus(meetingId, target.docType, 'latest');
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
          chatMessages: {},
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
        // 삭제된 회의의 DocHelper 대화도 정리(고아 데이터 방지)
        get().clearChatMessages(id);
        // 현재 열려있는 회의를 지우면 화면도 닫는다(잔상 방지)
        if (get().currentMeeting?.id === id) {
          set({ currentMeeting: null, currentStep: 'idle' });
        }
        // 서버(Supabase)에서도 삭제 — 안 하면 다음 동기화에 부활. best-effort(비로그인/실패 무시).
        // RLS 때문에 클라에서 직접 호출(서버 라우트 X). deleteMeetingRow 내부에서 에러 로깅.
        void deleteMeetingRow(id);
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

        // 데이터가 전혀 없으면 녹음부터 — 'idle'은 표시 탭이 없어 빈 화면이 된다.
        let inferredStep: MeetingStep = 'recording';
        if (hasDocuments || hasSummary) {
          inferredStep = 'done';
        } else if (hasTranscript) {
          inferredStep = 'summarizing';
        } else if (meeting.audioUrl) {
          inferredStep = 'transcribing';
        }

        // 저장된 step이 있으면 우선, 단 'idle'은 표시 탭이 없으므로 추론값으로 보정
        const step = meeting.step && meeting.step !== 'idle' ? meeting.step : inferredStep;
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
          activeJob: { meetingId: meeting.id, order, completedDocs: preCompleted, status: 'running', mode: 'full', updatedAt: Date.now() },
        });
        await runGenerationWithLock(set, get);
      },

      // 일부 문서만 의존 순서대로 일괄 재생성.
      // targets는 호출처(영향배너)에서 이미 존재·outdated·frozen제외·위상정렬된 집합.
      // 여기서도 방어적으로 frozen/미존재를 한 번 더 걸러 안전한 부분집합만 잡으로 만든다.
      regenerateDocs: async (meetingId, targets) => {
        // 단일 진입: 전체생성/다른 일괄갱신이 진행 중이면 무시(중복·동시 덮어쓰기 방지).
        if (get().isGenerating || get().activeJob?.status === 'running') return;
        const meeting = get().meetings.find((m) => m.id === meetingId);
        if (!meeting?.summary) return;

        const { isDocFrozen } = get();
        // 본문이 있고 frozen 아닌 targets만. 위상 평탄순서로 정렬(레벨 분해는 루프가 levelsFor로 수행).
        const valid = topoSortDocs().filter(
          (dt) =>
            targets.includes(dt) &&
            !isDocFrozen(meetingId, dt) &&
            (() => {
              const v = meeting[docTypeToField(dt) as keyof Meeting];
              return typeof v === 'string' && v;
            })()
        );
        if (valid.length === 0) return;

        set({
          activeJob: {
            meetingId,
            order: valid,
            completedDocs: [],
            status: 'running',
            mode: 'regen',
            resumeAttempts: 0,
            updatedAt: Date.now(),
          },
        });
        await runGenerationWithLock(set, get);
      },

      // 미완성 잡 재개 (새로고침/재방문/화면 복귀).
      // status='running'(정상 진행 중 끊김) 또는 'error'(일부 실패 미완)인 잡을 이어서 생성.
      // error 잡은 resumeAttempts 상한까지만 자동 재개(무한 재개 방지).
      resumeGeneration: async () => {
        if (get().isGenerating) return;
        const job = get().activeJob;
        if (!job) return;
        const isResumable =
          job.status === 'running' ||
          (job.status === 'error' && (job.resumeAttempts ?? 0) < MAX_RESUME_ATTEMPTS);
        if (!isResumable) return;
        // ★ job.meetingId로만 회의를 찾는다. currentMeeting fallback 금지
        //   (회의 삭제됐는데 currentMeeting이 다른 회의면 엉뚱한 곳에 문서 저장됨)
        const meeting = get().meetings.find((m) => m.id === job.meetingId);
        if (!meeting?.summary) {
          set({ activeJob: null }); // 회의 없음/요약 없음 → 잡 폐기
          return;
        }
        // completedDocs 재보정.
        // - full/legacy: 실제 meetings에 저장된 본문 존재로 완료 판정(저장 누락 방지).
        // - regen(일괄 재생성): 본문 존재로 판정 금지 — 갱신 대상은 이미 본문을 보유하므로
        //   첫 틱에 전부 완료로 오판→잡 폐기→0건 갱신 버그가 난다. 문서 완료마다 갱신되는
        //   activeJob.completedDocs 체크포인트만 단일 진실원으로 신뢰한다.
        const completed =
          job.mode === 'regen'
            ? job.completedDocs.filter((dt) => job.order.includes(dt))
            : job.order.filter((dt) => {
                const v = meeting[docTypeToField(dt) as keyof Meeting];
                return typeof v === 'string' && v;
              });
        if (completed.length >= job.order.length) {
          set({ activeJob: null }); // 이미 다 됨
          return;
        }
        // error→running으로 되돌려 재개. error 재개면 시도 횟수 증가(상한 초과 시 다음엔 자동 재개 안 함).
        const resumeAttempts =
          job.status === 'error' ? (job.resumeAttempts ?? 0) + 1 : (job.resumeAttempts ?? 0);
        set({
          activeJob: { ...job, completedDocs: completed, status: 'running', resumeAttempts, updatedAt: Date.now() },
        });
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
        chatMessages: state.chatMessages,
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
          // running: 재개. error: resumeAttempts 상한 내면 재개 보존, 초과면 정리.
          // cancelled/completed: 정리.
          const job = state.activeJob;
          if (job) {
            const keep =
              job.status === 'running' ||
              (job.status === 'error' && (job.resumeAttempts ?? 0) < MAX_RESUME_ATTEMPTS);
            if (!keep) state.activeJob = null;
          }
          // 죽은 'regenerating' 좀비 정리: 일괄갱신 중 탭 강제종료/크래시로 docStatuses에
          // 'regenerating'이 박제될 수 있다. 새로고침 시 'outdated'로만 강등(아직 안 끝난 갱신
          // = 여전히 오래됨). latest/outdated/frozen은 불변. 재개 잡이 다시 regenerating으로 올림.
          if (state.docStatuses) {
            for (const meetingId of Object.keys(state.docStatuses)) {
              const docs = state.docStatuses[meetingId];
              for (const docType of Object.keys(docs) as DocType[]) {
                if (docs[docType] === 'regenerating') docs[docType] = 'outdated';
              }
            }
          }
        }
      },
    }
  )
);
