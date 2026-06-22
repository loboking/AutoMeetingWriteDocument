# 문서 수정 시 하위 문서 동작 기획·검토서

> 4관점(UX/상태동시성/데이터정합성/비용복원) 독립 분석 → 적대적 검증 → 합의 합성으로 도출.
> 권고 21건 전수 검증 통과(수정채택), 합성 단계 4건 기각. (2026-06-19)

## 멘탈모델 (확정)

문서를 **'주요 변경'**으로 저장하면 그 파생 문서에 **'업데이트 필요'** 표시가 뜨고, 자동으로 바뀌진 않지만 사용자가 **버튼 한 번으로 영향받은 문서를 의존 순서대로 한꺼번에** 다시 만들 수 있다. 이 일괄 갱신은 **전체생성과 같은 1개 잡·1개 락 인프라를 재사용**하므로 새로고침 중에도 이어서 진행되며, 모든 표시는 **'지금 보는 브라우저 기준'**이다.

## 트리거 정책 (사용자 확정, 2026-06-22)

문서 진입/갱신 시점에 시스템이 **어떻게 제안하느냐**를 4가지로 확정. 모두 **클릭 트리거·자동변경 0** 원칙 준수.

| 항목 | 확정 |
|------|------|
| **① 갱신 방식** | **일괄 + 개별 둘 다.** 영향배너에 '순서대로 모두 갱신(N)' primary 버튼 + 개별 칩 유지 (기획 #4) |
| **② 진입 시 재생성 제안** | **자동 제안 안 함.** outdated 페이지에 들어가도 모달/팝업 없음. 문서 상단 인라인 배지+갱신 버튼만 조용히 노출 (기획 #12) |
| **③ 변경 알림** | **사이드바 배지 🔴 + 본문 상단 배너 둘 다.** 사이드바는 '업데이트 필요' 점(이미 구현 1450-1460), 본문 상단엔 이유 배너 (기획 #12) |
| **④ 원인 표시 수준** | **직계 부모명만.** DEPENDENCIES 정적 관계로 "상위 문서(기능목록·API명세)에서 파생됨" 표시. **실제 바뀐 문서 추적 안 함**(docStatuses 구조·persist 무변경) |

**기각**: 진입 시 자동 모달(능동적이나 탐색 흐름 끊김), 실제 바뀐 원인 문서 추적(docStatuses를 `{status, causedBy}`로 확장 → 마이그레이션·다중원인 병합 복잡도 대비 효용 낮음).

## 현재 상태 (P0, 검증 완료)

단일 재생성 시 `markRegenerated`(self latest + 버전++ + 하위 outdated 전파), 저장 시 사소/주요 2지선다 모달(기본=주요), major 저장 후 영향배너(개별 '지금 갱신' 칩만) + 직계 부모 모순 모달, frozen은 전파/생성에서 스킵.

**핵심 갭**: `runGenerationLoop`가 `docStatuses`를 일절 안 건드림(`setDocStatus` 쓰기는 `PrdViewer:609` `'latest'` 1곳뿐) → 일괄 실행기·outdated 배지 해소 부재. `'regenerating'` enum(`types:8`)은 `PrdViewer:1471`에서 읽기만 되는 죽은 상태.

---

## 구현 계획 (의존 순서)

### 1. `store.regenerateDocs(meetingId, targets)` 일괄 실행기 — `activeJob` 재사용 `[P0/L]`
**무엇**: 영향받은 문서를 의존 순서대로 한 번에 다시 만드는 store 액션. 전체생성과 같은 잡·락·재개 인프라를 그대로 탄다.

**어떻게**:
- `meetingStore`에 `regenerateDocs(meetingId, targets: DocType[])` 추가.
- `ActiveGenerationJob`에 `mode: 'full' | 'regen'` 필드 신설(필수, persist 포함, `undefined`는 `'full'`로 취급=구 잡 호환). `startGeneration`(661)은 `mode:'full'` 설정.
- 진입 가드: `if (get().isGenerating || get().activeJob?.status==='running') return;` (단일진입 + persist된 activeJob으로 타탭 이중트리거 차단).
- `order`는 `topoSortLevels()`를 `targets`로 필터링한 부분레벨로 구성하는 헬퍼 `levelsFor(targets)` 추가(빈레벨 제거, 레벨 내 순서 보존).
- 시작 시 targets 스냅샷 1회 고정: `getDocStatus(meetingId,t)!=='latest' && hasBody && !isDocFrozen`.
- `activeJob = {meetingId, order:partialOrder, completedDocs:[], status:'running', mode:'regen', updatedAt, resumeAttempts:0}` → `runGenerationWithLock`.
- `runGenerationLoop`의 levels 순회(268)를 `job.mode==='regen'`이면 `levelsFor(job.order)`, 아니면 `topoSortLevels()`로 분기.
- 컨텍스트 시드(`generated`, 141-146)는 기존대로 meeting 본문에서 수집(편집된 부모는 이미 저장·latest이고 targets에 없으므로 최신본으로 들어감 → stale overwrite 없음).

**완료 기준**: feature-list 포함 일괄 대상 호출 시 partialOrder만 생성(14종 전체 아님), full 경로는 mode 기본값으로 byte-identical 유지.
**선행**: 없음

### 2. `runGenerationLoop` `processDoc`에 `docStatuses` 상태전이 훅(regen 전용) `[P0/M]`
**무엇**: 일괄 갱신이 끝나면 영향문서의 '업데이트 필요' 배지가 실제로 사라진다.

**어떻게**: `processDoc`(156) 내 3지점, `job.mode==='regen' && !isDocFrozen(meetingId,docType)`일 때만:
- (1) 진행표시 set 직후(161-165): `setDocStatus(meetingId,docType,'regenerating')`.
- (2) content 저장 성공·`doneSet.add` 직후(243): `setDocStatus(...,'latest')` + `incrementDocVersion(...)`. **`markDependentsOutdated` 절대 호출 금지**(배치 내 하위가 이미 order에 포함 → 방금 푼 배지를 도로 outdated로 만드는 도돌이; order가 위상순서라 부모→자식 순서로 latest되면 충분).
- (3) 최종 실패 else 분기(252-261): `setDocStatus(...,'outdated')`(regenerating 좀비 복원).
- `mode!=='regen'`(full) 경로는 `setDocStatus` 0회 → '루프는 docStatuses 미접근' 불변식을 full에서 유지.

**완료 기준**: regen 잡 완료 후 모든 target `getDocStatus===latest`(잔류 0). 레벨병렬 목으로도 결정적. full은 docStatuses 쓰기 0회.
**선행**: 1

### 3. `resumeGeneration`/`onRehydrate`를 regen 잡 mode 인지로 분기 `[P0/M]`
**무엇**: 19분짜리 일괄 갱신이 새로고침·모바일 백그라운드 복귀로 끊겨도 남은 문서만 정확히 이어서 갱신.

**어떻게**: `resumeGeneration`의 completedDocs 재보정(698-702)을 mode로 분기:
- `mode!=='regen'`(full/legacy): 현행 '본문 존재=완료' 유지.
- `mode==='regen'`: **본문 존재로 완료 판정 절대 금지**(갱신 대상은 이미 본문 보유 → 첫 틱에 전부 완료 오판→잡 폐기→0건 갱신 버그). `job.completedDocs`(체크포인트, 244-250에서 문서 완료마다 persist)만 신뢰: `completed=job.completedDocs`, `completed.length>=order.length` 검사만.
- `'docStatuses!==outdated를 완료로 보는'` 대안은 frozen 우선반환·실패시 복원 타이밍과 결합돼 race → **채택 금지**(체크포인트가 단일 진실원).
- `onRehydrateStorage` keep 판정은 mode 무관 동일. regen도 `resumeAttempts<3` 자동재개 포함.

**완료 기준**: regen 체크포인트 후 강제 새로고침→남은 건만 재개. mode undefined 구 잡은 full로 안전.
**선행**: 2

### 4. 영향배너에 '순서대로 모두 갱신 (N개)' primary 버튼 + 개별 칩 유지 `[P0/M]`
**무엇**: 배너 카피가 약속한 '순서대로'를 실제 수행. 개별 칩은 '특정 문서만'용으로 보존.

**어떻게**:
- 영향배너(1769)에 primary 버튼: `onClick={()=>regenerateDocs(currentMeeting!.id, impactedDocs)}`. `impactedDocs`는 `performSaveEdit`(628-630)에서 이미 존재·outdated·frozen제외·위상정렬 완료 → 그대로 전달.
- 진행 중 이 버튼·개별 칩 모두 disabled(기존 `isGenerating`). 완료 시 outdated 풀린 d를 `setImpactedDocs` filter(392 패턴)로 비워 칩이 줄어듦.
- **진행 표시는 GenerationGuard 전면 딤 단일 경로(결정 D).** regenerateDocs는 `startGeneration`처럼 `generationProgress`를 채우므로 GenerationGuard가 '3/5 생성 중' 오버레이를 자동 표시. **배너 내부 진행텍스트/칩 스피너는 만들지 않음**(딤 위라 안 보임 → 사양 폐기). 단 개별 칩으로 단일 재생성(#5)할 때는 딤 없이 그 칩만 `Loader2` 스피너(`isSingleGenerating && activeDoc===d`, **전역 단독 비교 금지=전 칩 동시 스핀**).

**완료 기준**: 일괄 버튼 1클릭으로 N개 위상순차 갱신, 진행 중 GenerationGuard 전면 딤 '3/5', 완료 후 칩 비워지고 배너 소멸. 개별 칩 재생성은 딤 없이 해당 칩만 스피너.
**선행**: 2

### 5. 단일 `handleGenerateDoc` 잡 인지 가드 + 진입/실패 상태 스냅샷 복원 `[P0/M]`
**무엇**: 전체생성/일괄갱신 중 단일 재생성의 동시 덮어쓰기 방지 + 칩 클릭 즉시 피드백.

**어떻게**:
- `handleGenerateDoc`(339) 진입부: `if (isGenerating || activeJob?.status==='running'){ alert('전체 생성/일괄 갱신이 진행 중입니다. 끝난 뒤 시도하세요'); return; }`(disabled는 같은 탭만 유효 → 타탭/복귀재개 타이밍 방어).
- 진입부 `prevStatus=getDocStatus(id,docType)` 스냅샷(frozen은 `canRegenerateDoc` 가드 347에서 차단).
- 실패 catch: `setDocStatus(id,docType,prevStatus)`로 **진입 전 값 정확 복원**(`outdated` 하드코딩 금지 — latest 진입 문서가 실패 후 거짓 강등되는 회귀 차단; 호출처 1750/1786/1927/1945/2250 진입상태 상이).

**완료 기준**: 전체생성 중 단일 칩 클릭은 alert 후 무동작. latest였던 문서 재생성 실패 시 latest 복원. 칩 클릭 직후 해당 칩만 스피너.
**선행**: 2

### 6. `onRehydrate`에서 죽은 'regenerating'→'outdated' 스윕 `[P0/S]` (B안 확정)
**무엇**: 일괄갱신 중 탭 강제종료/크래시로 'regenerating'이 localStorage에 박제되는 좀비 정리.

**어떻게**: **결정 D(전면 딤)로 #2가 일괄 갱신 시 `docStatuses`(persist)에 'regenerating'을 쓰는 게 확정 → B안 필수·P0 격상.** (A안=로컬 state는 전면 딤 단일경로와 양립 안 함 → 폐기.)
- `onRehydrateStorage`(740-755) activeJob keep 판정 직후, `state.docStatuses` 전 meetingId×docType 순회해 `'regenerating'`이면 `'outdated'`로만 강등(`'latest'`/`'outdated'`/`'frozen'` 불변). `isGenerating` 좀비방지(742)와 동일 패턴.
- frozen은 `getDocStatus` 우선반환(585)이라 추가 가드 불필요.

**완료 기준**: regen 중 강제 새로고침 후 regenerating 영구 잔류 0. 정상 latest/outdated/frozen 무변경.
**선행**: 2

### 7. `handleGenerateDoc`에 `getStaleParents` 가드 `[P1/S]`
**무엇**: 부모가 '업데이트 필요'인데 자식을 먼저 재생성하면 낡은 부모 내용이 박제되는 silent overwrite 방지.

**어떻게**: `getStaleParents`(documentUtils:300, 구현·테스트 완료지만 미사용)를 비-blocking 선언적 가드로 연결.
- `handleGenerateDoc`(339)에서 frozen 체크(346) 직후·contextDocs 구성(365) 전: `const stale=getStaleParents(docType, documents, d=>getDocStatus(...))`. `forceProceed` false이고 `stale.length>0`이면 전용 `staleGuard` state set 후 return(fetch race 차단).
- `parentWarning`(2349) 패턴 복제 AlertDialog: '그래도 진행'→`handleGenerateDoc(docType, true)`, '상위 먼저 갱신'→첫 stale 부모만 `setActiveDoc`(일괄 실행기 호출·자동변경 금지=절대선).

**완료 기준**: 부모 outdated에서 자식 단일 재생성 클릭 시 경고. forceProceed 시 정상 fetch.
**선행**: 없음

### 8. 부모모순 모달 → 비-blocking 인라인 advisory로 강등 `[P1/S]`
**무엇**: major 저장 시 영향배너(amber)+부모모순 모달 동시 노출의 이중경고 정리.

**어떻게**: `performSaveEdit`(636) 로직 무변경. `parentWarning` AlertDialog(2349-2366) 삭제 후 영향배너 인근에 독립 중립 인라인 div(slate/blue, AlertTriangle→Info). **dismiss를 impactedDocs와 독립**(배너 흡수 기각: 배너 0개/닫힘 시 부모 안내 증발 회귀). 부모 점프 버튼은 `setActiveDoc`만.

**완료 기준**: 중간문서 major 저장 시 blocking 없는 인라인 안내. 배너 X와 부모 X 독립. 부모만 있고 자식0 문서도 단독 표시.
**선행**: 없음

### 9. frozen 문서에 '전파 제외' 인라인 노트 + 라벨 어휘 통일 `[P1/S]`
**무엇**: frozen 문서는 상위가 바뀌어도 '업데이트 필요'가 안 뜨는 침묵을 1줄로 고지.

**어떻게**: `docHasContent` 블록(1811 근처)에서 `isDocFrozen`일 때만 한 줄: "이 문서는 AI 자동수정에서 제외돼요. 상위가 바뀌어도 '업데이트 필요' 표시가 자동으로 뜨지 않습니다." 기존 blue 톤(1465) 재사용, frozen 문서에만. 배지(1467 '고정됨')·토글(1606 '고정') 어휘 통일, 긴 라벨은 툴팁(1603)에만(lg 헤더 1554 잘림 방지). presentational only.

**완료 기준**: frozen 문서에만 노트 1줄, 비-frozen 무변화. 배지·토글 동일 어휘. lg 헤더 줄바꿈 없음.
**선행**: 없음

### 10. 영향배너 1회성 '현재 브라우저 기준' 고지 `[P2/S]`
**무엇**: 상태배지 디바이스 미동기화를 알리되 본문 안전성 동반으로 불안 차단.

**어떻게**: 트리거 `impactedDocs.length>0 && !localStorage.getItem('madStatusScopeHintSeen')`(자동표시 금지). 배너 내부 하단 인라인 1줄+닫기: "표시(업데이트 필요/고정됨)는 지금 보는 브라우저 기준이에요. 문서 내용 자체는 로그인하면 기기 간 동기화됩니다." 닫기 시 localStorage 플래그+로컬 숨김. **store/persist 미변경**(컴포넌트 스코프 가둠).

**완료 기준**: 영향배너 첫 표시 때만 1회 고지, 닫으면 재표시 안 됨. store 미변경.
**선행**: 4

### 11. 저장분기 모달 카피에 '안심' 1줄 추가 `[P2/S]`
**무엇**: 비기술 사용자가 주요/사소 양자택일 앞 망설임을 안심 문구로 축소.

**어떻게**: `AlertDialogDescription`(2333 사소수정 줄 다음) 1줄: "잘 모르겠으면 주요 변경을 고르세요. 하위 문서는 자동으로 바뀌지 않고 '업데이트 필요' 표시만 떠요." **'되돌릴 수 있어요' 금지**(undo/revert 기능 전무 → 거짓약속). 버튼·순서·primary 강조 현행 유지, '권장' 뱃지 미도입(사소수정 오부착 시 전파누락 silent stale 위험).

**완료 기준**: 모달에 안심 1줄, undo 약속 없음. 버튼 동작 무변경.
**선행**: 없음

### 12. outdated 문서 상단 배너 — 진입 시 자동 모달 금지·직계 부모명 표시 `[P0/S]`
**무엇**: outdated 문서를 열면 본문 상단에 "왜 오래됐는지(직계 부모명) + 지금 갱신" 배너를 조용히 노출. **자동 모달/팝업 없음**(트리거 정책 ②③④ 구현).

**어떻게**:
- `docHasContent` 블록(1811 근처, frozen 노트 #9와 같은 위치)에서 `currentMeeting?.id && getDocStatus(id, doc.key)==='outdated'`일 때만 amber 인라인 배너 렌더. **모달·AlertDialog 금지**(진입 시 흐름 끊김 차단 — 결정 ②).
- 원인 표시는 **직계 부모명만**: `getDirectParentTitles(doc.key)`(documentUtils:293, 이미 존재) 결과를 "상위 문서(기능목록·API명세)에서 파생된 문서예요"로 표시. **docStatuses 구조 무변경**(`causedBy` 추적 안 함 — 결정 ④, 다중원인 병합·persist 마이그레이션 회피).
- 배너 내 '지금 갱신' 버튼=`handleGenerateDoc(doc.key)`(기존, #5 가드/#7 stale가드 자동 적용). 진행 중 disabled.
- 사이드바 🔴 배지는 이미 구현(1450-1460) → 변경 없음(결정 ③의 사이드바 절반은 완료 상태).
- **자동 제안 안 함 원칙**: 이 배너는 페이지 진입 시 자동으로 뜨지만 **사용자가 클릭하기 전엔 아무것도 재생성/변경하지 않음**(절대선 준수, 단순 안내+버튼).

**완료 기준**: outdated 문서 진입 시 상단 배너 1개(모달 아님)+직계 부모명. latest/frozen 문서는 무노출. 갱신 클릭 전 자동변경 0. docStatuses 구조 무변경.
**선행**: 없음 (단 #5/#7 가드와 함께 동작)

---

## 기각된 권고 (합성 단계)

| 항목 | 기각 사유 |
|------|-----------|
| **약결합 화이트리스트 직접/간접 영향 그룹핑(배너 2단)** | backlog 최저가치(현 배너 이미 위상정렬). 설계 원문이 직접후손을 `getDirectParentTitles`(부모, 반대방향)로 오기, `getAllDependents` 재호출 시 배너 실제 집합과 어긋나 정합성 위험. 전파/마킹은 불변이라 cutScope 위반은 아니나 가치 낮음 → P2 보류. |
| **멀티탭 docStatuses storage 이벤트 자동 동기화 전제** | zustand persist는 `StorageEvent` 리스너 없음(검증). cross-tab 자동 동기화 미발생 → 권고 전제 거짓. 단 진입 가드 `activeJob?.status==='running'` 1줄은 1번에 흡수. |
| **SC-4 좀비 스윕 독립 P1 머지 / DC-3 set 경로 독립 채택** | SC-2가 regenerating을 persist해야만 의미 → 독립 채택 시 죽은 코드. 6번으로 SC-2 종속 불변식 흡수. |
| **일괄갱신 중 추가 수정 enqueue-merge** | enqueue 자체는 1번 단일진입 가드로 충족. '큐 문서 자동 최신반영' 주장은 현 루프(`generated[]` 진입 1회 스냅샷)와 불일치. 클릭트리거 절대선 경계 모호 → 진행 중 새 트리거 disabled, 완료 후 명시적 재클릭. |

---

## 결정 내역 (확정 + 잔여)

### 확정됨 (2026-06-22 사용자 결정)

| # | 결정 | 확정 |
|---|------|------|
| 트리거① | 갱신 방식 | **일괄 + 개별 둘 다** (기획 #4) |
| 트리거② | 진입 시 재생성 자동 제안 | **안 함** — 모달 없이 상단 인라인 배지만 (기획 #12) |
| 트리거③ | 진입 시 변경 알림 | **사이드바 배지 + 상단 배너 둘 다** (기획 #12, 사이드바는 기구현) |
| 트리거④ | 원인 표시 수준 | **직계 부모명만** — `getDirectParentTitles`, docStatuses 구조 무변경 (기획 #12) |
| A | 일괄 갱신 구현 방식 | **store 통합(1~4번)** — 19분급이라 resumable 필수, 로컬 루프는 끊기면 0건=P0 버그 일괄판 재현. mode 필드+`levelsFor`+상태전이 훅뿐, 새 잡/락 없어 좀비 0 |
| B | frozen 상위 변경 시 | **인라인 노트 고지로 충분(9번)** — 별도 상태는 docStatuses 단일슬롯/frozen 우선반환 깸 |
| C | frozen 부모 끊긴 사슬 | **frozen은 컨텍스트 시드로만 쓰고 갱신 대상 제외, 후손은 정상 갱신** — frozen=사용자 의도 존중. 7번 가드는 outdated 부모만 잡으므로 충돌 없음 |
| D | 일괄갱신 진행 중 표시 | **전체생성과 동일(GenerationGuard 전면 딤)** — `generationProgress`를 그대로 공유, **regen 분기 불필요(구현 단순)**. 일괄도 19분급까지 가능하므로 전면 딤이 오히려 일관·안전 |
| E | '현재 브라우저 기준' 고지(#10) | **채택** — major 영향배너 첫 표시 1회 한정. 본문 동기화되는데 배지만 다른 비대칭이 '데이터 유실' 오인되기 가장 쉬운 지점 |

> **결정 D 영향**: 기획 #4의 "작은 진행바만" 가정이 폐기됨. regenerateDocs는 `startGeneration`과 동일하게 `generationProgress`를 채우고, GenerationGuard 오버레이 스킵 분기를 **추가하지 않는다**. 영향배너 내부 진행텍스트/칩 스피너(#4)는 딤 위에 보이지 않으므로, 진행 표시는 GenerationGuard 단일 경로로 통일.

---

## 재확인된 과설계 금지선 (cutScope)

- **'review' DocStatus enum 신설 금지** — `'regenerating'`은 `types:8`에 이미 존재(죽은 상태를 살리는 것, 신설 아님).
- **자식→부모 자동 역전파·자동 재생성 금지** — 일괄갱신도 반드시 사용자 클릭(영향배너 버튼), getStaleParents는 경고만(자동변경 0).
- **하위 자동 즉시 일괄 재생성 금지** — `regenerateDocs` 진입은 단일진입 가드 + 명시적 버튼 onClick.
- **LLM 의미판정 변경강도/모순탐지 금지** — 주요/사소는 사용자 2지선다, stale은 `docStatuses==='outdated'` 읽기만.
- **DEPENDENCIES strong-weak 가중치 그래프 금지** — 화이트리스트 기각, 전파그래프 약화 안 함.
- **docVersion 부모자식 논리시계 비교·sonner toast 도입 금지** — 진행표시는 기존 generationProgress/배지/인라인 배너로만.
- **Vercel resumable·전체생성 인프라 재사용 절대선** — 새 잡/새 락 신설 금지(activeJob 1개·GENERATION_LOCK 1개·genAbort 1개 불변).
- **localStorage 단일출처** — 모든 상태배지 '현재 브라우저 기준', 신규 persist 키/액션 최소화.
