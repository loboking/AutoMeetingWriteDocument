// 문서 관련 유틸리티와 상수

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

export interface Document {
  type: DocType;
  title: string;
  content: string;
  lastModified: Date;
}

export interface TreeNode {
  key: DocType;
  title: string;
  icon: string;
  description: string;
  children: TreeNode[];
  isParent: boolean;
  level?: number;
  parentKey?: string | null;
}

export const DOCUMENTS: { key: DocType; title: string; icon: string; description: string }[] = [
  { key: 'prd', title: 'PRD', icon: '📋', description: '제품 요구사항 문서' },
  { key: 'user-story', title: '시나리오 정의서', icon: '👤', description: '사용자 시나리오 정의' },
  { key: 'feature-list', title: '기능목록', icon: '📝', description: '기능 목록 정의서' },
  { key: 'screen-list', title: '화면목록', icon: '📱', description: '화면 목록 정의서' },
  { key: 'ia', title: 'IA', icon: '🗂️', description: '정보구조도' },
  { key: 'flowchart', title: '플로우차트', icon: '🔄', description: '사용자 플로우 및 프로세스' },
  { key: 'storyboard', title: '스토리보드', icon: '🎬', description: '사용자 시나리오 흐름' },
  { key: 'wireframe', title: '와이어프레임', icon: '🎨', description: '화면 설계 및 플로우' },
  { key: 'api-spec', title: 'API명세', icon: '🔌', description: 'API 인터페이스 설계' },
  { key: 'test-plan', title: '테스트계획', icon: '🧪', description: '테스트 시나리오 및 계획' },
  { key: 'test-case', title: '테스트케이스', icon: '✅', description: '상세 테스트 케이스 목록' },
  { key: 'database', title: 'DB설계', icon: '🗄️', description: '데이터베이스 스키마 및 ERD' },
  { key: 'wbs', title: 'WBS', icon: '📊', description: '작업 분류 구조' },
  { key: 'deployment', title: '배포가이드', icon: '🚀', description: '릴리스 및 배포 절차' },
];

// 문서 의존성 정의
export const DEPENDENCIES: Record<DocType, DocType[]> = {
  'prd': [],
  'user-story': [],
  'feature-list': [],
  'flowchart': [],
  'screen-list': ['feature-list'],
  'ia': ['screen-list'],
  'storyboard': ['flowchart'],
  'wireframe': ['ia', 'screen-list'],
  'api-spec': ['feature-list'],
  'test-plan': ['feature-list', 'api-spec'],
  'test-case': ['feature-list', 'api-spec', 'test-plan'],
  'database': ['feature-list', 'api-spec'],
  'wbs': ['feature-list', 'api-spec', 'wireframe'],
  'deployment': ['prd', 'feature-list', 'api-spec'],
};

// 문서 트리 구조
export const DOCUMENT_TREE: TreeNode[] = [
  {
    key: 'prd',
    title: 'PRD',
    icon: '📋',
    description: '제품 요구사항 문서',
    isParent: true,
    children: [],
  },
  {
    key: 'user-story',
    title: '시나리오 정의서',
    icon: '👤',
    description: '사용자 시나리오 정의',
    isParent: true,
    children: [],
  },
  {
    key: 'feature-list',
    title: '기능목록',
    icon: '📝',
    description: '기능 목록 정의서',
    isParent: true,
    children: [
      {
        key: 'screen-list',
        title: '화면목록',
        icon: '📱',
        description: '화면 목록 정의서',
        isParent: true,
        children: [
          {
            key: 'ia',
            title: 'IA',
            icon: '🗂️',
            description: '정보구조도',
            isParent: true,
            children: [],
          },
        ],
      },
      {
        key: 'database',
        title: 'DB설계',
        icon: '🗄️',
        description: '데이터베이스 스키마 및 ERD',
        isParent: true,
        children: [],
      },
      {
        key: 'api-spec',
        title: 'API명세',
        icon: '🔌',
        description: 'API 인터페이스 설계',
        isParent: true,
        children: [
          {
            key: 'test-plan',
            title: '테스트계획',
            icon: '🧪',
            description: '테스트 시나리오 및 계획',
            isParent: true,
            children: [],
          },
        ],
      },
      {
        key: 'flowchart',
        title: '플로우차트',
        icon: '🔄',
        description: '사용자 플로우 및 프로세스',
        isParent: true,
        children: [
          {
            key: 'storyboard',
            title: '스토리보드',
            icon: '🎬',
            description: '사용자 시나리오 흐름',
            isParent: true,
            children: [],
          },
        ],
      },
      {
        key: 'wireframe',
        title: '와이어프레임',
        icon: '🎨',
        description: '화면 설계 및 플로우',
        isParent: true,
        children: [
          {
            key: 'wbs',
            title: 'WBS',
            icon: '📊',
            description: '작업 분류 구조',
            isParent: true,
            children: [],
          },
        ],
      },
    ],
  },
  {
    key: 'deployment',
    title: '배포가이드',
    icon: '🚀',
    description: '릴리스 및 배포 절차',
    isParent: true,
    children: [],
  },
];

// 유틸리티 함수

export function extractMermaidCode(content: string): string {
  const codeBlockMatch = content.match(/```mermaid\n([\s\S]+?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const trimmedContent = content.trim();
  const hasMermaidKeyword = /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/i.test(trimmedContent);

  if (hasMermaidKeyword) {
    const lines = trimmedContent.split('\n');
    const startIdx = lines.findIndex(line => /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/i.test(line));
    if (startIdx >= 0) {
      return lines.slice(startIdx).join('\n').trim();
    }
    return trimmedContent;
  }

  return '';
}

export function docTypeToField(docType: string): string {
  const mapping: Record<string, string> = {
    'feature-list': 'featureList',
    'screen-list': 'screenList',
    'user-story': 'userStory',
    'api-spec': 'apiSpec',
    'test-plan': 'testPlan',
  };
  return mapping[docType] || docType;
}

export function canGenerateDoc(
  docType: DocType,
  documents: Record<DocType, string>
): { canGenerate: boolean; missing: DocType[] } {
  const deps = DEPENDENCIES[docType] || [];
  const missing = deps.filter(dep => !documents[dep]);

  return {
    canGenerate: missing.length === 0,
    missing,
  };
}

export function getDependencyNames(docType: DocType): string[] {
  const deps = DEPENDENCIES[docType] || [];
  return deps.map(dep => DOCUMENTS.find(d => d.key === dep)?.title || dep);
}

export function getAllParentKeys(): string[] {
  const parentKeys: string[] = [];
  const traverse = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.isParent || node.children.length > 0) {
        parentKeys.push(node.key);
        traverse(node.children);
      }
    }
  };
  traverse(DOCUMENT_TREE);
  return parentKeys;
}

export function flattenTree(nodes: TreeNode[], parentKey: string | null = null): Array<TreeNode & { level: number; parentKey: string | null }> {
  const result: Array<TreeNode & { level: number; parentKey: string | null }> = [];

  for (const node of nodes) {
    result.push({ ...node, level: parentKey === null ? 0 : 1, parentKey });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, node.key).map(n => ({ ...n, level: (parentKey === null ? 0 : 1) + 1, parentKey: node.key })));
    }
  }

  return result;
}

export const FLAT_DOCUMENTS = flattenTree(DOCUMENT_TREE);
