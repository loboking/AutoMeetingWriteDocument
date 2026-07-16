import type { TranscriptSegment } from '@/lib/stt/types';
export type { TranscriptSegment } from '@/lib/stt/types';

// 회의 상태 타입
export type MeetingStep = 'idle' | 'recording' | 'transcribing' | 'summarizing' | 'done';

// 문서 상태 타입
// 'partial': 청킹 일부 섹션 생성 실패 — 내용은 있으나 미완성(재생성 권장)
// 'pending': 본문 없음(아직 생성 안 됨) — composite에서 핵심 3개 완료 후 나머지 11개에만 세팅.
//   single 모드에는 쓰이지 않는다(회귀 0). UI는 partial(다시 만들기)과 분리해 "만들기" CTA를 띄운다.
export type DocStatus = 'latest' | 'outdated' | 'frozen' | 'regenerating' | 'partial' | 'pending';

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

// 프로젝트 모드: single(단일회의 자동래핑) | composite(다회의 합성)
export type ProjectMode = 'single' | 'composite';

// Project: 회의(단일/합성) 단위의 문서 생성 컨테이너.
// - single: 기존 회의 흐름 유지. Project.id === Meeting.id 자동 래핑.
// - composite: 여러 회의 요약을 합성해 하나의 문서세트를 만든다.
// documents는 kebab-case DocType 리터럴 키(docTypeToField로 flat 카멜과 호환).
// 도현 확정 스키마 — 도이 DDL 완성 시 정합.
export interface Project {
  id: string;
  title: string;
  mode: ProjectMode;
  // single: [Meeting.id] / composite: 합성에 쓰인 MeetingNote.id들 (회의록 모드 독립 산출)
  sourceNoteIds: string[];
  masterSummary?: MeetingSummary; // composite: 합성 요약 / single: meeting.summary와 동일
  documents: Partial<Record<DocType, string>>; // kebab-case DocType 키
  completedDocs: DocType[];
  docVersions: DocVersion[];
  createdAt: Date;
  updatedAt?: Date;
}

// 회의록(① 회의록 모드의 독립 산출).
// Meeting(② 기획서 입력, Project 자동 래핑)과 분리 — 14문서 필드/Project FK 없이 가벼운 산출.
// 합성(③) 시 Project(composite).sourceNoteIds가 MeetingNote.id들을 참조한다.
// source: recording(녹음 STT) / text(직접 타이핑) / file(오디오 파일 업로드)
export interface MeetingNote {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt?: Date;
  transcript: string;
  transcriptSegments?: TranscriptSegment[]; // 화자 라벨(Gemini 오디오 STT)
  summary: MeetingSummary;
  audioUrl?: string;
  duration?: number; // 초 단위
  tags?: string[];
  source?: 'recording' | 'text' | 'file';
}

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
