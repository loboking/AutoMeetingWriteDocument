-- ============================================================
-- subscriptions + payments (PortOne 정기구독 결제). 미터링([[usage_events]])과 연결:
--   usageMetering.getMonthlyLimit가 subscriptions.plan을 읽어 한도를 결정.
-- 쓰기는 서버 라우트의 service_role만(RLS bypass). 클라는 select own만.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================

create extension if not exists pgcrypto;

-- ── 구독 상태(유저당 1행) ──
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- 유저당 1구독. 서버가 검증된 auth.user.id 명시 주입(service_role 경로).
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free',          -- 'free' | 'pro' | 'team'
  status text not null default 'active',       -- 'active' | 'canceled' | 'past_due'
  billing_key text,                            -- PortOne 빌링키(재결제용). 카드정보 아님.
  customer_id text,                            -- PortOne customer id
  current_period_start timestamptz,
  current_period_end timestamptz,              -- 이 시각 지나면 cron이 재결제 시도
  cancel_at_period_end boolean not null default false, -- 취소 예약(기간 끝까지 유지)
  granted boolean not null default false,      -- 관리자 "제공": 결제 없이 유료(무제한) 혜택
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존 테이블이 이미 있던 경우를 위한 컬럼 보강(idempotent)
alter table public.subscriptions
  add column if not exists granted boolean not null default false;

-- cron 재결제 대상 조회 가속(만료 임박 active 구독)
create index if not exists subscriptions_renew_idx
  on public.subscriptions (status, current_period_end);

-- ── 결제 이력(멱등 키 = PortOne paymentId) ──
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id text not null unique,             -- PortOne paymentId. 웹훅 중복 흡수 멱등키.
  plan text not null,
  amount integer not null,                     -- 결제 금액(원). 서버가 plans.ts에서 결정.
  status text not null,                        -- 'paid' | 'failed' | 'canceled'
  raw jsonb,                                   -- PortOne 응답 원본(디버깅/분쟁)
  created_at timestamptz not null default now()
);

create index if not exists payments_user_created_idx
  on public.payments (user_id, created_at desc);

-- updated_at 자동 갱신(meetings.sql 패턴 재사용)
create or replace function public.set_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_subscriptions_updated_at();

-- ============================================================
-- RLS: 클라(anon)는 본인 구독/결제 조회만. 쓰기는 service_role(서버)만.
-- ============================================================
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE 정책 없음 → anon 키로 쓰기 불가. service_role(bypassrls)이 서버에서만.

-- ============================================================
-- 검증(비로그인/anon 컨텍스트):
--   select count(*) from public.subscriptions;  -- 0
--   select count(*) from public.payments;        -- 0
-- ============================================================
