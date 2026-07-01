-- ============================================================
-- token_usage: LLM 토큰 실측 기록(과금 설계용). 서버(service_role)만 write.
-- "회의당 1회" 멱등인 usage_events와 별개 — 이건 호출 1건당 1행(원가 분석용 raw).
-- 배포 전 Supabase SQL Editor에 붙여넣고 Run.
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists public.token_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 집계용 KST YYYY-MM (서버가 채움)
  period text not null,
  -- 작업 종류: doc-generate | chat | edit-patch | edit-rewrite | research
  op text not null,
  provider text not null,   -- zai | openai | gemini | anthropic
  model text not null,      -- 실제 모델 id
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  -- 연관 회의/문서(있으면). 분석용.
  meeting_id text,
  doc_type text,
  created_at timestamptz not null default now()
);

-- 집계 성능: 유저·기간별
create index if not exists token_usage_user_period_idx
  on public.token_usage (user_id, period);
create index if not exists token_usage_op_idx
  on public.token_usage (op);

-- ============================================================
-- RLS: 본인 것만 조회. INSERT는 서버(service_role)가 RLS 우회로 수행하므로
--      일반 사용자 INSERT 정책은 두지 않는다(클라가 토큰 위조 기록 차단).
-- ============================================================
alter table public.token_usage enable row level security;
alter table public.token_usage force row level security;

drop policy if exists token_usage_select_own on public.token_usage;
create policy token_usage_select_own on public.token_usage
  for select using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE 정책 없음 → anon/authenticated는 쓰기 불가.
-- service_role 키(supabaseAdmin)는 RLS 우회하므로 서버 기록은 정상 동작.
