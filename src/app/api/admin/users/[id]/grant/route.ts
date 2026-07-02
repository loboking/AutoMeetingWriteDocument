import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 관리자 "제공(grant)" 토글 — 결제 없이 유료(무제한) 혜택 부여/해제.
// body: { grant: boolean }. 구독 행이 없으면 생성(upsert).
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }
  const { id } = await ctx.params;

  let body: { grant?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  const grant = !!body.grant;

  // 기존 구독 확인 → 있으면 update, 없으면 insert
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id,plan')
    .eq('user_id', id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ granted: grant, updated_at: new Date().toISOString() })
      .eq('user_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // 구독 없던 유저 → 제공용 행 생성(결제 아님). plan은 pro로 표기.
    const { error } = await supabaseAdmin.from('subscriptions').insert({
      user_id: id,
      plan: grant ? 'pro' : 'free',
      status: 'active',
      granted: grant,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, granted: grant });
}
