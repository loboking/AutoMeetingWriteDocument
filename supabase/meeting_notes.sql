-- ============================================================
-- meeting_notes (회의록 모드 ① 의 독립 산출).
-- meetings.sql 패턴을 1:1 차용. 14문서/Project FK 없는 가벼운 회의록.
-- 본문은 jsonb 단일 컬럼(data)에 보관(필드 추가시 마이그레이션 불필요).
-- 합성(③) 시 Project(composite).sourceNoteIds가 이 행들의 client_id(id)를 참조한다.
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================

-- pgcrypto: gen_random_uuid() 보장 (Supabase는 보통 활성화돼 있으나 안전하게)
create extension if not exists pgcrypto;

create table if not exists public.meeting_notes (
  -- DB가 발급하는 진짜 PK (클라 id 충돌 걱정 제거)
  id uuid primary key default gen_random_uuid(),
  -- 소유자: 클라 입력 신뢰 금지. 세션 주인으로 자동 채움. 탈퇴시 cascade 삭제.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 목록 표시/정렬용 메타 (본문 jsonb를 끌어오지 않고 가볍게 조회)
  title text not null default '',
  -- 클라(localStorage)가 가진 crypto.randomUUID 회의록 id를 보존 → 멱등 흡수 키
  client_id text not null,
  -- 합성(③) 시 Project(composite)에 참조될 때 채움. 회의록 모드(①)는 null.
  -- FK 미설정: projects 테이블 DDL이 아직 실행 전일 수 있어 references가 실행을 깨뜨리지 않도록.
  -- projects DDL 실행 후: alter table public.meeting_notes
  --   add constraint meeting_notes_project_id_fkey
  --   foreign key (project_id) references public.projects(id) on delete set null;
  project_id uuid,
  -- MeetingNote 본문 전체. 타입 정합(src/types/index.ts:77 MeetingNote):
  --   { id, title, createdAt, updatedAt?,
  --     transcript, transcriptSegments?(화자 라벨), summary: MeetingSummary,
  --     audioUrl?, duration?(초), tags?, source?: 'recording'|'text'|'file' }
  -- MeetingSummary: { overview, keyPoints[], decisions[], actionItems[] }
  -- 14문서 필드(prd/wbs/...)는 없음 — Meeting(②)과의 분기점.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 사용자가 같은 로컬 회의록을 중복 흡수하지 못하게 (upsert onConflict 대상)
  unique (user_id, client_id)
);

-- 목록 조회 성능: 본인 회의록을 created_at desc로
create index if not exists meeting_notes_user_created_idx
  on public.meeting_notes (user_id, created_at desc);

-- 합성(③) 참조 조회용: 특정 Project에 묶인 회의록들을 사용자별로
create index if not exists meeting_notes_user_project_idx
  on public.meeting_notes (user_id, project_id);

-- updated_at 자동 갱신 트리거 (클라 시계 신뢰 금지 → DB가 진실)
create or replace function public.set_meeting_notes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meeting_notes_set_updated_at on public.meeting_notes;
create trigger meeting_notes_set_updated_at
  before update on public.meeting_notes
  for each row execute function public.set_meeting_notes_updated_at();

-- ============================================================
-- RLS: 개인정보 격리의 실제 방어선.
-- ENABLE + FORCE 둘 다(테이블 소유자 경로 우회까지 차단).
-- FOR ALL 한 줄로 뭉뚱그리지 말고 명령별 4정책 + INSERT/UPDATE는 WITH CHECK까지.
-- ============================================================
alter table public.meeting_notes enable row level security;
alter table public.meeting_notes force row level security;

-- SELECT: 본인 것만 조회 (anon key가 공개돼도 남의 행 0건)
drop policy if exists meeting_notes_select_own on public.meeting_notes;
create policy meeting_notes_select_own on public.meeting_notes
  for select using (auth.uid() = user_id);

-- INSERT: user_id 위조 차단. 클라가 user_id를 보내도 본인것만 허용(default와 이중방어)
drop policy if exists meeting_notes_insert_own on public.meeting_notes;
create policy meeting_notes_insert_own on public.meeting_notes
  for insert with check (auth.uid() = user_id);

-- UPDATE: 본인 행만, 본인것으로만 변경 가능
drop policy if exists meeting_notes_update_own on public.meeting_notes;
create policy meeting_notes_update_own on public.meeting_notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- DELETE: 본인 행만 삭제
drop policy if exists meeting_notes_delete_own on public.meeting_notes;
create policy meeting_notes_delete_own on public.meeting_notes
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 검증용(SQL Editor에서 비로그인/anon 컨텍스트로 실행 시 0건이어야 함):
--   select count(*) from public.meeting_notes;   -- 정책상 auth.uid() null → 0
-- ============================================================
