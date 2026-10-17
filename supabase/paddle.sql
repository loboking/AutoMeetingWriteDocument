-- ============================================================
-- Paddle 연동용 컬럼. Supabase SQL Editor에서 Run (idempotent).
-- 웹훅 코드가 이 컬럼을 읽고 쓰므로, 배포 전에 먼저 실행하세요.
--  paddle_subscription_id : 해지 API 호출 + "옛 구독 이벤트가 새 구독을 내리는" 사고 방지
--  paddle_event_at        : 이벤트 occurred_at. 오래된 이벤트가 최신 상태를 덮는 것 방지
-- ============================================================
alter table public.subscriptions
  add column if not exists paddle_subscription_id text,
  add column if not exists paddle_event_at timestamptz;

-- 웹훅 수신 기록: 처리 실패(error 있음 / processed_at null)를 사람이 찾아 대사·재처리하기 위함.
create table if not exists public.webhook_events (
  event_id text primary key,
  type text not null,
  payload jsonb,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
alter table public.webhook_events force row level security;
-- 정책 없음 = 클라 접근 불가, service_role(서버)만 읽기/쓰기.

-- 대사 쿼리(수동): 결제는 됐는데 플랜이 free인 유저
-- select p.user_id, p.payment_id, p.created_at from payments p
--   join subscriptions s on s.user_id = p.user_id
--  where p.status='paid' and p.plan in ('pro','team') and s.plan='free' and s.status<>'canceled';
-- 처리 실패 이벤트: select * from webhook_events where processed_at is null order by created_at desc;
