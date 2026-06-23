-- ============================================================
-- recordings (음성 변환용 임시 저장소). STT 변환 후 클라가 삭제하는 임시 사본 전용.
-- 영구 보관 아님 — 변환 끝나면 transcribeAudio가 delete(ref)로 정리(고아는 추후 배치 청소).
-- 경로 규칙: {auth.uid()}/{uuid}.{ext}  → 첫 폴더 세그먼트가 소유자 uid (RLS가 강제).
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- ============================================================

-- 1) 버킷 생성 (private, 파일당 50MB, 오디오 MIME만 허용)
--    무료 플랜 전역 한도 50MB 이내. 이미 있으면 무시.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,                                   -- private: 서명 URL로만 접근
  52428800,                                -- 50MB
  array['audio/webm','audio/mpeg','audio/mp3','audio/mp4','audio/m4a','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/x-flac','audio/flac','application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) RLS 정책: 인증 사용자가 본인 폴더({uid}/*)에만 업로드/조회/삭제.
--    storage.foldername(name)[1] = 경로 첫 세그먼트(= 우리가 넣는 user.id).
--    (storage.objects 의 RLS 자체는 Supabase가 기본 활성.)

-- 기존 동명 정책 제거(재실행 멱등)
drop policy if exists "recordings_insert_own" on storage.objects;
drop policy if exists "recordings_select_own" on storage.objects;
drop policy if exists "recordings_delete_own" on storage.objects;

-- 업로드: 본인 폴더에만
create policy "recordings_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 조회(서명 URL 생성 포함): 본인 것만
create policy "recordings_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 삭제(임시 사본 정리): 본인 것만
create policy "recordings_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 검증: 로그인 사용자가 본인 폴더 외 경로 업로드/조회 시 RLS가 거부해야 함.
--   select count(*) from storage.objects where bucket_id='recordings';  -- 본인 것만 보여야
