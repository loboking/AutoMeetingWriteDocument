-- ============================================================
-- usage_events (사용량 미터링: 월 프로젝트 처리 건수). 결제 전 단계 — 지금은 "기록만".
-- 카운트 규칙: 한 프로젝트(project_id)에서 문서가 1개라도 생성 성공하면 그 순간 1건.
--   재생성/추가 문서는 재차감 X → 프로젝트당 평생 1회(unique(user_id, project_id), period 제외).
-- 쓰기는 서버 라우트의 service_role 클라이언트만(RLS bypass). 클라는 select own만.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================
--
-- ★ MIGRATION (meeting_id → project_id):
--   1) ALTER RENAME으로 기존 meeting_id 값을 project_id로 보존.
--   2) unique 제약을 (user_id, project_id)로 재생성.
--   이미 배포된 환경은 아래 -- MIGRATION 블록을 순서대로 실행.
--   신규 환경은 create table 블록만 실행하면 됨.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  -- 소유자. 서버가 검증된 auth.user.id를 명시 주입(service_role 경로라 default auth.uid() 안 씀).
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 프로젝트 id. 차감 멱등 키.
  project_id text not null,
  -- 집계/기록용. KST 기준 YYYY-MM (서버가 채움). unique엔 미포함(아래 주석).
  period text not null,
  -- 첫 차감을 유발한 문서 종류(분석/디버깅용).
  doc_type text not null,
  created_at timestamptz not null default now(),
  -- ★ period 제외가 핵심: "프로젝트당 평생 1회" 차감 = 요구사항 정확 구현.
  --   period를 넣으면 다음 달 재생성이 새 row로 또 차감되는 버그.
  unique (user_id, project_id)
);

-- "이번 달 N건" count(*) where user_id and period 가속
create index if not exists usage_events_user_period_idx
  on public.usage_events (user_id, period);

-- ============================================================
-- MIGRATION: 기존 meeting_id → project_id (순서대로 실행)
-- ============================================================
-- Step 1: unique 제약 제거 (이름은 PostgreSQL 자동 생성명 사용 — 실제 이름 확인 후 교체)
--   alter table public.usage_events drop constraint usage_events_user_id_meeting_id_key;
-- Step 2: 컬럼 리네임 (기존 데이터 보존)
--   alter table public.usage_events rename column meeting_id to project_id;
-- Step 3: 새 unique 제약 추가
--   alter table public.usage_events add constraint usage_events_user_id_project_id_key unique (user_id, project_id);
-- ============================================================

-- ============================================================
-- RLS: 클라(anon)는 본인 사용량 조회만. 쓰기는 service_role(bypassrls)이 서버에서만.
-- ============================================================
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;

-- SELECT: 본인 것만(사용량 배너 조회용)
drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE 정책 없음 → anon 키로는 쓰기 불가.
-- service_role 키는 bypassrls 속성이라 force RLS도 우회하여 서버에서만 insert.

-- ============================================================
-- 검증(SQL Editor의 비로그인/anon 컨텍스트에서):
--   select count(*) from public.usage_events;   -- 정책상 auth.uid() null → 0
-- meetings 테이블은 이 SQL에서 절대 건드리지 않음.
-- ============================================================
