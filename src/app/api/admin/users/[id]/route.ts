import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 사용자 상세: 기본정보 + 구독 + 회의 목록 + 사용량(회의 건수) + 토큰 원가.
// ⚠️ 개인정보: meetings.data(전사본/문서 본문)는 반환하지 않는다(제목/메타만).
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }
  const { id } = await ctx.params;

  const [userRes, meetingsRes, subRes, usageRes, tokenRes] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(id),
    // 본문(data) 제외 — 개인정보 보호. 목록 메타만.
    supabaseAdmin.from('meetings').select('id,client_id,title,created_at,updated_at').eq('user_id', id).order('created_at', { ascending: false }),
    supabaseAdmin.from('subscriptions').select('*').eq('user_id', id).maybeSingle(),
    supabaseAdmin.from('usage_events').select('period').eq('user_id', id),
    supabaseAdmin.from('token_usage').select('op,input_tokens,output_tokens,total_tokens,period').eq('user_id', id),
  ]);

  if (userRes.error || !userRes.data?.user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }
  const u = userRes.data.user;

  // 사용량: period별 회의 건수
  const usageByPeriod: Record<string, number> = {};
  for (const e of usageRes.data ?? []) usageByPeriod[e.period] = (usageByPeriod[e.period] ?? 0) + 1;

  // 토큰: op별 집계
  const tokens = tokenRes.data ?? [];
  const tokenByOp: Record<string, { calls: number; input: number; output: number }> = {};
  for (const t of tokens) {
    const k = t.op;
    if (!tokenByOp[k]) tokenByOp[k] = { calls: 0, input: 0, output: 0 };
    tokenByOp[k].calls++;
    tokenByOp[k].input += t.input_tokens ?? 0;
    tokenByOp[k].output += t.output_tokens ?? 0;
  }
  const tokenTotal = tokens.reduce((s, t) => s + (t.total_tokens ?? 0), 0);

  return NextResponse.json({
    user: {
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned: !!(u as { banned_until?: string }).banned_until,
    },
    subscription: subRes.data ?? null,
    meetings: meetingsRes.data ?? [],
    usageByPeriod,
    tokens: { total: tokenTotal, byOp: tokenByOp, calls: tokens.length },
  });
}
