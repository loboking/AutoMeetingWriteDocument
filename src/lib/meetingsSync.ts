// meetings 테이블 동기화 헬퍼. 브라우저 supabase-js로 직접 호출(서버 라우트 X).
// 서버 라우트엔 사용자 JWT가 없어 auth.uid()=null → RLS가 막아버리므로 반드시 클라에서.
import { supabase, meetingToRow, rowToMeeting } from '@/lib/supabase';
import type { Meeting } from '@/types';

const migratedFlagKey = (userId: string) => `mad:migrated:${userId}`;

// 본인 회의 전체 조회 (목록/상세 공용). RLS가 본인 행만 반환.
export async function fetchMeetings(): Promise<Meeting[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id,client_id,title,data,created_at,updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[meetingsSync] fetch error:', error.message);
    return [];
  }
  return (data || []).map(rowToMeeting);
}

// 회의 1건 upsert. user_id 미포함 → DB default auth.uid() + RLS가 소유자 강제.
export async function upsertMeeting(meeting: Meeting): Promise<boolean> {
  const { error } = await supabase
    .from('meetings')
    .upsert(meetingToRow(meeting), { onConflict: 'user_id,client_id' });

  if (error) {
    console.error('[meetingsSync] upsert error:', error.message);
    return false;
  }
  return true;
}

// 회의 1건 삭제 (client_id 기준 — 클라가 아는 id). RLS가 본인 것만 허용.
export async function deleteMeetingRow(clientId: string): Promise<boolean> {
  const { error } = await supabase.from('meetings').delete().eq('client_id', clientId);
  if (error) {
    console.error('[meetingsSync] delete error:', error.message);
    return false;
  }
  return true;
}

// 첫 로그인 시 localStorage의 회의를 그 계정으로 1회 흡수(멱등).
// 서버에 없는 로컬 회의만 회의단위로 upsert. 13문서 큰 페이로드라 batch 금지.
// 전부 성공해야 전역 완료 플래그를 찍어, 부분 실패는 다음 로그인/tick에 재시도.
export async function migrateLocalMeetings(
  userId: string,
  localMeetings: Meeting[],
  serverMeetings: Meeting[]
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(migratedFlagKey(userId))) return; // 이미 흡수됨

  const serverClientIds = new Set(serverMeetings.map((m) => m.id));
  const toMigrate = localMeetings.filter((m) => !serverClientIds.has(m.id));

  if (toMigrate.length === 0) {
    localStorage.setItem(migratedFlagKey(userId), '1');
    return;
  }

  let allOk = true;
  for (const meeting of toMigrate) {
    const ok = await upsertMeeting(meeting);
    if (!ok) allOk = false; // 실패해도 나머지는 계속 시도(멱등)
  }

  // 전부 성공한 경우에만 완료 플래그(부분 실패 시 다음 기회에 재시도)
  if (allOk) localStorage.setItem(migratedFlagKey(userId), '1');
}

// 로컬과 서버를 합침. 같은 회의(client_id)는 updatedAt(없으면 createdAt) 최신 쪽 채택(LWW).
// 양쪽에 없던 건 그대로 포함. 동률/불명 시 서버 우선(서버가 진실 소스).
export function mergeServer(local: Meeting[], server: Meeting[]): Meeting[] {
  const ts = (m: Meeting) => {
    const t = m.updatedAt ?? m.createdAt;
    return t ? new Date(t).getTime() : 0;
  };
  const byId = new Map<string, Meeting>();

  for (const m of local) byId.set(m.id, m);
  for (const s of server) {
    const existing = byId.get(s.id);
    if (!existing || ts(s) >= ts(existing)) {
      byId.set(s.id, s); // 서버가 같거나 최신이면 서버 채택
    }
  }
  return Array.from(byId.values());
}
