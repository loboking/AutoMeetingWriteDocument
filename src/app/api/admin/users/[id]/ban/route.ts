import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 사용자 차단/해제(soft, 복구 가능). body: { ban: boolean }
// ban=true면 100년(사실상 영구), false면 'none'으로 해제.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }
  const { id } = await ctx.params;

  let body: { ban?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  // 자기 자신 차단 방지
  if (id === auth.user.id) {
    return NextResponse.json({ error: '본인 계정은 차단할 수 없습니다.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: body.ban ? '876000h' : 'none', // 876000h ≈ 100년
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, banned: !!body.ban });
}
