// PRD 섹션 정의
export interface PRDSection {
  id: string;
  title: string;
  order: number;
  dependsOn?: string[]; // 이전 섹션 ID (컨텍스트 참조용)
  optional?: boolean; // 선택사항 여부
}

export const PRD_SECTIONS: PRDSection[] = [
  { id: 'doc-info', title: '1. 문서 정보', order: 1 },
  { id: 'overview', title: '2. 개요 (Executive Summary)', order: 2 },
  { id: 'problem', title: '3. 문제 정의 (Problem Statement)', order: 3, dependsOn: ['overview'] },
  { id: 'goals', title: '4. 목표 (Goals)', order: 4, dependsOn: ['overview', 'problem'] },
  { id: 'target-users', title: '5. 대상 사용자 (Target Users)', order: 5, dependsOn: ['overview', 'problem'] },
  { id: 'functional-req', title: '6. 기능 요구사항 (Functional Requirements)', order: 6, dependsOn: ['overview', 'problem', 'target-users'] },
  { id: 'non-functional-req', title: '7. 비기능 요구사항 (Non-functional Requirements)', order: 7, dependsOn: ['functional-req'] },
  { id: 'ui-ux', title: '8. UI/UX 가이드라인', order: 8, dependsOn: ['target-users', 'functional-req'] },
  { id: 'technical-req', title: '9. 기술 요구사항', order: 9, dependsOn: ['functional-req', 'non-functional-req'] },
  { id: 'release-plan', title: '10. 릴리스 계획', order: 10, dependsOn: ['functional-req', 'technical-req'] },
  { id: 'cost-resources', title: '11. 비용 및 리소스', order: 11, dependsOn: ['release-plan'] },
  { id: 'saas-ops', title: '12. SaaS 운영 요소', order: 12, dependsOn: ['functional-req'], optional: true },
  { id: 'risks', title: '13. 리스크 및 대응', order: 13, dependsOn: ['overview', 'release-plan'] },
  { id: 'success-criteria', title: '14. 성공 기준', order: 14, dependsOn: ['goals', 'release-plan'] },
  { id: 'appendix', title: '15. 부록', order: 15 },
];

export interface PRDChunkProgress {
  sectionId: string;
  sectionTitle: string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  content?: string;
  error?: string;
}

export interface PRDGenerationResult {
  fullDocument: string;
  sections: Record<string, string>;
  progress: PRDChunkProgress[];
}
