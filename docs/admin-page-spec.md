# 관리자 페이지 기능 검토서

> 작성 2026-07-02. docs/admin-page-plan.md(2026-06-24) 대체.
> "기획 당시 없던 것이 다 생겼다"는 전제 위에서 화면/기능을 재정의한다.
> 코드 없음 — 무엇을, 왜, 어떤 순서로 만들지만 다룬다.

---

## 0. 전제 변경 요약

| 항목 | 구 기획(2026-06-24) 상태 | 지금 상태 |
|---|---|---|
| usage_events | "선행 작업 필요" | 테이블 존재, 생성 중(커밋 76c180e) |
| subscriptions / payments | "결제 없음" | 테이블 존재, PortOne V2 연동 완료(커밋 367232d) |
| token_usage | 언급 없음 | 테이블 신설, 데이터 쌓이기 시작 |
| supabaseAdmin | "서비스롤 키 추가 필요" | src/lib/supabaseAdmin.ts 구현 완료, 결제/미터링에서 사용 중 |
| ENFORCE_LIMIT | N/A | 코드에 있으나 false(기록만) |

결론: Phase A/B/C의 단계 구분이 더 이상 유효하지 않다. 데이터 소스가 다 있으므로
이제는 "운영에 얼마나 필요한가"로 우선순위를 매긴다.

---

## 1. 접근 원칙

1인 운영 서비스다. 화면이 많다고 좋은 게 아니다.
"주 1회 열어볼 때 보고 싶은 것"만 P0에 넣고, 나머지는 P1/P2로 밀어라.
집계 쿼리가 느릴 수 있다 — 실시간 차트보다 숫자 카드와 정렬 가능한 테이블이 먼저다.

---

## 2. 전체 화면 지도

```
/admin
├── (홈) 대시보드            ← 핵심 지표 카드 모음
├── /users                   ← 사용자 목록 + 상세
├── /billing                 ← 구독/결제 내역 + 실패 결제
├── /usage                   ← 토큰 원가 + 사용량 집계
└── /settings                ← 운영 노브 (ENFORCE_LIMIT 등)
```

탭 또는 사이드바 네비. 전부 `/admin` 하위이므로 단일 레이아웃 컴포넌트에 adminGuard.

---

## 3. 대시보드 (홈) — P0

### 역할
한 페이지에서 "서비스가 살아있는가"를 10초 안에 확인한다.
숫자 카드 + 단순 목록으로 충분. 차트 라이브러리 도입 불필요(1차).

### 카드 목록

| 카드 | 값 | 데이터 소스 | 쿼리 |
|---|---|---|---|
| 총 가입자 | N명 | auth.users (service_role) | listUsers count |
| 이번달 신규 가입 | N명 | auth.users.created_at | WHERE 이번달 |
| 유료 구독자 | N명 | subscriptions | WHERE plan != 'free' AND status = 'active' |
| MRR (예상) | N원 | subscriptions + plans.ts | active 구독 plan별 count × 단가 합산 |
| 이번달 회의 처리 | N건 | usage_events.period | WHERE period = 현재 |
| 이번달 LLM 원가 | N원 (추정) | token_usage.period | 토큰 × 모델 단가 합산(3-2 참고) |
| 실패 결제 (이번달) | N건 | payments.status = 'failed' | WHERE 이번달 |
| 마지막 가입자 | 이메일 + 가입일 | auth.users | order created_at desc limit 1 |

### 하단 — 최근 이상 징후 목록 (선택, P1)
- past_due 상태 구독 목록 (payments 실패 후 미갱신)
- 이번달 사용량 한도 90% 이상 유저 (usage_events count / getMonthlyLimit)

### 왜 P0인가
열 때마다 보는 첫 화면이다. 이게 없으면 현황 파악에 Supabase 대시보드를 직접 열어야 한다.

---

## 4. 사용자 관리 — P0

### 4-1. 목록 화면

**컬럼 정의**

| 컬럼 | 출처 | 비고 |
|---|---|---|
| 이메일 | auth.users.email | 검색 가능 |
| 가입일 | auth.users.created_at | 정렬 가능 |
| 마지막 로그인 | auth.users.last_sign_in_at | |
| 플랜 | subscriptions.plan | 없으면 free |
| 구독 상태 | subscriptions.status | active/canceled/past_due |
| 이번달 회의 | usage_events count WHERE period=현재 | |
| 총 회의 | meetings count WHERE user_id | |

