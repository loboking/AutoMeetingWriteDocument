import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Meeting, MeetingNote, MeetingStep, DocType, DocStatus, DocVersion, DocVersionSource, Project, ProjectMode, MeetingSummary } from '@/types';
import { DOCUMENTS, DEPENDENCIES, docTypeToField, getAllDependents, topoSortLevels, levelsFor, topoSortDocs, CORE_DOCS, orderCoreFirst } from '@/lib/documentUtils';
import { authedFetch } from '@/lib/authFetch';
import { mapWithConcurrency } from '@/lib/concurrency';
import { deleteMeetingRow, fetchMeetings, mergeServer } from '@/lib/meetingsSync';
import {
  deleteMeetingNoteRow,
  fetchMeetingNotes,
  mergeMeetingNotes,
} from '@/lib/notesSync';

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

// 실패사유 머신코드 (클라에서 한국어 라벨로 변환)
export type GenErrorReason = 'timeout' | '429' | 'empty' | 'no-key' | 'network' | 'limit' | 'error';

// 실패사유 라벨 매핑 (클라 단일출처 — i18n 책임은 클라 몫)
export const REASON_LABEL: Record<GenErrorReason, string> = {
  timeout: '시간 초과',
  '429': '요청 한도 초과(잠시 후 재시도)',
  empty: '빈 응답',
  'no-key': '생성 오류',  // 데모 한정, 실운영에서는 안 뜸
  network: '네트워크 오류',
  limit: '이번 달 사용 한도 소진',  // ENFORCE_LIMIT on 시 402
  error: '생성 오류',
};

// 에러 → 사유 코드 분류 (클라측 err 기반. 서버 reason이 있으면 그걸 우선한다)
export function classifyClientErr(err: unknown): GenErrorReason {
  if (!err) return 'error';
  const e = err as { status?: number; name?: string; message?: string };
  if (e.status === 402) return 'limit';  // 사용량 한도 초과(재시도 무의미)
  if (e.status === 429) return '429';
  // AbortError + reason=TimeoutError → 클라 타임아웃
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
  // 모바일 백그라운드 등 네트워크 끊김
  if (e.name === 'TypeError' && (e.message?.includes('Load failed') || e.message?.includes('fetch'))) return 'network';
  if (typeof e.message === 'string' && e.message.includes('빈 응답')) return 'empty';
  return 'error';
}

// 전체 생성 진행 상태 (런타임 표시용, persist 제외)
export interface GenerationProgress {
  currentLevel: number;
  totalLevels: number;
  currentDoc: string;
  completedDocs: DocType[];
  failedDocs: DocType[]; // 재시도 후에도 실패한 문서 (UI에 명시 → 사용자가 재생성 가능)
  failedReasons?: Partial<Record<DocType, GenErrorReason>>; // 문서별 실패사유 (런타임, persist 제외)
  status: 'generating' | 'completed' | 'error' | 'cancelled';
  // composite 모드에서만 세팅: 핵심 3개(prd/feature-list/wbs) 완료 시점 신호.
  // 런타임-only(persist 제외). single 모드에는 사용되지 않는다.
  coreComplete?: boolean;
}

// 진행 중 잡 체크포인트 (persist에 저장 → 새로고침/재방문 시 "남은 문서부터" 재개).
// 완성된 문서 본문은 이미 meetings(단일) 또는 projects(합성)에 저장되므로 여기엔 메타만.
export interface ActiveGenerationJob {
  // 일반화: 기존 meetingId(단일회의) → projectId(단일/합성 공용).
  // single 모드에선 Project.id === Meeting.id로 자동 래핑되므로 키값은 동일.
  projectId: string;
  sourceNoteIds: string[]; // single: [meetingId] / composite: 합성에 쓰인 meetingId들
  order: DocType[]; // 생성 순서 스냅샷
  completedDocs: DocType[]; // 완료된 문서
  // running: 진행/재개 대상. error: 일부 실패로 미완(복귀 시 자동 재개 대상, 단 횟수 상한).
  // completed/cancelled: 종료(재개 안 함).
  status: 'running' | 'completed' | 'cancelled' | 'error';
  updatedAt: number; // heartbeat
  resumeAttempts?: number; // 무진전 자동 재개 횟수(무한 재개 방지용 상한 카운터)
  lastResumeCompletedCount?: number; // 직전 재개 시점의 완료 문서 수(진전 판정 기준)
  // full: 전체 14종 생성(기본). regen: 일부 문서만 일괄 재생성(영향배너 '모두 갱신').
  // undefined(구 persist 잡)는 'full'로 취급 → 하위호환.
  // regen에서만 docStatuses 전이훅(regenerating→latest/outdated)이 동작하고,
  // 재개 시 본문 존재가 아닌 completedDocs 체크포인트로 완료를 판정한다.
  mode?: 'full' | 'regen';
  // 회의록 모드: single(단일회의 자동래핑) / composite(다회의 합성).
  // single은 기존 흐름 유지. composite은 masterSummary + 합성 meetingInfo 사용.
  projectMode?: ProjectMode;
}

// error로 끝난 잡을 복귀 시 몇 번까지 자동 재개할지. 초과하면 사용자 수동 재생성에 위임.
const MAX_RESUME_ATTEMPTS = 3;
// heartbeat(updatedAt)가 이 시간 이상 끊긴 잡은 죽은 좀비로 보고 폐기(무한 재개 방지).
// PRD 타임아웃(600s)+재시도 여유 위로. 정상 진행 잡은 문서 완료마다 updatedAt을 갱신하므로 안전.
const STALE_JOB_MS = 20 * 60 * 1000; // 20분
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

// 멀티탭 중복 생성 방지: navigator.locks로 한 탭(projectId별)만 루프 실행.
// 직렬 정책: 한 projectId당 동시 잡 1개. 이름분리로 서로 다른 프로젝트는 병렬 생성 허용.
const LOCK_PREFIX = 'meeting-auto-docs:doc-generation';
function lockNameFor(projectId: string): string {
  return `${LOCK_PREFIX}:${projectId}`;
}

