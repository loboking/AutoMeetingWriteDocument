import type { TranscriptSegment } from '@/lib/stt/types';
export type { TranscriptSegment } from '@/lib/stt/types';

// 회의 상태 타입
export type MeetingStep = 'idle' | 'recording' | 'transcribing' | 'summarizing' | 'done';

// 문서 상태 타입
export type DocStatus = 'latest' | 'outdated' | 'frozen' | 'regenerating';

// 문서 버전 정보
export interface DocVersionInfo {
  version: number;
  lastModified: Date;
  contentHash?: string;
}

// 문서 버전 스냅샷 (히스토리/복원용). 문서 내용이 바뀔 때 이전 값을 1건씩 기록.
export type DocVersionSource =
  | 'generated' // AI 최초 생성/재생성
  | 'manual-edit' // 사용자 직접 편집 저장
  | 'ai-edit' // 채팅 도우미 수정 적용
  | 'restored'; // 과거 버전으로 복원

export interface DocVersion {
  id: string;
  docType: DocType;
  content: string; // 스냅샷 시점의 문서 전체 마크다운
  createdAt: Date;
  source: DocVersionSource;
  note?: string; // ai-edit 시 사용자 지시문, restored 시 원본 버전 시각 등
}

// 문서 타입 (14개 기획 문서)
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
  | 'test-case'
  | 'database'
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
  transcriptSegments?: TranscriptSegment[]; // 화자분리/타임스탬프 (옵셔널, 기존 transcript와 병행)
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
  testCase?: string;
  database?: string;
  deployment?: string;
  // 메타데이터
  isCompleted?: boolean;
  tags?: string[];
  // 학습 완료 추적
  completedDocs?: DocType[];
  autoAdvance?: boolean; // 자동 넘김 설정
  // 문서 버전 히스토리 (문서별 최근 N개만 유지, jsonb data에 함께 영속화)
  docVersions?: DocVersion[];
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

// ===== 회의록 메타데이터 (Stage 1: 핵심 제약조건 추출) =====
export type TeamSizeType = '1인' | '2-5인' | '6-10인' | '11인 이상';
export type BudgetType = '무료' | '자체' | '투자';
export type MetadataConfidence = 'high' | 'medium' | 'low';

// 비즈니스 콘셉트 유형 — KPI/비용 지표 분기 기준
export type ConceptType = 'commerce' | 'saas' | 'web' | 'marketplace' | 'community';

export interface MeetingMetadata {
  teamSize: number;
  teamSizeType: TeamSizeType;
  budgetType: BudgetType;
  estimatedBudget?: string;
  isSaaS: boolean;
  hasPayment: boolean;
  targetUsersCount: number;
  hasMobileApp: boolean;
  hasDatabase: boolean;
  hasAuth: boolean;
  confidence: MetadataConfidence;
  // 콘셉트 유형 (KPI 분기용). 미설정 시 isSaaS로 추론
  conceptType?: ConceptType;
  // 회의에서 추출된 핵심 수치 단일 출처 (예: { '영상 원가': '45원', '배송비': '2500원' })
  coreMetrics?: Record<string, string>;
  // 다뤄야 할 컴플라이언스 리스크 (예: ['플랫폼 약관', '개인정보보호', '세관/통관'])
  complianceRisks?: string[];
}

// ===== PRD 동적 파싱 메타데이터 =====
export interface Persona {
  id: string;
  name: string;
  occupation: string;
  goals: string[];
  painPoints: string[];
  age?: string;
  techLevel?: string;
  quote?: string;
}

export interface FunctionalRequirement {
  id: string;
  name: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
}

export interface PerformanceConstraints {
  pageLoadTimeMs?: number;
  apiResponseTimeMs?: number;
  concurrentUsers?: number;
  availability?: string;
  sessionTimeoutMinutes?: number;
}

export interface PRDMetadata {
  personas: Persona[];
  functionalRequirements: FunctionalRequirement[];
  performanceConstraints: PerformanceConstraints;
  isOnePersonBusiness: boolean;
  isParsed: boolean;
}
