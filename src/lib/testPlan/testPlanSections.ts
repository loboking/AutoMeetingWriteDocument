export interface TestPlanSection {
  id: string;
  title: string;
  order: number;
  dependsOn?: string[];
}

export const TESTPLAN_SECTIONS: TestPlanSection[] = [
  { id: 'doc-info', title: '문서 정보', order: 1 },
  { id: 'overview', title: '테스트 개요', order: 2 },
  { id: 'strategy', title: '테스트 전략', order: 3 },
  { id: 'scope', title: '테스트 범위', order: 4, dependsOn: ['overview'] },
  { id: 'environment', title: '테스트 환경', order: 5 },
  { id: 'schedule', title: '테스트 일정', order: 6, dependsOn: ['scope'] },
  { id: 'entry-exit-criteria', title: '입수/퇴수 기준', order: 7 },
  { id: 'risks', title: '리스크 관리', order: 8 },
  { id: 'defect-management', title: '결함 관리', order: 9 },
];

export interface TestPlanChunkProgress {
  sectionId: string;
  sectionTitle: string;
  status: 'generating' | 'completed' | 'error';
  content?: string;
  error?: string;
}

export interface TestPlanGenerationResult {
  fullDocument: string;
  sections: Record<string, string>;
  progress: TestPlanChunkProgress[];
}
