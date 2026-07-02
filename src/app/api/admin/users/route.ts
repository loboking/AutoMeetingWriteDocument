import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 가입자 목록: auth.users + 회의 수 + 구독 상태. 검색은 이메일 부분일치(클라 필터로도 가능하나 서버에서).
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('perPage') || '50', 10)));
  const q = (searchParams.get('q') || '').trim().toLowerCase();

  const { data: usersData, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  let users = usersData.users;
  if (q) users = users.filter((u) => (u.email ?? '').toLowerCase().includes(q));

  const ids = users.map((u) => u.id);

  // 회의 수(유저별) + 구독을 한 번에 가져와 메모리 집계
  const [meetingsRes, subsRes] = await Promise.all([
    supabaseAdmin.from('meetings').select('user_id').in('user_id', ids.length ? ids : ['none']),
    supabaseAdmin.from('subscriptions').select('user_id,plan,status,granted').in('user_id', ids.length ? ids : ['none']),
  ]);

  const meetingCount: Record<string, number> = {};
  for (const m of meetingsRes.data ?? []) meetingCount[m.user_id] = (meetingCount[m.user_id] ?? 0) + 1;
  const subByUser: Record<string, { plan: string; status: string; granted: boolean }> = {};
  for (const s of subsRes.data ?? []) subByUser[s.user_id] = { plan: s.plan, status: s.status, granted: !!s.granted };

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email ?? '(없음)',
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: !!(u as { banned_until?: string }).banned_until,
    meetingCount: meetingCount[u.id] ?? 0,
    plan: subByUser[u.id]?.plan ?? 'free',
    subStatus: subByUser[u.id]?.status ?? null,
    granted: subByUser[u.id]?.granted ?? false,
  }));

  return NextResponse.json({ users: rows, page, perPage, total: users.length });
}
