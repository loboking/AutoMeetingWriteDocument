# 관리자 페이지 기획 (확정본)

> 작성 2026-06-24. 이 문서는 **기획 확정본**이며 구현은 아직 안 함.
> 사용자 결정: 기능 4종 전부 / 관리자 구분 = 특정 이메일 화이트리스트.

---

## 1. 목적

서비스 운영자(1인)가 가입자·사용량·결제·운영 설정을 한 곳에서 보고 관리.
지금은 테스트 기간이라 **"지금 가능한 것"과 "데이터/결제가 생겨야 가능한 것"을 단계로 나눈다.**

## 2. 관리자 구분 (확정)

**특정 이메일 화이트리스트.** DB role 컬럼 도입 안 함(1인 운영에 과함).

- 화이트리스트: 환경변수 `ADMIN_EMAILS`(쉼표구분) 또는 상수. 1차는 `loboking@nate.com`.
- 서버 가드: `src/lib/apiAuth.ts`에 `requireAdmin(request)` 추가 — `requireUser`로 user 얻은 뒤
  `user.email`이 화이트리스트에 있는지 검사. 아니면 403.
- 클라 가드: `/admin` 페이지는 로그인 + 이메일 확인 후에만 렌더(아니면 홈 리다이렉트).
  **클라 체크는 UX용일 뿐, 진짜 보안은 서버 requireAdmin이 한다.**

## 3. 🔴 핵심 제약 (먼저 알아야 함)

1. **service_role 키 필요**: 현재 anon 키만 있어 RLS(`auth.uid()=user_id`)에 막혀
   관리자가 **다른 사용자 데이터를 못 본다.** 전체 사용자/회의 조회는 Supabase
   **service_role 키**(서버 전용, 절대 클라 노출 금지)로 admin API 라우트에서만 조회해야 함.
   → 대시보드에서 service_role 키 발급 + `SUPABASE_SERVICE_ROLE_KEY` 환경변수 추가(수동작업).
2. **사용량 데이터가 없음**: 회의 수는 meetings 테이블로 세지만, STT분/문서생성 횟수/토큰은
   **추적 테이블이 없다.** 사용량 모니터링은 "추적 도입" 후에야 의미 있음.
3. **결제가 없음**: 요금제/구독/횟수권 데이터 자체가 없다. 결제 관리는 결제 구현 후.

→ 따라서 **단계별 구현**이 필수. 한 번에 다 만들 수 없다.

## 4. 기능 범위 (4종) + 단계

### Phase A — 지금 가능 (데이터 이미 있음)
**사용자 관리 + 기본 통계.** service_role 키만 추가하면 됨.

- 가입자 목록: 이메일, 가입일, 마지막 활동(meetings.updated_at max), 회의 수.
  - `auth.users`(service_role로 조회) + meetings 집계 조인.
- 사용자 상세: 그 사용자의 회의 목록(제목/생성일/완료문서 수).
- 기본 지표: 총 가입자, 총 회의 수, 최근 7일 신규 가입/회의.
- 사용자 차단(선택): Supabase auth admin API로 `ban_duration` 설정(soft, 복구가능).

### Phase B — 사용량 추적 도입 후 (별도 선행 작업 필요)
**사용량 모니터링.** 먼저 "사용량 카운팅"을 구현해야 함(이건 관리자페이지와 별개 작업).

- 선행: `usage_events` 테이블 신설(user_id, type: stt|summarize|doc_generate, meta jsonb, created_at).
  각 비용 API(transcribe/summarize/generate-doc)가 성공 시 1행 insert.
- 관리자 화면: 사용자별/전체 STT분·문서생성수 집계, 기간 필터, 원가 추정(STT $0.006/분 등).
- 이 데이터가 결제 횟수권 차감·무료1회 제한의 기반이 됨([[code-quality-backlog]] 무관, 신규).

### Phase C — 결제 구현 후
**결제/구독 관리.** 결제(Stripe/Toss/PortOne)와 plan/subscription 테이블이 생긴 뒤.

- 사용자별 plan/구독상태/횟수권 잔량 조회, 수동 부여/취소(고객지원용).
- 결제 내역, 환불 처리 연동.
- ⚠️ 결제 자체가 미구현이라 지금은 **자리만**(설계 연결점).

### Phase A에 함께 — 서비스 운영/설정
**가벼운 운영 도구.** Phase A와 같이 또는 직후.

- 공지/배너 텍스트 관리(간단: 설정 테이블 1행 or 환경변수).
- 기본 AI provider 표시(읽기전용, [[llm-provider-abstraction]]의 resolveProvider 결과).
- 특정 사용자에게 알림 메일(선택, Supabase/외부 메일).
- 과설계 금지: 복잡한 CMS·권한세분화·감사로그는 1차 제외.

## 5. 기술 설계

### 라우팅
- 페이지: `src/app/admin/page.tsx` (+ 하위 탭: 사용자/사용량/결제/설정).
  - AuthGate가 `/admin`도 로그인 요구(현재 PUBLIC_PATHS에 없음 → 그대로 보호됨).
  - 페이지 진입 시 `user.email` 화이트리스트 아니면 홈 리다이렉트.
- API: `src/app/api/admin/*` (users, usage, ...). **모든 admin API는 `requireAdmin` 가드.**

### service_role 클라이언트
- `src/lib/supabaseAdmin.ts` 신설: `createClient(url, SERVICE_ROLE_KEY, {auth:{persistSession:false}})`.
  **서버에서만 import**(라우트). 절대 클라/번들 노출 금지. NEXT_PUBLIC_ 접두사 쓰지 말 것.
- `auth.users` 조회는 `supabaseAdmin.auth.admin.listUsers()` 사용.

### 관리자 가드 (apiAuth.ts 확장)
```
ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'loboking@nate.com').split(',')
export async function requireAdmin(request): Promise<AuthResult> {
  const auth = await requireUser(request);
  if (auth.response) return auth;
  if (!ADMIN_EMAILS.includes(auth.user.email)) return { response: 403 };
  return auth;
}
```

## 6. 수동 작업 (배포 전 필수)
1. Supabase 대시보드 → Settings → API → **service_role 키** 복사 → `SUPABASE_SERVICE_ROLE_KEY` 환경변수(Vercel + 로컬). **절대 공개 금지.**
2. `ADMIN_EMAILS` 환경변수 설정(미설정 시 코드 기본값 loboking@nate.com).
3. (Phase B) `usage_events` 테이블 SQL 실행.

## 7. 구현 순서 (권장)
1. **Phase A**: requireAdmin + supabaseAdmin + /admin(사용자목록·상세·기본지표) + 운영설정 일부.
2. **사용량 카운팅 선행작업**(usage_events insert) → **Phase B** 사용량 화면.
3. 결제 구현 → **Phase C** 결제 관리.

## 8. 과설계 금지선 (1차에 하지 말 것)
- DB role 컬럼/권한 세분화(1인이므로 이메일 화이트리스트로 충분)
- 복잡한 CMS, 감사 로그, 관리자 활동 추적
- 결제·사용량 화면을 데이터 없이 미리 구현(빈 껍데기 금지)
- 실시간 대시보드/차트 라이브러리 도입(1차는 숫자·표로 충분)
