export interface DeploymentSection {
  id: string;
  title: string;
  order: number;
  dependsOn?: string[];
}

export const DEPLOYMENT_SECTIONS: DeploymentSection[] = [
  { id: 'doc-info', title: '문서 정보', order: 1 },
  { id: 'environment', title: '배포 환경', order: 2 },
  { id: 'prerequisites', title: '사전 요구사항', order: 3 },
  { id: 'env-vars', title: '환경 변수', order: 4 },
  { id: 'build', title: '빌드 절차', order: 5 },
  { id: 'deployment', title: '배포 절차', order: 6, dependsOn: ['environment'] },
  { id: 'rollback', title: '롤백 절차', order: 7 },
  { id: 'monitoring', title: '모니터링', order: 8 },
  { id: 'security', title: '보안 설정', order: 9 },
];

export interface DeploymentChunkProgress {
  sectionId: string;
  sectionTitle: string;
  status: 'generating' | 'completed' | 'error';
  content?: string;
  error?: string;
}

export interface DeploymentGenerationResult {
  fullDocument: string;
  sections: Record<string, string>;
  progress: DeploymentChunkProgress[];
}
