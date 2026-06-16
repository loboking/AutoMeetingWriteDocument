-- ============================================================
-- meetings (사용자별 비공개 회의/문서). 기존 documents(공유 전용)와 완전 분리.
-- 본문은 jsonb 단일 컬럼(data)에 보관(컬럼분리 금지 → 필드 추가시 마이그레이션 불필요).
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================

-- pgcrypto: gen_random_uuid() 보장 (Supabase는 보통 활성화돼 있으나 안전하게)
create extension if not exists pgcrypto;

create table if not exists public.meetings (
  -- DB가 발급하는 진짜 PK (클라 id 충돌 걱정 제거)
  id uuid primary key default gen_random_uuid(),
  -- 소유자: 클라 입력 신뢰 금지. 세션 주인으로 자동 채움. 탈퇴시 cascade 삭제.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 목록 표시/정렬용 메타 (본문 jsonb를 끌어오지 않고 가볍게 조회)
  title text not null default '',
  -- 클라(localStorage)가 가진 crypto.randomUUID 회의 id를 보존 → 멱등 흡수 키
  client_id text not null,
  -- Meeting 본문 전체: 14문서 텍스트 + summary + transcript + segments + completedDocs 등
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 사용자가 같은 로컬 회의를 중복 흡수하지 못하게 (upsert onConflict 대상)
  unique (user_id, client_id)
);

-- 목록 조회 성능: 본인 회의를 created_at desc로
create index if not exists meetings_user_created_idx
  on public.meetings (user_id, created_at desc);

-- updated_at 자동 갱신 트리거 (클라 시계 신뢰 금지 → DB가 진실)
create or replace function public.set_meetings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_meetings_updated_at();

-- ============================================================
-- RLS: 개인정보 격리의 실제 방어선.
-- ENABLE + FORCE 둘 다(테이블 소유자 경로 우회까지 차단).
-- FOR ALL 한 줄로 뭉뚱그리지 말고 명령별 4정책 + INSERT/UPDATE는 WITH CHECK까지.
-- ============================================================
alter table public.meetings enable row level security;
alter table public.meetings force row level security;

-- SELECT: 본인 것만 조회 (anon key가 공개돼도 남의 행 0건)
drop policy if exists meetings_select_own on public.meetings;
create policy meetings_select_own on public.meetings
  for select using (auth.uid() = user_id);

-- INSERT: user_id 위조 차단. 클라가 user_id를 보내도 본인것만 허용(default와 이중방어)
drop policy if exists meetings_insert_own on public.meetings;
create policy meetings_insert_own on public.meetings
  for insert with check (auth.uid() = user_id);

-- UPDATE: 본인 행만, 본인것으로만 변경 가능
drop policy if exists meetings_update_own on public.meetings;
create policy meetings_update_own on public.meetings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- DELETE: 본인 행만 삭제
drop policy if exists meetings_delete_own on public.meetings;
create policy meetings_delete_own on public.meetings
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 검증용(SQL Editor에서 비로그인/anon 컨텍스트로 실행 시 0건이어야 함):
--   select count(*) from public.meetings;   -- 정책상 auth.uid() null → 0
-- 기존 documents 테이블은 이 SQL에서 절대 건드리지 않음(공유 링크 유지).
-- ============================================================