**필터/정렬**
- 플랜 필터(전체/free/pro/team)
- 구독 상태 필터(active/past_due/canceled)
- 가입일 내림차순 기본. 이메일 검색.

**페이지네이션**
- listUsers는 page/perPage 파라미터 지원. 50건/페이지로 시작.

### 4-2. 사용자 상세 화면

URL: `/admin/users/[userId]`

**섹션 1 — 계정 기본**
- 이메일, 가입일, 마지막 로그인
- 이메일 인증 여부 (auth.users.email_confirmed_at)

**섹션 2 — 구독/결제**
- 현재 플랜, 상태, 기간 만료일, cancel_at_period_end
- 결제 내역 최근 5건 (payments 테이블): 날짜/금액/상태
- 수동 액션(P1): 플랜 강제 변경 (고객지원용 — 환불 후 수동 downgrade 등)

**섹션 3 — 사용량**
- 월별 회의 처리 건수 (usage_events, 최근 3개월 period 별)
- 이번달 LLM 토큰 소모 (token_usage, op별 subtotal)
- 원가 추정 (3-2의 단가 기준)

**섹션 4 — 회의 목록**
- meetings 테이블: 제목, 생성일, 완료 문서 수
- 최근 10건. 더보기 없어도 됨(관리자 용도 한정).
- transcript/문서 본문은 기본 비표시. 필요시 별도 확장(개인정보 주의, 7절 참고).

**운영 액션**
- 차단/해제: supabaseAdmin.auth.admin.updateUserById({ ban_duration: '876600h' / 'none' })
  - soft ban — 복구 가능. 로그인 불가, 기존 세션 만료.
  - UI: "차단" 버튼 → 확인 모달 → API /admin/users/[id]/ban POST

### 왜 P0인가
가입자가 늘기 시작하면 "이 사람 누구야" 조회가 가장 먼저 필요해진다.
결제 분쟁/차단 요청도 사용자 상세에서 처리한다.

---

## 5. 결제/구독 관리 — P0

### 5-1. 구독 목록

| 컬럼 | 출처 |
|---|---|
| 이메일 | auth.users JOIN |
| 플랜 | subscriptions.plan |
| 상태 | subscriptions.status |
| 기간 만료일 | subscriptions.current_period_end |
| 취소 예약 | subscriptions.cancel_at_period_end |
| 빌링키 보유 | billing_key IS NOT NULL |

필터: 상태(active/canceled/past_due), 플랜.

### 5-2. 결제 내역

최근 결제 전체 목록 (payments 테이블). 기간 필터(이번달/지난달/전체).

| 컬럼 | 출처 |
|---|---|
| 결제일시 | payments.created_at |
| 이메일 | auth.users JOIN via user_id |
| 플랜 | payments.plan |
| 금액 | payments.amount |
| 상태 | payments.status (paid/failed/canceled) |
| PortOne paymentId | payments.payment_id |

### 5-3. 실패 결제 별도 탭

payments.status = 'failed' 필터링. 대시보드의 실패 건수를 누르면 여기로 이동.
표시: 이메일, 실패일시, 플랜, 금액, PortOne raw에서 실패 사유(raw.message).

### 5-4. 수동 플랜 부여/취소 (P1)

고객지원 시나리오: 결제는 됐는데 시스템 오류로 plan이 안 올라간 경우.
- 어드민 API: `PATCH /admin/subscriptions/[userId]` body { plan, status }
- subscriptions upsert + payments 행 수동 insert (audit trail용)
- 환불 처리는 PortOne 대시보드에서 직접. 이 화면에서 건드리지 않음.

### 왜 P0인가
유료 전환이 시작되면 "결제는 됐는데 플랜이 안 오름" 류의 CS가 반드시 온다.
cron 재결제 실패도 여기서 확인한다.

---

## 6. 사용량/원가 모니터링 — P1

token_usage는 방금 켜서 과거 데이터가 없다. 따라서 대시보드의 카드는 P0로 만들되,
전용 화면은 데이터가 1~2달 쌓인 뒤 만들어도 충분하다.

### 6-1. 전체 집계 (기간 필터: 이번달/지난달 선택)

| 지표 | 산출 | 용도 |
|---|---|---|
| 총 input_tokens | SUM(input_tokens) | 비용 추정 분자 |
| 총 output_tokens | SUM(output_tokens) | |
| op별 breakdown | GROUP BY op | 어떤 작업이 토큰을 많이 쓰는지 |
| provider별 breakdown | GROUP BY provider | z.ai / openai 혼용 여부 |
| 추정 원가 | tokens × 모델 단가 | 6-2 참고 |

