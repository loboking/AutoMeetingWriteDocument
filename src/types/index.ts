// 회의 상태 타입
export type MeetingStep = 'idle' | 'recording' | 'transcribing' | 'summarizing' | 'done';

// 문서 타입 (12개 기획 문서)
export type DocType =
  | 'prd'
  | 'feature-list'
  | 'screen-list'
  | 'ia'
  | 'flowchart'
  | 'wireframe'
  | 'storyboard'
  | 'user-story'
  | 'wbs'
  | 'api-spec'
  | 'test-plan'
  | 'deployment';

// 회의 데이터 타입
export interface Meeting {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt?: Date;
  duration?: number; // 초 단위
  audioUrl?: string;
  transcript?: string;
  summary?: MeetingSummary;
  step: MeetingStep;
  // 12개 기획 문서
  prd?: string;
  featureList?: string;
  screenList?: string;
  ia?: string;
  flowchart?: string;
  wireframe?: string;
  storyboard?: string;
  userStory?: string;
  wbs?: string;
  apiSpec?: string;
  testPlan?: string;
  deployment?: string;
  // 메타데이터
  isCompleted?: boolean;
  tags?: string[];
}

// 요약 결과 타입
export interface MeetingSummary {
  overview: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
}

// 액션 아이템
export interface ActionItem {
  task: string;
  assignee?: string;
  deadline?: string;
  priority?: 'high' | 'medium' | 'low';
}

// 녹음 관련 타입
export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioBlob: Blob | null;
  audioUrl: string | null;
}

// API 요청/응답 타입
export interface TranscribeRequest {
  audioFile: File;
  language?: string;
}

export interface TranscribeResponse {
  text: string;
  duration: number;
}

export interface SummarizeRequest {
  text: string;
  context?: string;
}

export interface SummarizeResponse {
  summary: MeetingSummary;
}

export interface GeneratePrdRequest {
  summary: MeetingSummary;
  meetingInfo: {
    title: string;
    date: string;
    attendees?: string[];
  };
}

export interface GeneratePrdResponse {
  prd: string;
}
