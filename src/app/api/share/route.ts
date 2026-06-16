import { NextRequest, NextResponse } from 'next/server';
import { supabase, meetingToSupabase, supabaseToMeeting } from '@/lib/supabase';

export const runtime = 'nodejs';

// POST: 새로운 공유 문서 생성 (로그인 사용자만)
export async function POST(request: NextRequest) {
  try {
    // 인증 확인: 로그인 사용자의 토큰이 있어야 공유 생성 가능 (무인증 쓰기 차단)
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 });
    }

    const meeting = await request.json();

    if (!meeting.id || !meeting.title) {
      return NextResponse.json(
        { error: 'meeting.id와 meeting.title이 필요합니다.' },
        { status: 400 }
      );
    }

    const supabaseData = meetingToSupabase(meeting);

    const { data, error } = await supabase
      .from('documents')
      .insert(supabaseData)
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: '문서 저장에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: data.id,
      shareUrl: `/shared/${data.id}`,
    });
  } catch (error) {
    console.error('Share API error:', error);
    return NextResponse.json(
      { error: '공유 링크 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// GET: 공유 문서 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '문서 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .eq('is_public', true)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: '문서를 찾을 수 없거나 접근 권한이 없습니다.' },
        { status: 404 }
      );
    }

    const meeting = supabaseToMeeting(data);
    return NextResponse.json({ meeting });
  } catch (error) {
    console.error('Get shared document error:', error);
    return NextResponse.json(
      { error: '문서 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