### 6-2. 모델 단가 (추정 기준)

관리자 페이지에서 단가를 하드코딩하면 모델 변경 시 틀린 숫자를 보게 된다.
1차는 표 형태로 모델별 단가를 상수로 관리하고, 실제 청구와 교차 검증하는 방식으로 충분.

참고 단가 (1M 토큰당, 기록 시점):
- z.ai GLM 코딩플랜: 정액 (토큰 단가 의미 없음 — 건수 기준으로만 원가 추정)
- OpenAI GPT-4o: input $2.5, output $10 / 1M
- Anthropic Claude Sonnet: input $3, output $15 / 1M

z.ai 정액이라면 토큰 집계는 "얼마나 쓰는지 파악"용이지 직접 비용은 아님.
즉 token_usage 화면의 핵심은 **헤비유저 탐지**와 **플랜 적절성 검증**이다.

### 6-3. 헤비유저 탐지

기간 필터 + 유저별 total_tokens 내림차순 상위 20.
"이 유저가 혼자 전체 사용량의 X%를 쓰고 있다"를 확인하는 용도.
토큰 소모 대비 구독 플랜이 맞지 않으면 요금제 재설계 판단 근거가 된다.

### 6-4. op별 단가 드릴다운 (P2)

- doc-generate / edit-patch / edit-rewrite / research 별로 평균 토큰/호출 계산
- 이 숫자가 크레딧 재설계(docs/business/pricing-credit-redesign.md) 논의의 근거 데이터

### 왜 P1인가
데이터가 충분히 쌓이기 전에는 보여줄 숫자가 없다. 대시보드 카드로 1차 목마름을 해소하고,
전용 화면은 2~3달 후에 만들어도 늦지 않다.

---

## 7. 운영 설정 — P1

### 7-1. ENFORCE_LIMIT 토글

현재 환경변수로만 제어(usageMetering.ts). 관리자 화면에서 보여주되 **토글은 선택**.
환경변수 변경 → Vercel 재배포가 필요해서 어드민 UI에서 live 변경은 구현 복잡도가 높다.

1차: 현재 값(true/false) 표시만 하고 "변경은 Vercel 환경변수에서" 안내 텍스트.
P2: DB 설정 테이블(1행) + 서버에서 DB값 우선 읽기로 전환하면 재배포 없이 토글 가능.

### 7-2. ADMIN_EMAILS 표시

현재 이메일 화이트리스트 표시(읽기전용). 변경은 환경변수에서.
추가 관리자 필요 시 환경변수 업데이트가 가장 안전.

### 7-3. LLM Provider 현황

resolveProvider() 결과(실제 사용 중인 provider) 표시.
환경변수 설정 확인용 — 운영 중 "z.ai가 살아있나" 빠른 확인.

### 7-4. 공지/배너 텍스트 (P2)

설정 테이블 1행(key-value)으로 관리. 배너 텍스트가 필요한 시점에 구현.
지금은 불필요. 1차 제외.

---

## 8. 구현 우선순위 요약

### P0 — 유료 전환 전 필수 (지금 만들어야 함)

| 화면/기능 | 최소 기능(MVP) | 제외(나중) |
|---|---|---|
| 대시보드 | 숫자 카드 8개 | 차트, 실시간 |
| 사용자 목록 | 이메일/가입일/플랜/상태/회의수, 검색 | 이상 징후 강조 |
| 사용자 상세 | 기본정보+구독+회의목록+차단 액션 | transcript 열람, 토큰 드릴다운 |
| 구독 목록 | 컬럼 정의대로, 상태 필터 | 수동 플랜 변경 |
| 결제 내역 + 실패 탭 | 목록 + 실패 필터 | 환불 처리 |

**필요한 API 라우트 (신설)**
```
GET  /api/admin/dashboard        — 대시보드 카드 집계
GET  /api/admin/users            — 목록(page, filter, search)
GET  /api/admin/users/[id]       — 상세
POST /api/admin/users/[id]/ban   — 차단/해제
GET  /api/admin/subscriptions    — 구독 목록
GET  /api/admin/payments         — 결제 내역(filter)
```

모든 라우트는 requireAdmin 가드 필수. requireAdmin은 apiAuth.ts에 추가.

### P1 — 유료 전환 직후 (데이터 쌓이면)

