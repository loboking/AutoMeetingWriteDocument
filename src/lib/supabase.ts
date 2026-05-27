import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
