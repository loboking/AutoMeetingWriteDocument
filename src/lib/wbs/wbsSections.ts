export interface WBSSection {
  id: string;
  title: string;
  order: number;
  dependsOn?: string[];
}

export const WBS_SECTIONS: WBSSection[] = [
  { id: 'doc-info', title: '문서 정보', order: 1 },
  { id: 'overview', title: '프로젝트 개요', order: 2 },
  { id: 'hierarchy', title: 'WBS 계층 구조', order: 3, dependsOn: ['overview'] },
  { id: 'work-packages', title: '작업 상세', order: 4, dependsOn: ['hierarchy'] },
  { id: 'gantt-chart', title: '간트 차트', order: 5, dependsOn: ['work-packages'] },
  { id: 'milestones', title: '마일스톤', order: 6, dependsOn: ['work-packages'] },
  { id: 'risks', title: '리스크 관리', order: 7 },
  { id: 'resources', title: '자원 계획', order: 8, dependsOn: ['overview'] },
  { id: 'dependencies', title: '의존 관계', order: 9, dependsOn: ['work-packages'] },
];

export interface WBSChunkProgress {
  sectionId: string;
  sectionTitle: string;
  status: 'generating' | 'completed' | 'error';
  content?: string;
  error?: string;
}

export interface WBSGenerationResult {
  fullDocument: string;
  sections: Record<string, string>;
  progress: WBSChunkProgress[];
}