// 멀티탭 중복 생성 방지: navigator.locks로 projectId별 단일 탭만 루프 실행.
// 다른 탭이 같은 projectId 락을 쥐고 있으면(ifAvailable=false) 이 탭은 생성하지 않음.
// 서로 다른 projectId는 별도 락이므로 병렬 허용. Web Locks 미지원은 락 없이 실행(graceful).
async function runGenerationWithLock(set: SetFn, get: GetFn, projectId: string): Promise<void> {
  const locks = (typeof navigator !== 'undefined' ? navigator.locks : undefined) as
    | { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> }
    | undefined;
  if (!locks?.request) {
    await runGenerationLoop(set, get);
    return;
  }
  await locks.request(lockNameFor(projectId), { ifAvailable: true }, async (lock) => {
    if (!lock) {
      // 다른 탭이 같은 projectId 생성 중 → 이 탭은 대기(중복 방지)
      console.log(`[generation] projectId=${projectId} 다른 탭이 생성 중 — 대기`);
      return;
    }
    await runGenerationLoop(set, get);
  });
}

async function runGenerationLoop(set: SetFn, get: GetFn): Promise<void> {
  const job = get().activeJob;
  if (!job) return;
  const projectId = job.projectId;
  const projectMode = job.projectMode ?? 'single';

  // Project 단위 입력 일반화. single은 Meeting 자동 래핑(id 동일), composite는 masterSummary 사용.
  const project = get().getProject(projectId);
  // single 모드에서 Project가 없으면(레거시/구 persist) Meeting으로 폴백 래핑.
  // composite는 Project가 반드시 있어야 함(없으면 잡 폐기).
  if (!project) {
    if (projectMode === 'composite') {
      set({ activeJob: null });
      return;
    }
    // single 레거시 폴백: Meeting으로부터 Project 즉석 래핑(getProject가 안 만들었으면 여기서 보정)
  }

  // summary: composite는 project.masterSummary, single은 project.masterSummary ?? meeting.summary.
  // single + Project 없음(레거시) → meeting.summary.
  const summary: MeetingSummary | undefined =
    project?.masterSummary
    ?? (projectMode === 'single'
      ? (get().meetings.find((m) => m.id === projectId)?.summary
        ?? (get().currentMeeting?.id === projectId ? get().currentMeeting?.summary : undefined))
      : undefined);
  if (!summary) {
    set({ activeJob: null });
    return;
  }

  genAbort.cancelled = false;
  genAbort.controllers.clear();

  const order = job.order;
  const doneSet = new Set<DocType>(job.completedDocs);

  set({
    isGenerating: true,
    generatingMeetingId: projectId,
    generationProgress: {
      currentLevel: doneSet.size,
      totalLevels: order.length,
      currentDoc: '',
      completedDocs: [...doneSet],
      failedDocs: [],
      status: 'generating',
    },
  });

  // 컨텍스트 시드: 이미 생성된 문서 본문 수집.
  // composite는 project.documents(kebab 키), single은 Meeting flat 카멜 필드.
  const generated: Record<string, string> = {};
  if (project && projectMode === 'composite') {
    for (const doc of DOCUMENTS) {
      const val = project.documents[doc.key];
      if (typeof val === 'string' && val) generated[doc.key] = val;
    }
  } else {
    // single: Meeting flat 필드에서 수집(레거시 호환)
    const meeting = get().meetings.find((m) => m.id === projectId)
      ?? (get().currentMeeting?.id === projectId ? get().currentMeeting : undefined);
    if (meeting) {
      for (const doc of DOCUMENTS) {
        const field = docTypeToField(doc.key) as keyof Meeting;
        const val = meeting[field];
        if (typeof val === 'string' && val) generated[doc.key] = val;
      }
    }
  }

  // transcript: single은 meeting.transcript, composite는 합산(빈 문자열 허용).
  let transcript = '';
  if (projectMode === 'single') {
    const meeting = get().meetings.find((m) => m.id === projectId)
      ?? (get().currentMeeting?.id === projectId ? get().currentMeeting : undefined);
    transcript = meeting?.transcript || '';
  } else {
    // composite: sourceNoteIds 회의록(MeetingNote)들의 transcript를 결합 (③ MeetingNote 전환)
    const parts: string[] = [];
    for (const nid of job.sourceNoteIds) {
      const n = get().meetingNotes.find((x) => x.id === nid);
      if (n?.transcript) parts.push(n.transcript);
    }
    transcript = parts.join('\n\n');
  }

  // meetingInfo: single은 회의 단일 정보, composite는 합성 표현.
  let meetingInfo: { title: string; date: string };
  if (projectMode === 'single') {
    const meeting = get().meetings.find((m) => m.id === projectId)
      ?? (get().currentMeeting?.id === projectId ? get().currentMeeting : undefined);
    meetingInfo = {
      title: project?.title ?? meeting?.title ?? '회의',
      date: new Date((meeting ?? project)?.createdAt ?? Date.now()).toLocaleDateString('ko-KR'),
    };
  } else {
    // composite: "${title} 외 N개 회의 통합"
    const count = job.sourceNoteIds.length;
    meetingInfo = {
      title: count > 1 ? `${project?.title ?? '통합 프로젝트'} (외 ${count - 1}개 회의 통합)` : (project?.title ?? '통합 프로젝트'),
      date: new Date(project?.createdAt ?? Date.now()).toLocaleDateString('ko-KR'),
    };
  }

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
    // projectId 키 사용(single은 projectId===meetingId라 기존 상태와 호환).
    if (isRegen && !get().isDocFrozen(projectId, docType)) {
      get().setDocStatus(projectId, docType, 'regenerating');
    }

    const contextDocs: Record<string, string> = {};
    for (const dep of DEPENDENCIES[docType] || []) {
      if (generated[dep]) contextDocs[dep] = generated[dep];
    }

    // 서버 응답 body에서 추출된 부가정보(서버 reason, partial 여부)를 상위로 전달하기 위한 캐리어.
    // throw 경로에서 err 객체에 실어 올린다.
    const attemptOnce = async (): Promise<{ content: string; partial?: boolean }> => {
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
          // projectId: 과금 카운팅 멱등키. single은 Meeting.id === projectId로 동일.
          // meetingId: single 레거시 호환(서버 recordTokenUsage가 씀). composite는 projectId만 의미.
          body: JSON.stringify({ docType, summary, transcript, meetingInfo, contextDocs, review: false, meetingId: projectId, projectId }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // 서버에서 reason을 body에 실어줬으면 꺼내서 err에 실음
          let bodyReason: GenErrorReason | undefined;
          try {
            const body = await res.json() as { reason?: GenErrorReason };
            bodyReason = body.reason;
          } catch { /* json 파싱 실패는 무시 */ }
          const err = new Error(`${docType} 생성 실패`) as Error & { status?: number; serverReason?: GenErrorReason };
          err.status = res.status;
          err.serverReason = bodyReason;
          throw err;
        }
        const body = await res.json() as { content?: string; partial?: { missing: number } };
        if (!body.content) throw new Error(`${docType} 빈 응답`);
        return { content: body.content, partial: !!body.partial };
      } finally {
        clearTimeout(to);
        genAbort.controllers.delete(controller);
      }
    };

    // 일시 실패(타임아웃/빈응답/429/모바일 백그라운드 복귀 시 네트워크 끊김) 재시도.
    // 모바일에서 백그라운드 진입 시 in-flight fetch가 'TypeError: Load failed' 등으로 떨어질 수
    // 있어, 재시도 횟수를 늘려(총 3회) 복귀 후 자동 복구율을 높인다. 429는 더 길게 backoff.
    const MAX_ATTEMPTS = 3;
    let result: { content: string; partial?: boolean } | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (genAbort.cancelled) break;
      try {
        result = await attemptOnce();
        break;
      } catch (e) {
        lastErr = e;
        // 사용자 취소(cancel 버튼)만 즉시 중단. 타임아웃 abort(TimeoutError)·네트워크 끊김
        // (TypeError: Load failed) 등은 일시 실패로 보고 재시도로 흘려 복귀 후 자동 복구.
        if (genAbort.cancelled) { result = null; break; }
        // 402(사용량 한도 초과)는 재시도해도 안 풀림 → 즉시 실패 처리(사유 'limit'으로 노출).
        if ((e as { status?: number })?.status === 402) break;
        if (attempt < MAX_ATTEMPTS - 1) {
          const is429 = (e as { status?: number })?.status === 429;
          // 429: 5s,10s / 그 외: 2s,4s (지수 backoff)
          const delay = (is429 ? 5000 : 2000) * Math.pow(2, attempt);
          console.warn(`${docType} 생성 실패 → ${delay / 1000}초 후 재시도${is429 ? '(429)' : ''}:`, e);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (result) {
      const { content, partial: isPartial } = result;
      generated[docType] = content;
      const field = docTypeToField(docType);
      // 덮어쓰기 직전 기존 내용을 버전 스냅샷으로 보존(재생성 이력). 최초 생성이면 기존 빈값이라 skip.
      // 저장 타겟 분기: composite는 project.documents, single은 Meeting flat 필드.
      let prevContent = '';
      if (projectMode === 'composite') {
        prevContent = (project?.documents?.[docType] as string | undefined) ?? '';
      } else {
        const meetingForSnap = get().meetings.find((m) => m.id === projectId)
          ?? (get().currentMeeting?.id === projectId ? get().currentMeeting : undefined);
        prevContent = (meetingForSnap?.[field as keyof Meeting] as string | undefined) ?? '';
      }
      if (prevContent.trim() && prevContent !== content) {
        get().recordDocVersion(projectId, docType, prevContent, 'generated', '재생성 전 버전');
      }
      // 저장은 함수형 set으로 — 병렬 worker 간 last-write 경쟁 방지.
      // composite: project.documents[docType]. single: 기존 Meeting flat 필드(무변경 경로).
      if (projectMode === 'composite') {
        get().updateProjectDocuments(projectId, docType, content);
      } else if (get().currentMeeting?.id === projectId) {
        get().updateCurrentMeeting({ [field]: content });
      } else {
        set((st) => {
          const idx = st.meetings.findIndex((m) => m.id === projectId);
          if (idx < 0) return {};
          const updated = [...st.meetings];
          updated[idx] = { ...updated[idx], [field]: content };
          return { meetings: updated };
        });
      }
      doneSet.add(docType);
      // partial: 청킹 일부 실패 → 문서는 저장하되 'partial' 배지.
      // full 생성이 docStatuses를 일절 건드리지 않는 불변식의 유일한 예외.
      // regen 성공 시에도 partial이면 latest 대신 partial(재생성해도 미완성임을 표시).
      // partial 배지를 지우려면 재생성 성공 후 setDocStatus('latest')가 덮어쓴다.
      if (isPartial && !get().isDocFrozen(projectId, docType)) {
        get().setDocStatus(projectId, docType, 'partial');
      } else if (isRegen && !get().isDocFrozen(projectId, docType)) {
        // regen: 갱신 성공(partial 아님) → latest + 버전++. (frozen 제외.)
        // markDependentsOutdated는 호출하지 않음 — 배치 내 하위가 이미 order에 포함돼 있어
        // 위상순서대로 차례차례 latest가 되므로, 재전파하면 방금 푼 배지를 도로 outdated로 만든다.
        get().setDocStatus(projectId, docType, 'latest');
        get().incrementDocVersion(projectId, docType);
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
      // regen: 최종 실패 → regenerating 좀비 복원.
      // - 본문이 있던 문서: outdated(갱신 미완 = 여전히 오래됨).
      // - pending(본문 없음)이었던 문서: pending으로 복원(본문이 없으니 "오래됨"은 거짓).
      if (isRegen && !get().isDocFrozen(projectId, docType)) {
        const wasPending = !((project?.documents?.[docType] as string | undefined)?.trim());
        get().setDocStatus(projectId, docType, wasPending ? 'pending' : 'outdated');
      }
      // 실패사유: 서버 reason 우선, 없으면 클라 err 분류
      const err = lastErr as { serverReason?: GenErrorReason } | undefined;
      const reason: GenErrorReason = err?.serverReason ?? classifyClientErr(lastErr);
      set((st) => {
        if (!st.generationProgress) return {};
        return {
          generationProgress: {
            ...st.generationProgress,
            failedDocs: [...st.generationProgress.failedDocs, docType],
            failedReasons: { ...st.generationProgress.failedReasons, [docType]: reason },
          },
        };
      });
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

      // composite 핵심 우선: 핵심 3개(prd/feature-list/wbs)가 모두 완료되면 루프 종료.
      // 나머지 11개는 본문 없이 'pending'으로 남겨 사용자가 개별 생성(오너 결정 — composite만,
      // single은 14종 종전대로). processDoc 본문은 무변경(레벨 루프 제어에만 분기 추가).
      if (projectMode === 'composite' && CORE_DOCS.every((d) => doneSet.has(d))) {
        break;
      }
    }

    // 완료 판정:
    // - single: 14종 전부 완료(doneSet.size >= order.length) — 종전 불변.
    // - composite: 핵심 3개 완료면 allDone(나머지는 pending으로 사용자 개별 생성에 위임).
    const allDone = projectMode === 'composite'
      ? CORE_DOCS.every((d) => doneSet.has(d))
      : doneSet.size >= order.length;
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
    // composite 핵심 완료 신호(런타임-only). 핵심 3개가 doneSet에 들어왔을 때.
    // single은 coreComplete를 세팅하지 않는다(회귀 0).
    const coreComplete =
      projectMode === 'composite' && CORE_DOCS.every((d) => doneSet.has(d));
    set((st) => ({
      generationProgress: st.generationProgress
        ? {
            ...st.generationProgress,
            currentDoc: '',
            status: jobStatus === 'cancelled' ? 'cancelled' : jobStatus === 'error' ? 'error' : 'completed',
            ...(projectMode === 'composite' ? { coreComplete } : {}),
          }
        : null,
      activeJob: st.activeJob
        ? { ...st.activeJob, completedDocs: [...doneSet], status: jobStatus, updatedAt: Date.now() }
        : null,
    }));

    // composite에서 핵심만 완료하고 끝난 경우, 나머지 문서의 docStatuses를 'pending'(본문 없음,
    // 생성 칩)으로 세팅. single은 미접촉. 핵심이 완료되지 않은 채 끝난(취소/에러) 잡은 pending
    // 세팅을 건너뛴다 — 사용자가 재개/재생성으로 이어가는 경로를 방해하지 않기 위해.
    if (projectMode === 'composite' && coreComplete) {
      const restDocs = order.filter((dt) => !CORE_DOCS.includes(dt) && !doneSet.has(dt));
      for (const dt of restDocs) {
        if (!get().isDocFrozen(projectId, dt)) {
          get().setDocStatus(projectId, dt, 'pending');
        }
      }
    }
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

  // 프로젝트(단일/합성) — composite 회의록 모드의 컨테이너.
  // single 모드는 getProject가 Meeting을 자동 래핑해 반환하므로, 배열은 composite만 저장.
  projects: Project[];
  createProject: (init: { id: string; title: string; mode: ProjectMode; sourceNoteIds: string[]; masterSummary?: MeetingSummary }) => Project;
  getProject: (projectId: string) => Project | undefined; // single은 Meeting 자동 래핑 반환
  updateProjectDocuments: (projectId: string, docType: DocType, content: string) => void;
  updateProjectMasterSummary: (projectId: string, summary: MeetingSummary) => void;

  // 회의록(① 회의록 모드 독립 산출) — 14문서/Project FK 없이 가벼운 저장.
  // 합성(③) 시 Project(composite).sourceNoteIds가 MeetingNote.id들을 참조한다.
  // meetings 동기화와 독립 경로(meeting_notes 테이블, 별개 생명주기 — 회의록은 무료 영속).
  meetingNotes: MeetingNote[];
  // 회의록 삭제 tombstone — 서버 삭제 지연/실패 시 부활 방지(deletedIds와 별개).
  deletedNoteIds: string[];
  createMeetingNote: (init: { id: string; title: string; transcript: string; summary: MeetingSummary; transcriptSegments?: MeetingNote['transcriptSegments']; audioUrl?: string; duration?: number; source?: MeetingNote['source'] }) => MeetingNote;
  getMeetingNote: (id: string) => MeetingNote | undefined;
  updateMeetingNote: (id: string, updates: Partial<MeetingNote>) => void;
  deleteMeetingNote: (id: string) => void;
  // 회의록 DB 영속 — meetings 동기화와 독립(syncFromServer 무변경).
  setMeetingNotes: (notes: MeetingNote[]) => void;
  isSyncingNotes: boolean;
  syncMeetingNotesFromServer: () => Promise<void>;

  // 문서 상태 관리 (projectId -> docType -> status).
  // single 모드는 projectId === meetingId라 기존 persist 데이터와 자연 호환.
  docStatuses: Record<string, Record<DocType, DocStatus>>;
  docVersions: Record<string, Record<DocType, number>>;
  frozenDocs: Record<string, DocType[]>;  // projectId -> frozen docTypes

  // 액션
  createMeeting: (title: string) => void;
  updateMeetingStep: (step: MeetingStep) => void;
  updateCurrentMeeting: (updates: Partial<Meeting>) => void;
  saveCurrentMeeting: () => void; // currentMeeting을 meetings 배열에 저장
  deleteMeeting: (id: string) => void;
  setCurrentMeeting: (meeting: Meeting | null) => void;
  getMeeting: (id: string) => Meeting | undefined;
  setMeetings: (meetings: Meeting[]) => void; // 서버 동기화 결과로 교체 (로그인 시)
  // 서버에서 최신 데이터를 다시 받아와 머지(수동 "동기화" 버튼용). 로그인 후 재조회 수단.
  isSyncing: boolean;
  syncFromServer: () => Promise<void>;
  // 로컬에서 삭제한 회의 id(tombstone). 서버 삭제 지연/실패 시 동기화가 부활시키지 않도록.
  deletedIds: string[];
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
  // 합성 모드 전체 생성: 여러 회의 요약을 합성한 Project에서 14종 생성.
  startCompositeGeneration: (projectId: string) => Promise<void>;
  // C안 어댑터 — composite Project를 Meeting 형태로 평탄화해 currentMeeting에 주입.
  // PrdViewer가 100% currentMeeting 기반이기 때문에(회귀 0 불변식), composite 결과를
  // 보여주려면 Meeting으로 평탄화해서 currentMeeting을 채운다. 도현 결정(C안).
  // 단일회의(single) 경로는 기존 자동 래핑(getProject) 유지 — 이 액션은 composite 전용.
  openCompositeProject: (projectId: string) => void;
  // 회의록 합성 API 호출(/api/synthesize-notes). composite Project의 masterSummary 채움.
  // sourceNoteIds 선택: project가 아직 없을 때(좀비 방지 — 합성 성공 후 createProject) 직접 전달.
  synthesizeNotes: (projectId: string, sourceNoteIds?: string[]) => Promise<MeetingSummary | null>;
  cancelGeneration: () => void;
  resumeGeneration: () => Promise<void>; // 미완성 잡 재개 (새로고침/재방문)
  // 일부 문서만 의존 순서대로 일괄 재생성 (영향배너 '순서대로 모두 갱신').
  // 전체생성과 같은 잡/락/재개 인프라(activeJob, lockNameFor, genAbort) 재사용.
  regenerateDocs: (meetingId: string, targets: DocType[]) => Promise<void>;
}

// persist 직전 blob: audioUrl 제거. blob URL은 새로고침 후 revoke되어 무효(fetch 실패)인데
// localStorage에 박제되면 "변환 재생성"이 무효 URL로 fetch를 시도해 터진다(파일 업로드 경로).
// https:// (Supabase Storage 서명URL 등) 영구 URL은 새로고침 후에도 유효하므로 보존한다.
function stripBlobAudioUrl<T extends { audioUrl?: string } | null | undefined>(m: T): T {
  if (m && typeof m.audioUrl === 'string' && m.audioUrl.startsWith('blob:')) {
    const rest = { ...m };
    delete rest.audioUrl;
    return rest as T;
  }
  return m;
}

export const useMeetingStore = create<MeetingStore>()(
  persist(
    (set, get) => ({
      meetings: [],
      currentMeeting: null,
      currentStep: 'idle',
      activeDocType: null,
      chatMessages: {},
      deletedIds: [],
      deletedNoteIds: [], // 회의록 삭제 tombstone (deletedIds와 별개 — 독립 생명주기)
      projects: [], // composite 프로젝트만 저장. single은 getProject가 Meeting 자동 래핑.
      meetingNotes: [], // 회의록 모드 독립 산출. DB 영속은 notesSync로 독립 경로.
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

      // Project 액션 ------------------------------------------------------------
      // composite 프로젝트 생성. single은 createProject 없이 getProject가 Meeting을 래핑.
      createProject: (init) => {
        const now = new Date();
        const project: Project = {
          id: init.id,
          title: init.title,
          mode: init.mode,
          sourceNoteIds: init.sourceNoteIds,
          masterSummary: init.masterSummary,
          documents: {},
          completedDocs: [],
          docVersions: [],
          createdAt: now,
          updatedAt: now,
        };
        set({ projects: [...get().projects, project] });
        return project;
      },

      // projectId → Project 조회. single 모드는 Meeting을 Project로 자동 래핑(메모리 only).
      // composite는 projects 배열에서 찾는다.
      getProject: (projectId) => {
        // 1) composite 먼저
        const composite = get().projects.find((p) => p.id === projectId);
        if (composite) return composite;
        // 2) single 자동 래핑: Meeting flat 필드를 documents 뷰로 노출.
        const meeting = get().meetings.find((m) => m.id === projectId)
          ?? (get().currentMeeting?.id === projectId ? get().currentMeeting : undefined);
        if (!meeting) return undefined;
        const documents: Partial<Record<DocType, string>> = {};
        for (const doc of DOCUMENTS) {
          const field = docTypeToField(doc.key) as keyof Meeting;
          const val = meeting[field];
          if (typeof val === 'string' && val) documents[doc.key] = val;
        }
        return {
          id: meeting.id,
          title: meeting.title,
          mode: 'single',
          sourceNoteIds: [meeting.id],
          masterSummary: meeting.summary,
          documents,
          completedDocs: meeting.completedDocs ?? [],
          docVersions: meeting.docVersions ?? [],
          createdAt: meeting.createdAt,
          updatedAt: meeting.updatedAt,
        };
      },

      // composite project.documents[docType] 갱신. 함수형 set(병렬 worker 경쟁 방지).
      updateProjectDocuments: (projectId, docType, content) => {
        set((st) => {
          const idx = st.projects.findIndex((p) => p.id === projectId);
          if (idx < 0) return {}; // single은 Meeting 저장 경로 사용(여기 안 옴)
          const updated = [...st.projects];
          updated[idx] = {
            ...updated[idx],
            documents: { ...updated[idx].documents, [docType]: content },
            completedDocs: Array.from(new Set([...(updated[idx].completedDocs ?? []), docType])),
            updatedAt: new Date(),
          };
          return { projects: updated };
        });
      },

      // composite project.masterSummary 갱신(synthesizeNotes 결과 반영).
      updateProjectMasterSummary: (projectId, summary) => {
        set((st) => {
          const idx = st.projects.findIndex((p) => p.id === projectId);
          if (idx < 0) return {};
          const updated = [...st.projects];
          updated[idx] = { ...updated[idx], masterSummary: summary, updatedAt: new Date() };
          return { projects: updated };
        });
      },

      // MeetingNote(① 회의록 독립 산출) CRUD -----------------------------------
      // 14문서/Project FK 없이 가벼운 저장. 합성(③) sourceNoteIds로 참조된다.
      createMeetingNote: (init) => {
        const now = new Date();
        const note: MeetingNote = {
          id: init.id,
          title: init.title,
          createdAt: now,
          updatedAt: now,
          transcript: init.transcript,
          transcriptSegments: init.transcriptSegments,
          summary: init.summary,
          audioUrl: init.audioUrl,
          duration: init.duration,
          source: init.source,
        };
        set({ meetingNotes: [note, ...get().meetingNotes] });
        return note;
      },

      getMeetingNote: (id) => get().meetingNotes.find((n) => n.id === id),

      updateMeetingNote: (id, updates) => {
        set((st) => {
          const idx = st.meetingNotes.findIndex((n) => n.id === id);
          if (idx < 0) return {};
          const updated = [...st.meetingNotes];
          updated[idx] = { ...updated[idx], ...updates, updatedAt: new Date() };
          return { meetingNotes: updated };
        });
      },

      deleteMeetingNote: (id) => {
        set({
          meetingNotes: get().meetingNotes.filter((n) => n.id !== id),
          // tombstone: 동기화가 이 회의록을 다시 살리지 못하게(부활 방지). 최근 200개만 유지.
          deletedNoteIds: [...get().deletedNoteIds.filter((x) => x !== id), id].slice(-200),
        });
        // 서버에서도 삭제 — 안 하면 다음 동기화에 부활. best-effort(비로그인/실패 무시).
        void deleteMeetingNoteRow(id);
      },

      setMeetingNotes: (notes) => {
        // 서버 동기화 결과로 교체. MeetingNote엔 currentNote 개념이 없어 meetings의
        // currentMeeting 갱신 로직은 불필요 — 배열만 교체.
        set({ meetingNotes: notes });
      },

      isSyncingNotes: false,
      syncMeetingNotesFromServer: async () => {
        if (get().isSyncingNotes) return;
        set({ isSyncingNotes: true });
        try {
          const server = await fetchMeetingNotes();
          const merged = mergeMeetingNotes(get().meetingNotes, server, get().deletedNoteIds);
          get().setMeetingNotes(merged);
        } catch (e) {
          console.error('[syncMeetingNotesFromServer] 실패:', e instanceof Error ? e.message : e);
          throw e;
        } finally {
          set({ isSyncingNotes: false });
        }
      },

      isSyncing: false,
      syncFromServer: async () => {
        if (get().isSyncing) return;
        set({ isSyncing: true });
        try {
          const server = await fetchMeetings();
          const merged = mergeServer(get().meetings, server, get().deletedIds);
          get().setMeetings(merged); // setMeetings가 currentMeeting도 최신본으로 갱신
        } catch (e) {
          console.error('[syncFromServer] 실패:', e instanceof Error ? e.message : e);
          throw e;
        } finally {
          set({ isSyncing: false });
        }
      },

      setMeetings: (meetings) => {
        // 화면이 보는 건 currentMeeting. 동기화로 meetings가 갱신되면 열려있는 회의도
        // 머지 결과(LWW 채택본)로 맞춰야 "다른 기기 변경이 화면에 반영"된다.
        // (mergeServer가 이미 최신 쪽을 채택했으므로 merged의 동일 id 항목이 진실.)
        const cur = get().currentMeeting;
        if (cur) {
          const fresh = meetings.find((m) => m.id === cur.id);
          // fresh가 cur와 다른 객체면 교체(서버 최신 반영). 같은 참조면 무변경.
          if (fresh && fresh !== cur) {
            set({ meetings, currentMeeting: fresh });
            return;
          }
        }
        set({ meetings });
      },

      resetForSignOut: () => {
        // 이전 사용자 데이터가 메모리에 남지 않도록 전부 비움.
        // (persist.clearStorage는 AuthGate에서 별도 호출)
        set({
          meetings: [],
          currentMeeting: null,
          currentStep: 'idle',
          chatMessages: {},
          deletedIds: [],
          deletedNoteIds: [],
          projects: [],
          meetingNotes: [],
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
        set({
          meetings: get().meetings.filter((m) => m.id !== id),
          // tombstone 기록: 동기화가 이 회의를 다시 살리지 못하게(부활 방지). 최근 200개만 유지.
          deletedIds: [...get().deletedIds.filter((x) => x !== id), id].slice(-200),
        });
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
      // single 모드: currentMeeting 기준 Project 자동 래핑(projectId === meetingId).
      startGeneration: async () => {
        if (get().isGenerating) return; // 중복 방지
        const meeting = get().currentMeeting;
        if (!meeting?.summary) return;

        const projectId = meeting.id; // single: Project.id === Meeting.id
        const order = topoSortDocs();
        // 이미 생성된(완료로 간주) 문서를 시작 시점 completedDocs에 반영
        const preCompleted = order.filter((dt) => {
          const v = meeting[docTypeToField(dt) as keyof Meeting];
          return typeof v === 'string' && v;
        });

        set({
          activeJob: {
            projectId,
            sourceNoteIds: [projectId],
            order,
            completedDocs: preCompleted,
            status: 'running',
            mode: 'full',
            projectMode: 'single',
            updatedAt: Date.now(),
          },
        });
        await runGenerationWithLock(set, get, projectId);
      },

      // 합성 모드 전체 생성: 여러 회의 요약을 합성한 Project에서 14종 생성.
      // 호출 전 synthesizeNotes로 masterSummary가 채워져 있어야 한다.
      startCompositeGeneration: async (projectId) => {
        if (get().isGenerating) return;
        const project = get().projects.find((p) => p.id === projectId);
        if (!project?.masterSummary) return; // 합성 안 됨 → 폐기

        // 핵심 우선: 위상 레벨 내에서 CORE_DOCS(prd/feature-list/wbs)를 앞으로.
        // single(startGeneration)은 미접촉 — topoSortDocs() 종전대로.
        const order = orderCoreFirst(topoSortDocs());
        const preCompleted = order.filter((dt) => {
          const v = project.documents[dt];
          return typeof v === 'string' && v;
        });

        set({
          activeJob: {
            projectId,
            sourceNoteIds: project.sourceNoteIds,
            order,
            completedDocs: preCompleted,
            status: 'running',
            mode: 'full',
            projectMode: 'composite',
            updatedAt: Date.now(),
          },
        });
        await runGenerationWithLock(set, get, projectId);
      },

      // C안 어댑터 — composite Project를 currentMeeting(Meeting flat)으로 평탄화 주입.
      // PrdViewer는 currentMeeting flat 필드만 읽는다(getProject 기반이 아님 — 회귀 0 불변식).
      // composite Project.documents(kebab 키) → Meeting flat 카멜 필드(docTypeToField 역변환 재사용).
      // transcript는 sourceNoteIds 회의록 transcript 이어붙임(빈 문자열 최소 — YAGNI, PrdViewer가 직접 표시 안 함).
      // currentStep='done'으로 설정 — PrdViewer가 ② 탭 done 단계에서 렌더되도록.
      // 의미 애매하지만 단일/합성 경로를 ② 회귀 0으로 통합하는 최소 경로(도현 결정).
      openCompositeProject: (projectId) => {
        const project = get().projects.find((p) => p.id === projectId && p.mode === 'composite');
        if (!project) return;

        // Project.documents(kebab) → Meeting flat 카멜. docTypeToField로 역변환 매핑 재사용.
        const flatDocs: Partial<Record<string, string>> = {};
        for (const [docType, content] of Object.entries(project.documents)) {
          if (typeof content === 'string' && content) {
            flatDocs[docTypeToField(docType)] = content;
          }
        }

        // transcript: sourceNoteIds 회의록 transcript 이어붙임(빈 값이면 빈 문자열).
        const transcript = project.sourceNoteIds
          .map((nid) => get().meetingNotes.find((n) => n.id === nid)?.transcript ?? '')
          .filter((t) => t.trim())
          .join('\n\n---\n\n');

        const now = new Date();
        const meeting: Meeting = {
          id: project.id,
          title: project.title,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt ?? now,
          transcript: transcript || undefined,
          summary: project.masterSummary,
          step: 'done',
          completedDocs: project.completedDocs,
          isCompleted: project.completedDocs.length > 0,
          docVersions: project.docVersions,
          ...flatDocs,
        };

        set({ currentMeeting: meeting, currentStep: 'done' });
      },

      // 회의록 합성: /api/synthesize-notes 호출 → composite Project의 masterSummary 채움.
      // 옵션 B: 클라가 summaries 배열 직송. 성공 시 masterSummary 반환, 실패 시 null.
      // sourceNoteIds(선택): project가 없을 때(좀비 방지 — createProject를 합성 성공 후로 미룰 때) 직접 전달.
      // ③ 합성 모드 전환: 입력 소스 Meeting → MeetingNote로 단일화(회의록 모드가 유일한 입력).
      synthesizeNotes: async (projectId, sourceNoteIds) => {
        const project = get().projects.find((p) => p.id === projectId);
        const noteIds = project?.sourceNoteIds ?? sourceNoteIds ?? [];
        // sourceNoteIds 회의록(MeetingNote)들의 summary + metas 수집
        const notes = noteIds
          .map((nid) => get().meetingNotes.find((n) => n.id === nid))
          .filter((n): n is MeetingNote => !!n?.summary);
        if (notes.length === 0) return null;

        const summaries = notes.map((n) => n.summary);
        const metas = notes.map((n) => ({
          title: n.title,
          date: new Date(n.createdAt).toLocaleDateString('ko-KR'),
        }));

        try {
          const res = await authedFetch('/api/synthesize-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, summaries, metas }),
          });
          if (!res.ok) {
            console.error('[synthesizeNotes] 합성 실패:', res.status);
            return null;
          }
          const body = await res.json() as { masterSummary?: MeetingSummary };
          if (!body.masterSummary) return null;
          get().updateProjectMasterSummary(projectId, body.masterSummary);
          return body.masterSummary;
        } catch (e) {
          console.error('[synthesizeNotes] 예외:', e);
          return null;
        }
      },

      // 일부 문서만 의존 순서대로 일괄 재생성.
      // targets는 호출처(영향배너)에서 이미 존재·outdated·frozen제외·위상정렬된 집합.
      // 여기서도 방어적으로 frozen/미존재를 한 번 더 걸러 안전한 부분집합만 잡으로 만든다.
      // projectId는 single(composite 호환) — single에선 meetingId와 동일.
      regenerateDocs: async (meetingId, targets) => {
        // 단일 진입: 전체생성/다른 일괄갱신이 진행 중이면 무시(중복·동시 덮어쓰기 방지).
        if (get().isGenerating || get().activeJob?.status === 'running') return;
        const projectId = meetingId; // single 호환: 외부 API 시그니처 유지
        const project = get().getProject(projectId);
        if (!project) return;

        const { isDocFrozen } = get();
        // 본문이 있고 frozen 아닌 targets만. 위상 평탄순서로 정렬(레벨 분해는 루프가 levelsFor로 수행).
        // 단, 'pending'(composite에서 핵심 완료 후 본문 없이 남은 문서)은 본문이 없어도 생성 진입 허용.
        // targets에 pending이 섞여 있으면 본문 존재 검사를 스킵한다(도현/도이 권고 a — 기존 함수 재사용).
        const hasPendingTarget = targets.some((dt) => get().getDocStatus(projectId, dt) === 'pending');
        const valid = topoSortDocs().filter(
          (dt) =>
            targets.includes(dt) &&
            !isDocFrozen(projectId, dt) &&
            (hasPendingTarget
              ? (() => {
                  // pending이 하나라도 포함된 배치: 본문이 있거나 pending인 것만 유효.
                  // (본문도 없고 pending도 아닌 것은 잘못된 호출 — 스킵.)
                  const v = project.documents[dt];
                  const hasContent = typeof v === 'string' && v;
                  return hasContent || get().getDocStatus(projectId, dt) === 'pending';
                })()
              : (() => {
                  const v = project.documents[dt];
                  return typeof v === 'string' && v;
                })())
        );
        if (valid.length === 0) return;

        set({
          activeJob: {
            projectId,
            sourceNoteIds: project.sourceNoteIds,
            order: valid,
            completedDocs: [],
            status: 'running',
            mode: 'regen',
            projectMode: project.mode,
            resumeAttempts: 0,
            updatedAt: Date.now(),
          },
        });
        await runGenerationWithLock(set, get, projectId);
      },

      // 미완성 잡 재개 (새로고침/재방문/화면 복귀).
      // status='running'(정상 진행 중 끊김) 또는 'error'(일부 실패 미완)인 잡을 이어서 생성.
      // ★ 무한 재개 방지: status와 무관하게 "진전 없는 재개"만 카운트한다. running 잡도
      //   매번 끊기며(모바일 백그라운드/탭 종료 등) completedDocs가 안 늘면 상한에서 폐기.
      //   (기존엔 error만 카운트해 running이 영원히 재개되는 무한 프로그레스 버그가 있었음.)
      resumeGeneration: async () => {
        if (get().isGenerating) return;
        const job = get().activeJob;
        if (!job) return;
        if (job.status !== 'running' && job.status !== 'error') return;
        // 상한 초과 또는 heartbeat 끊긴 stale 잡 → 폐기(사용자 수동 재생성에 위임).
        if (
          (job.resumeAttempts ?? 0) >= MAX_RESUME_ATTEMPTS ||
          (!!job.updatedAt && Date.now() - job.updatedAt > STALE_JOB_MS)
        ) {
          set({ activeJob: null });
          return;
        }
        // ★ job.projectId로 Project를 찾는다(getProject가 single은 Meeting 자동 래핑).
        //   composite는 projects 배열에서, single은 meetings에서.
        const projectMode = job.projectMode ?? 'single'; // 구 persist 잡은 single로 간주
        const project = get().getProject(job.projectId);
        if (!project?.masterSummary) {
          set({ activeJob: null }); // 프로젝트/요약 없음 → 잡 폐기
          return;
        }
        // completedDocs 재보정.
        // - full/legacy: 실제 저장된 본문 존재로 완료 판정(저장 누락 방지).
        //   composite는 project.documents에서, single은 Meeting flat 필드에서(getProject가 래핑).
        // - regen(일괄 재생성): 본문 존재로 판정 금지 — 갱신 대상은 이미 본문을 보유하므로
        //   첫 틱에 전부 완료로 오판→잡 폐기→0건 갱신 버그가 난다. 문서 완료마다 갱신되는
        //   activeJob.completedDocs 체크포인트만 단일 진실원으로 신뢰한다.
        const completed =
          job.mode === 'regen'
            ? job.completedDocs.filter((dt) => job.order.includes(dt))
            : job.order.filter((dt) => {
                const v = project.documents[dt];
                return typeof v === 'string' && v;
              });
        if (completed.length >= job.order.length) {
          set({ activeJob: null }); // 이미 다 됨
          return;
        }
        // 진전 판정: 직전 재개 시점보다 완료 수가 늘었으면 정상 진행 → 카운터 리셋.
        // 늘지 않았으면(같은 지점에서 또 끊김) 무진전 재개 → 카운터++ (상한서 폐기).
        const madeProgress = completed.length > (job.lastResumeCompletedCount ?? -1);
        const resumeAttempts = madeProgress ? 0 : (job.resumeAttempts ?? 0) + 1;
        set({
          activeJob: {
            ...job,
            projectMode,
            completedDocs: completed,
            status: 'running',
            resumeAttempts,
            lastResumeCompletedCount: completed.length,
            updatedAt: Date.now(),
          },
        });
        await runGenerationWithLock(set, get, job.projectId);
      },

      cancelGeneration: () => {
        // ★ isGenerating 여부와 무관하게 종료. 재방문 시 isGenerating=false인데도 activeJob이
        //   살아있어 다음 재개(visibilitychange)에 부활하던 문제(종료 눌러도 안 멈춤)를 막는다.
        //   잡·프로그레스를 즉시 완전 폐기해 부활 트리거를 제거한다.
        genAbort.cancelled = true;
        // 병렬 in-flight 전부 취소
        genAbort.controllers.forEach((c) => c.abort());
        genAbort.controllers.clear();
        set({
          isGenerating: false,
          generatingMeetingId: null,
          generationProgress: null,
          activeJob: null,
        });
      },
    }),
    {
      name: 'meeting-storage',
      partialize: (state) => ({
        // blob: audioUrl은 저장 제외(새로고침 후 무효). 그 외 필드는 그대로 보존.
        meetings: state.meetings.map(stripBlobAudioUrl),
        currentMeeting: stripBlobAudioUrl(state.currentMeeting),
        chatMessages: state.chatMessages,
        deletedIds: state.deletedIds,
        // 회의록 삭제 tombstone 영속화(부활 방지).
        deletedNoteIds: state.deletedNoteIds,
        // composite 프로젝트 영속화. single은 Meeting에서 자동 래핑하므로 여기엔 없음.
        projects: state.projects,
        // 회의록 모드 독립 산출 영속화. DB 영속은 notesSync로 meetings와 독립 경로.
        meetingNotes: state.meetingNotes,
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
          // running/error: resumeAttempts 상한 내면 재개 보존, 초과면 정리.
          // cancelled/completed: 정리. (running도 무진전 상한 초과 시 폐기 → 무한 재개 차단.)
          // + stale 가드: heartbeat(updatedAt)가 STALE_JOB_MS 이상 끊긴 잡은 죽은 좀비로 폐기.
          //   구버전에서 무제한 재개로 박제된 running 잡을 배포 후 재방문 1회에 즉시 정리.
          const job = state.activeJob;
          if (job) {
            const isStale = !!job.updatedAt && Date.now() - job.updatedAt > STALE_JOB_MS;
            const keep =
              !isStale &&
              (job.status === 'running' || job.status === 'error') &&
              (job.resumeAttempts ?? 0) < MAX_RESUME_ATTEMPTS;
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
