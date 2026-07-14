// meeting_notes 테이블 동기화 헬퍼. meetingsSync.ts와 동일 철학(브라우저 supabase-js 직접 호출).
// 회의록(MeetingNote)은 회의(Meeting)와 독립된 생명주기를 가진다 — 다른 테이블, 다른 병합 흐름.
// 서버 라우트엔 사용자 JWT가 없어 auth.uid()=null → RLS가 막아버리므로 반드시 클라에서.
import { supabase, meetingNoteToRow, rowToMeetingNote } from '@/lib/supabase';
import type { MeetingNote } from '@/types';

const notesMigratedFlagKey = (userId: string) => `mad:notes-migrated:${userId}`;

// 본인 회의록 전체 조회. RLS가 본인 행만 반환.
export async function fetchMeetingNotes(): Promise<MeetingNote[]> {
  const { data, error } = await supabase
    .from('meeting_notes')
    .select('id,client_id,title,data,created_at,updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[notesSync] fetch error:', error.message);
    return [];
  }
  return (data || []).map(rowToMeetingNote);
}

// 회의록 1건 upsert. user_id 미포함 → DB default auth.uid() + RLS가 소유자 강제.
export async function upsertMeetingNote(note: MeetingNote): Promise<boolean> {
  const { error } = await supabase
    .from('meeting_notes')
    .upsert(meetingNoteToRow(note), { onConflict: 'user_id,client_id' });

  if (error) {
    console.error('[notesSync] upsert error:', error.message);
    return false;
  }
  return true;
}

// 회의록 1건 삭제 (client_id 기준 — 클라가 아는 id). RLS가 본인 것만 허용.
export async function deleteMeetingNoteRow(clientId: string): Promise<boolean> {
  const { error } = await supabase.from('meeting_notes').delete().eq('client_id', clientId);
  if (error) {
    console.error('[notesSync] delete error:', error.message);
    return false;
  }
  return true;
}

// 첫 로그인 시 localStorage의 회의록을 그 계정으로 1회 흡수(멱등).
// meetings 마이그레이션(mad:migrated:${userId})과 별개 플래그 — 독립 생명주기.
// 서버에 없는 로컬 회의록만 회의록단위로 upsert. 큰 페이로드 가능성(batch 금지, 1건씩).
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
    const ok = await upsertMeetingNote(note);
    if (!ok) allOk = false; // 실패해도 나머지는 계속 시도(멱등)
  }

  // 전부 성공한 경우에만 완료 플래그(부분 실패 시 다음 기회에 재시도)
  if (allOk) localStorage.setItem(notesMigratedFlagKey(userId), '1');
}

// 로컬과 서버를 합침. 같은 회의록(client_id)은 updatedAt(없으면 createdAt) 최신 쪽 채택(LWW).
// 양쪽에 없던 건 그대로 포함. 동률/불명 시 서버 우선(서버가 진실 소스).
// deletedNoteIds: 로컬에서 삭제한 회의록 id(tombstone). 서버 삭제가 지연/실패해 서버에
// 아직 남아있어도, 이 목록에 있으면 병합 결과에서 제외한다(삭제 후 부활 방지).
export function mergeMeetingNotes(
  local: MeetingNote[],
  server: MeetingNote[],
  deletedNoteIds: string[] = []
): MeetingNote[] {
  const ts = (n: MeetingNote) => {
    const t = n.updatedAt ?? n.createdAt;
    return t ? new Date(t).getTime() : 0;
  };
  const deleted = new Set(deletedNoteIds);
  const byId = new Map<string, MeetingNote>();

  for (const n of local) {
    if (deleted.has(n.id)) continue; // 로컬 삭제분은 애초에 제외
    byId.set(n.id, n);
  }
  for (const s of server) {
    if (deleted.has(s.id)) continue; // ★서버에 남아있어도 삭제된 것은 부활 안 함
    const existing = byId.get(s.id);
    if (!existing || ts(s) >= ts(existing)) {
      byId.set(s.id, s); // 서버가 같거나 최신이면 서버 채택
    }
  }
  return Array.from(byId.values());
}