- 사용자 상세 내 토큰 소모 섹션
- 수동 플랜 부여/취소 (PATCH /api/admin/subscriptions/[userId])
- 사용량/원가 전용 화면 (집계 + 헤비유저 상위 20)
- 운영 설정 화면 (읽기전용 표시)

### P2 — 필요해지면

- ENFORCE_LIMIT DB 토글 (재배포 없이 차단 on/off)
- op별 토큰 단가 드릴다운
- 공지 배너 관리
- 이상 징후 알림 (past_due 발생 시 이메일 등)
- past_due 유저 재시도 수동 트리거

---

## 9. 주의/리스크

### 9-1. service_role 보안

supabaseAdmin.ts가 이미 있고 결제/미터링에서 사용 중이다.
신설 admin API 라우트도 동일 패턴(서버 전용, NEXT_PUBLIC_ 접두사 금지)을 따른다.
클라이언트 번들에 포함되면 모든 사용자 데이터가 노출된다.

확인 포인트:
- `src/app/api/admin/*` 의 모든 파일이 `'use server'` 없이 서버 라우트인지
- supabaseAdmin import가 클라 컴포넌트 경로로 흘러가지 않는지 (빌드 시 경고로 잡힘)

### 9-2. 개인정보 — transcript 열람 범위

meetings.data jsonb에 transcript(녹음 전사본)와 14종 문서 본문이 들어있다.
관리자가 이것을 열람하는 것은 개인정보처리방침 상 민감하다.

원칙:
- 사용자 상세에서 transcript/문서 본문은 기본 비표시
- 회의 건수, 문서 완료 수, 생성일 같은 메타데이터만 표시
- 본문 열람이 필요한 경우(CS 요청 등)는 Supabase 대시보드 직접 접근으로 대체
- 관리자 페이지에 열람 기능을 노출하려면 개인정보처리방침에 "운영자 열람 가능" 항목 추가 필요

### 9-3. 집계 쿼리 성능

admin/dashboard는 여러 테이블을 한 번에 집계한다.
사용자 수백 명 이하에서는 문제 없다. 그 이상이면:
- 집계 결과를 1시간 캐시 (Next.js revalidate 또는 메모)
- 무거운 집계(token_usage 전체 SUM)는 별도 API로 분리해 lazy 로드

### 9-4. listUsers 제한

supabaseAdmin.auth.admin.listUsers()는 기본 50건/페이지다.
페이지네이션 파라미터(page, perPage)를 쿼리스트링으로 그대로 받아서 넘기면 된다.
이메일 검색은 listUsers에 filter 옵션이 없어서 전체 로드 후 서버 필터링이 필요할 수 있다 — 유저 수가 늘면 문제가 된다. 그 전까지는 단순 구현으로도 충분.

### 9-5. payments 환불 처리

환불은 이 화면에서 API 호출하지 않는다. PortOne 관리자 콘솔에서 직접.
이유: 환불 로직이 복잡하고(부분환불/전체환불/구독취소 연동), 1인 운영에서는 수동이 더 안전.
관리자 페이지에는 PortOne paymentId 표시 → 콘솔에서 검색하는 워크플로.

---

## 10. 기술 연결점 (구현 시 참고)

| 신설 | 기존 참조 포인트 |
|---|---|
| requireAdmin | src/lib/apiAuth.ts — requireUser 확장 |
| supabaseAdmin | src/lib/supabaseAdmin.ts — 이미 있음 |
| 플랜 단가/한도 | src/lib/plans.ts — PLANS, getPlanPrice |
| 구독 조회 | src/lib/subscriptionStore.ts — getSubscription, getUserPlan |
| 사용량 집계 | src/lib/usageMetering.ts — countThisPeriod, getCurrentPeriod |
| 페이지 위치 | src/app/admin/ (AuthGate가 이미 PUBLIC_PATHS 아닌 경로 보호) |

---

## 11. 과설계 금지선 (1차에 하지 말 것)

- DB role 컬럼/권한 세분화 (이메일 화이트리스트로 충분)
- 감사 로그 (관리자 행위 기록) — 1인이므로 불필요
- 실시간 차트/WebSocket 대시보드
- 환불 자동화 API 연동
- 관리자 알림 시스템 (이메일/슬랙) — P2 이후
- transcript/문서 본문 열람 UI — 개인정보처리방침 미정비 시 불가
- 복수 관리자 권한 세분화
- 쿠폰/프로모션 코드 발행
