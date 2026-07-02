-- ============================================================
-- subscriptions.granted 컬럼 추가:
--   관리자가 결제 없이 유료(무제한) 혜택을 "제공"한 계정 표시.
--   기존 subscriptions 테이블에 컬럼만 추가(idempotent). SQL Editor에서 Run.
-- ============================================================
alter table public.subscriptions
  add column if not exists granted boolean not null default false;

-- 참고:
-- - granted=true 이면 getUserPlan이 결제상태와 무관하게 유료(무제한) 취급.
-- - 관리자 부여/해제는 서버 admin API(service_role)로만 변경.
-- - 구독 행이 없는 사용자에게 부여할 땐 upsert로 생성됨(plan='pro', granted=true).
