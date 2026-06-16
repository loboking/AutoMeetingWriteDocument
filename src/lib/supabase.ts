import { createClient } from '@supabase/supabase-js';
import type { Meeting } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 브라우저 Auth: 세션을 localStorage에 저장하고 자동 갱신.
// detectSessionInUrl은 매직링크/소셜용인데 MVP는 비번 로그인이라 끔.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Meeting 타입을 Supabase 형식으로 변환
export function meetingToSupabase(meeting: any) {
  return {
    title: meeting.title,
    content: { id: meeting.id, createdAt: meeting.createdAt },
    summary: meeting.summary,
    transcript: meeting.transcript,
    prd: meeting.prd,
    feature_list: meeting.featureList,
    screen_list: meeting.screenList,
    ia: meeting.ia,
    flowchart: meeting.flowchart,
    wireframe: meeting.wireframe,
    storyboard: meeting.storyboard,
    user_story: meeting.userStory,
    wbs: meeting.wbs,
    api_spec: meeting.apiSpec,
    test_plan: meeting.testPlan,
    test_case: meeting.testCase,
    database: meeting.database,
    deployment: meeting.deployment,
    tags: meeting.tags || [],
    is_public: true,
  };
}

// Supabase 데이터를 Meeting 형식으로 변환
export function supabaseToMeeting(doc: any) {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.created_at,
    summary: doc.summary,
    transcript: doc.transcript,
    prd: doc.prd,
    featureList: doc.feature_list,
    screenList: doc.screen_list,
    ia: doc.ia,
    flowchart: doc.flowchart,
    wireframe: doc.wireframe,
    storyboard: doc.storyboard,
    userStory: doc.user_story,
    wbs: doc.wbs,
    apiSpec: doc.api_spec,
    testPlan: doc.test_plan,
    testCase: doc.test_case,
    database: doc.database,
    deployment: doc.deployment,
  };
}

// ── meetings 테이블(로그인 사용자별 비공개) 전용 변환 ──
// 본문 전체를 jsonb data 컬럼에 통째로 보관. user_id는 절대 포함하지 않음(DB default auth.uid()가 채움).
export interface MeetingRow {
  id: string;
  client_id: string;
  title: string;
  data: Meeting;
  created_at: string;
  updated_at: string;
}

export function meetingToRow(meeting: Meeting): { client_id: string; title: string; data: Meeting } {
  return {
    client_id: meeting.id, // 클라가 가진 회의 id를 멱등 흡수 키로 보존
    title: meeting.title || '',
    data: meeting,
  };
}

export function rowToMeeting(row: Pick<MeetingRow, 'client_id' | 'data' | 'updated_at'>): Meeting {
  return {
    ...row.data,
    id: row.data?.id ?? row.client_id,
    updatedAt: new Date(row.updated_at),
  };
}
