import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

// 특정 회의의 본문(문서/요약/전사록) 조회 — 관리자 전용.
// ⚠️ 개인정보 민감: 회의 본문 전체를 반환한다. 지금은 "테스트 단계"라 열어둠.
//    프로덕션 전환 시엔 (사용자 동의 + 감사 로그) 또는 이 라우트 비활성화 검토 필요.
//    ADMIN_VIEW_CONTENT=false 로 끄면 메타만 반환(안전 스위치).
const ALLOW_CONTENT = process.env.ADMIN_VIEW_CONTENT !== 'false';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'service_role 키가 설정되지 않았습니다.' }, { status: 503 });
  }
  const { id } = await ctx.params; // client_id (= 클라 회의 id)

  const { data, error } = await supabaseAdmin
    .from('meetings')
    .select('client_id,title,user_id,data,created_at,updated_at')
    .eq('client_id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: '회의를 찾을 수 없습니다.' }, { status: 404 });

  if (!ALLOW_CONTENT) {
    // 안전 스위치 ON: 본문 제외, 메타만
    return NextResponse.json({
      clientId: data.client_id, title: data.title, userId: data.user_id,
      createdAt: data.created_at, updatedAt: data.updated_at, contentDisabled: true,
    });
  }

  return NextResponse.json({
    clientId: data.client_id,
    title: data.title,
    userId: data.user_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    data: data.data, // Meeting 본문 전체(14종 문서+summary+transcript)
  });
}
