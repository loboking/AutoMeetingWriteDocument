// meeting_notes 테이블 동기화 헬퍼. 브라우저 supabase-js로 직접 호출(서버 라우트 X).
// meetingsSync.ts migrateLocalMeetings 패턴을 MeetingNote용으로 1:1 차용.
// 태오 notesSync.ts와 병렬 작업이므로 의존하지 않고 supabase 직접 쿼리.
import { supabase, meetingNoteToRow, rowToMeetingNote } from '@/lib/supabase';
import type { MeetingNote } from '@/types';

const notesMigratedFlagKey = (userId: string) => `mad:notes-migrated:${userId}`;

// 본인 회의록 전체 조회. RLS가 본인 행만 반환.
export async function fetchMeetingNotesFromServer(): Promise<MeetingNote[]> {
  const { data, error } = await supabase
    .from('meeting_notes')
    .select('id,client_id,title,data,created_at,updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[notesMigrate] fetch error:', error.message);
    return [];
  }
  return (data || []).map(rowToMeetingNote);
}

// 회의록 1건 upsert. user_id 미포함 → DB default auth.uid() + RLS가 소유자 강제.
export async function upsertMeetingNoteToServer(note: MeetingNote): Promise<boolean> {
  const { error } = await supabase
    .from('meeting_notes')
    .upsert(meetingNoteToRow(note), { onConflict: 'user_id,client_id' });

  if (error) {
    console.error('[notesMigrate] upsert error:', error.message);
    return false;
  }
  return true;
}

// 첫 로그인 시 localStorage의 회의록을 그 계정으로 1회 흡수(멱등).
// meetingsSync.migrateLocalMeetings 패턴 1:1 차용.
// 서버에 없는 로컬 회의록만 회의록단위로 upsert.
// 전부 성공해야 전역 완료 플래그를 찍어, 부분 실패는 다음 로그인/tick에 재시도.
export async function migrateLocalMeetingNotes(
  userId: string,
  localNotes: MeetingNote[],
  serverNotes: MeetingNote[]
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(notesMigratedFlagKey(userId))) return; // 이미 흡수됨

  const serverClientIds = new Set(serverNotes.map((n) => n.id));
  const toMigrate = localNotes.filter((n) => !serverClientIds.has(n.id));

  if (toMigrate.length === 0) {
    localStorage.setItem(notesMigratedFlagKey(userId), '1');
    return;
  }

  let allOk = true;
  for (const note of toMigrate) {
    const ok = await upsertMeetingNoteToServer(note);
    if (!ok) allOk = false; // 실패해도 나머지는 계속 시도(멱등)
  }

  // 전부 성공한 경우에만 완료 플래그(부분 실패 시 다음 기회에 재시도)
  if (allOk) localStorage.setItem(notesMigratedFlagKey(userId), '1');
}
