'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Download, Copy, Check, Loader2, Plus, Edit, Save, Eye, File, Code, BookOpen, Presentation, Printer, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Folder, Terminal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PptxGenJS from 'pptxgenjs';
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useMeetingStore } from '@/store/meetingStore';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { ScreenDiagram, StoryboardViewer } from '@/components/ScreenDiagram';
import { TestPlanViewer } from '@/components/TestPlanViewer';
import { WBSViewer } from '@/components/WBSViewer';
import { InAppTerminal } from '@/components/InAppTerminal';
import { CommandPanel } from '@/components/CommandPanel';

// 마크다운에서 mermaid 코드 추출
function extractMermaidCode(content: string): string {
  // 먼저 ```mermaid 블록 추출 시도
  const codeBlockMatch = content.match(/```mermaid\n([\s\S]+?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 블록이 없으면 전체 텍스트가 mermaid인지 확인 후 반환
  const trimmedContent = content.trim();
  const hasMermaidKeyword = /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/i.test(trimmedContent);

  if (hasMermaidKeyword) {
    // mermaid 키워드부터 시작하는 부분만 추출
    const lines = trimmedContent.split('\n');
    const startIdx = lines.findIndex(line => /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap)\b/i.test(line));
    if (startIdx >= 0) {
      return lines.slice(startIdx).join('\n').trim();
    }
    return trimmedContent;
  }

  return ''; // mermaid 코드 없음
}

// DocType을 Meeting 필드 이름으로 변환
function docTypeToField(docType: string): string {
  const mapping: Record<string, string> = {
    'feature-list': 'featureList',
    'screen-list': 'screenList',
    'user-story': 'userStory',
    'api-spec': 'apiSpec',
    'test-plan': 'testPlan',
  };
  return mapping[docType] || docType;
}

type DocType =
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

interface Document {
  type: DocType;
  title: string;
  content: string;
  lastModified: Date;
}

const DOCUMENTS: { key: DocType; title: string; icon: string; description: string }[] = [
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
const DEPENDENCIES: Record<DocType, DocType[]> = {
  'prd': [], // 기반 문서
  'user-story': [], // 기반 문서
  'feature-list': [], // 기반 문서
  'screen-list': ['feature-list'], // 기능목록 필요
  'ia': ['screen-list'], // 화면목록 필요
  'flowchart': ['user-story', 'screen-list'], // 시나리오 또는 화면목록 필요
  'storyboard': ['user-story', 'flowchart'], // 시나리오, 플로우차트 필요
  'wireframe': ['ia', 'screen-list'], // IA, 화면목록 필요
  'api-spec': ['feature-list'], // 기능목록 필요
  'test-plan': ['feature-list', 'api-spec'], // 기능목록, API명세 필요
  'test-case': ['feature-list', 'api-spec', 'test-plan'], // 기능목록, API명세, 테스트계획 필요
  'database': ['feature-list', 'api-spec'], // 기능목록, API명세 필요
  'wbs': ['feature-list', 'api-spec', 'wireframe'], // 기능목록, API명세, 와이어프레임 필요
  'deployment': ['prd', 'feature-list', 'api-spec'], // PRD, 기능목록, API명세 필요
};

// 의존성 체크
function canGenerateDoc(
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

// 의존성 문서 이름 가져오기
function getDependencyNames(docType: DocType): string[] {
  const deps = DEPENDENCIES[docType] || [];
  return deps.map(dep => DOCUMENTS.find(d => d.key === dep)?.title || dep);
}

// 트리 구조 정의
interface TreeNode {
  key: DocType;
  title: string;
  icon: string;
  description: string;
  children: TreeNode[];
  isParent: boolean;
}

// 문서 트리 구조 생성
const DOCUMENT_TREE: TreeNode[] = [
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

// 트리를 평탄화하는 함수 (탭 렌더링용)
function flattenTree(nodes: TreeNode[], parentKey: string | null = null): Array<TreeNode & { level: number; parentKey: string | null }> {
  const result: Array<TreeNode & { level: number; parentKey: string | null }> = [];

  for (const node of nodes) {
    result.push({ ...node, level: parentKey === null ? 0 : 1, parentKey });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, node.key).map(n => ({ ...n, level: (parentKey === null ? 0 : 1) + 1, parentKey: node.key })));
    }
  }

  return result;
}

const FLAT_DOCUMENTS = flattenTree(DOCUMENT_TREE);

export function PrdViewer() {
  const { currentMeeting, updateCurrentMeeting } = useMeetingStore();
  const [activeDoc, setActiveDoc] = useState<DocType>('prd');

  // currentMeeting에서 문서들을 초기화
  const getDocumentsFromMeeting = (): Record<DocType, string> => ({
    prd: currentMeeting?.prd || '',
    'feature-list': currentMeeting?.featureList || '',
    'screen-list': currentMeeting?.screenList || '',
    ia: currentMeeting?.ia || '',
    flowchart: currentMeeting?.flowchart || '',
    wireframe: currentMeeting?.wireframe || '',
    storyboard: currentMeeting?.storyboard || '',
    'user-story': currentMeeting?.userStory || '',
    wbs: currentMeeting?.wbs || '',
    'api-spec': currentMeeting?.apiSpec || '',
    'test-plan': currentMeeting?.testPlan || '',
    'test-case': currentMeeting?.testCase || '',
    database: currentMeeting?.database || '',
    deployment: currentMeeting?.deployment || '',
  });

  const [documents, setDocuments] = useState<Record<DocType, string>>(getDocumentsFromMeeting);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [generateConfirmData, setGenerateConfirmData] = useState<{ count: number; isRegenerate: boolean; docsToRegenerate: DocType[] } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['prd'])); // 모든 상위 노드 기본 펼침
  const [editedContent, setEditedContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'raw' | 'preview' | 'visual' | 'terminal'>('visual'); // 기본을 시각화로 변경
  const [terminalCommands, setTerminalCommands] = useState<string[]>([]);
  const treeRef = useRef<HTMLDivElement>(null);

  // currentMeeting 변경 시 documents 동기화
  useEffect(() => {
    setDocuments(getDocumentsFromMeeting());
  }, [currentMeeting]);

  // 컴포넌트 마운트 시 강제 스크롤 리셋 (항상 PRD가 최상단에 보이도록)
  useEffect(() => {
    const forceScrollToTop = () => {
      if (treeRef.current) {
        treeRef.current.scrollTop = 0;
        // requestAnimationFrame으로 다시 시도
        requestAnimationFrame(() => {
          if (treeRef.current) {
            treeRef.current.scrollTop = 0;
          }
        });
      }
    };
    
    // 즉시 실행 + 여러 지연 타이밍에서 재시도
    forceScrollToTop();
    const timeouts = [50, 100, 200, 300].map(delay => 
      setTimeout(forceScrollToTop, delay)
    );
    
    return () => timeouts.forEach(clearTimeout);
  }, []);

  // currentMeeting 또는 activeDoc 변경 시 스크롤 리셋
  useEffect(() => {
    if (treeRef.current) {
      treeRef.current.scrollTop = 0;
      requestAnimationFrame(() => {
        if (treeRef.current) {
          treeRef.current.scrollTop = 0;
        }
      });
    }
  }, [currentMeeting, activeDoc]);


  const handleGenerateDoc = async (docType: DocType) => {
    if (!currentMeeting?.summary) {
      alert('먼저 요약을 생성해주세요.');
      return;
    }

    // 의존성 체크
    const { canGenerate, missing } = canGenerateDoc(docType, documents);
    if (!canGenerate) {
      const missingNames = missing.map(dep => DOCUMENTS.find(d => d.key === dep)?.title || dep).join(', ');
      alert(`먼저 다음 문서를 생성해주세요:\n\n${missingNames}`);
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          summary: currentMeeting.summary,
          transcript: currentMeeting.transcript,
          meetingInfo: {
            title: currentMeeting.title,
            date: new Date(currentMeeting.createdAt).toLocaleDateString('ko-KR'),
          },
        }),
      });

      if (!response.ok) throw new Error('문서 생성 실패');

      const { content } = await response.json();
      setDocuments(prev => ({ ...prev, [docType]: content }));
      updateCurrentMeeting({ [docTypeToField(docType)]: content });
    } catch (error) {
      console.error('Doc generation error:', error);
      // 에러는 UI에서 자연스럽게 처리 (버튼 상태 등)
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAll = async () => {
    if (!currentMeeting?.summary) {
      setShowGenerateConfirm(true);
      setGenerateConfirmData({
        count: 0,
        isRegenerate: false,
        docsToRegenerate: []
      });
      return;
    }

    // 의존성이 충족된 문서만 필터링
    const availableDocs = DOCUMENTS.filter(doc => {
      const { canGenerate } = canGenerateDoc(doc.key, documents);
      return canGenerate || documents[doc.key]; // 이미 생성된 것도 포함
    });

    const docsToGenerate = availableDocs.filter(doc => !documents[doc.key]);
    const toGenerateCount = docsToGenerate.length;

    // 모든 문서가 이미 생성된 경우 - 재생성 확인
    if (toGenerateCount === 0) {
      const allDocTypes = availableDocs.map(d => d.key) as DocType[];
      setShowGenerateConfirm(true);
      setGenerateConfirmData({
        count: allDocTypes.length,
        isRegenerate: true,
        docsToRegenerate: allDocTypes
      });
      return;
    }

    // 일부만 생성된 경우 - 일반 생성 확인
    setShowGenerateConfirm(true);
    setGenerateConfirmData({
      count: toGenerateCount,
      isRegenerate: false,
      docsToRegenerate: docsToGenerate.map(d => d.key)
    });
  };

  const confirmGenerateAll = async () => {
    setShowGenerateConfirm(false);
    if (!generateConfirmData || !currentMeeting?.summary) return;

    const { isRegenerate, docsToRegenerate } = generateConfirmData;

    // 재생성인 경우: docsToRegenerate 사용
    // 일반 생성인 경우: docsToGenerate 로직 재사용
    let docsToGenerate: typeof DOCUMENTS;

    if (isRegenerate) {
      docsToGenerate = DOCUMENTS.filter(doc => docsToRegenerate.includes(doc.key as DocType));
    } else {
      docsToGenerate = DOCUMENTS.filter(doc => {
        const { canGenerate } = canGenerateDoc(doc.key, documents);
        return canGenerate && !documents[doc.key];
      });
    }

    setIsGenerating(true);
    const results: Record<DocType, string> = { ...documents };

    const generatePromises = docsToGenerate.map(async (doc) => {
      const docType = doc.key;
      try {
        const response = await fetch('/api/generate-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docType,
            summary: currentMeeting.summary,
            transcript: currentMeeting.transcript,
            meetingInfo: {
              title: currentMeeting.title,
              date: new Date(currentMeeting.createdAt).toLocaleDateString('ko-KR'),
            },
          }),
        });

        if (response.ok) {
          const { content } = await response.json();
          results[docType] = content;
          updateCurrentMeeting({ [docTypeToField(docType)]: content });
          return { success: true, docType };
        }
        return { success: false, docType, error: 'Response not ok' };
      } catch (error) {
        console.error(`${docType} 생성 실패:`, error);
        return { success: false, docType, error };
      }
    });

    const outcomes = await Promise.allSettled(generatePromises);
    const successCount = outcomes.filter(o => o.status === 'fulfilled' && o.value.success).length;
    const failCount = outcomes.length - successCount;

    setDocuments(results);
    setIsGenerating(false);
    setGenerateConfirmData(null);
  };


  const handleDownloadAll = () => {
    if (!currentMeeting) return;

    const generatedDocs = DOCUMENTS.filter(doc => documents[doc.key]);

    if (generatedDocs.length === 0) {
      return; // 문서 없으면 조용히 종료
    }

    const safeTitle = currentMeeting.title.replace(/\s+/g, '-');
    const timestamp = new Date().toISOString().slice(0, 10);

    let combinedContent = `# ${currentMeeting.title} - 전체 기획 문서\n\n`;
    combinedContent += `> 생성일: ${new Date(currentMeeting.createdAt).toLocaleDateString('ko-KR')}\n`;
    combinedContent += `> 내보내기일: ${new Date().toLocaleDateString('ko-KR')}\n\n`;
    combinedContent += `---\n\n`;

    generatedDocs.forEach((doc) => {
      const docContent = documents[doc.key];
      if (docContent) {
        combinedContent += `\n\n## ${doc.title}\n\n`;
        combinedContent += docContent;
        combinedContent += '\n\n---\n\n';
      }
    });

    const blob = new Blob([combinedContent], { type: 'text/markdown' });
    saveAs(blob, `${safeTitle}-전체문서-${timestamp}.md`);
  };

  const handleSaveEdit = () => {
    setDocuments(prev => ({ ...prev, [activeDoc]: editedContent }));
    updateCurrentMeeting({ [docTypeToField(activeDoc)]: editedContent });
    setIsEditing(false);
  };

  // 트리 노드 토글
  const toggleNode = (key: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // 트리에서 문서 찾기
  const findNodeInTree = (nodes: TreeNode[], key: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.key === key) return node;
      if (node.children.length > 0) {
        const found = findNodeInTree(node.children, key);
        if (found) return found;
      }
    }
    return null;
  };

  const currentContent = documents[activeDoc] || '';
  const hasContent = !!currentContent;
  const doc = findNodeInTree(DOCUMENT_TREE, activeDoc) || DOCUMENTS.find(d => d.key === activeDoc);
  const flatIndex = FLAT_DOCUMENTS.findIndex(d => d.key === activeDoc);

  // 트리에서 보여질 노드 목록 생성 (펼쳐진 노드만 포함)
  const getVisibleNodes = (): Array<{ node: TreeNode; level: number }> => {
    const result: Array<{ node: TreeNode; level: number }> = [];

    const traverse = (nodes: TreeNode[], level: number = 0) => {
      for (const node of nodes) {
        result.push({ node, level });
        // 펼쳐져 있으면 자식들도 추가
        if (node.children.length > 0 && expandedNodes.has(node.key)) {
          traverse(node.children, level + 1);
        }
      }
    };

    traverse(DOCUMENT_TREE);
    return result;
  };

  const visibleNodes = getVisibleNodes();

  // 문서 네비게이션
  const handlePreviousDoc = () => {
    if (flatIndex > 0) {
      setActiveDoc(FLAT_DOCUMENTS[flatIndex - 1].key);
    }
  };

  const handleNextDoc = () => {
    if (flatIndex < FLAT_DOCUMENTS.length - 1) {
      setActiveDoc(FLAT_DOCUMENTS[flatIndex + 1].key);
    }
  };

  const handleCopy = async () => {
    if (!currentContent) return;
    await navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 페이지 이탈 방지
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 문서 생성 중이거나 편집 중이면 경고
      if (isGenerating || isEditing) {
        const message = isGenerating
          ? '문서 생성 중입니다. 페이지를 나가시면 생성이 취소됩니다.'
          : '편집 중인 내용이 저장되지 않을 수 있습니다. 정말 나가시겠습니까?';
        e.preventDefault();
        e.returnValue = message; // Chrome에서 필요
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGenerating, isEditing]);

  const handlePrint = () => {
    if (!currentContent) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const docInfo = DOCUMENTS.find(d => d.key === activeDoc);
    const docTitle = docInfo?.title || activeDoc;
    const printTitle = `${docTitle}-${currentMeeting?.title || '문서'}-정리본`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${printTitle}</title>
        <style>
          @page { margin: 2cm; size: A4; }
          body {
            font-family: 'NanumGothic', 'NanumGothicCoding', Arial, sans-serif;
            line-height: 1.8;
            color: #333;
            max-width: 21cm;
            margin: 0 auto;
            padding: 20px;
          }
          h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
          }
          h1 { font-size: 28px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
          h2 { font-size: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
          h3 { font-size: 20px; }
          h4 { font-size: 18px; }
          h5 { font-size: 16px; }
          h6 { font-size: 14px; }
          ul, ol { margin: 16px 0; padding-left: 24px; }
          li { margin: 4px 0; }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 16px 0;
          }
          th, td {
            border: 1px solid #d1d5db;
            padding: 8px 12px;
            text-align: left;
          }
          th {
            background-color: #f3f4f6;
            font-weight: 600;
          }
          code {
            background-color: #f3f4f6;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.9em;
          }
          pre {
            background-color: #1f2937;
            color: #f9fafb;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 16px 0;
          }
          pre code {
            background-color: transparent;
            padding: 0;
            color: inherit;
          }
          p { margin: 8px 0; }
          blockquote {
            border-left: 4px solid #6b7280;
            padding-left: 16px;
            margin: 16px 0;
            color: #6b7280;
          }
          hr {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 24px 0;
          }
          @media print {
            body { padding: 0; }
            h1 { page-break-before: auto; }
            h1, h2, h3 { page-break-after: avoid; }
            table, pre, blockquote { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        ${contentToHtml(currentContent)}
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  const contentToHtml = (content: string) => {
    return content
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';

        // 헤더
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const text = headerMatch[2];
          return `<h${level}>${text}</h${level}>`;
        }

        // 리스트
        if (trimmed.match(/^[\-\*+]\s/) || trimmed.match(/^\d+\.\s/)) {
          const text = trimmed.replace(/^[\-\*+\d\.]\s/, '');
          return `<li>${text}</li>`;
        }

        // 코드 블록
        if (trimmed.startsWith('```')) return '';
        if (trimmed.startsWith('    ')) {
          return `<pre><code>${trimmed.substring(4)}</code></pre>`;
        }

        // 테이블
        if (trimmed.includes('|') && !trimmed.match(/^#/)) {
          const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
          if (cells.length > 1) {
            const isHeader = trimmed.includes('---');
            const tag = isHeader ? 'th' : 'td';
            return `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
          }
        }

        // 수평선
        if (trimmed === '---') return '<hr>';

        // 인용문
        if (trimmed.startsWith('>')) {
          return `<blockquote>${trimmed.substring(1).trim()}</blockquote>`;
        }

        return `<p>${trimmed}</p>`;
      })
      .join('\n');
  };

  const handleDownload = (format: 'md' | 'txt' | 'pdf' | 'docx' | 'xlsx' | 'pptx') => {
    if (!currentContent || !currentMeeting) return;
    const docInfo = DOCUMENTS.find(d => d.key === activeDoc);
    const safeTitle = currentMeeting.title.replace(/\s+/g, '-');
    const docTitle = docInfo?.title || activeDoc;
    const baseName = `${docTitle}-${safeTitle}-정리본`;

    switch (format) {
      case 'md':
        downloadMarkdown(currentContent, `${baseName}.md`);
        break;
      case 'txt':
        downloadTxt(currentContent, `${baseName}.txt`);
        break;
      case 'pdf':
        handlePrint(); // PDF는 인쇄 다이얼로그 사용 (브라우저 네이티브 PDF 저장)
        break;
      case 'docx':
        downloadDocx(currentContent, `${baseName}.docx`);
        break;
      case 'xlsx':
        downloadXlsx(currentContent, `${baseName}.xlsx`);
        break;
      case 'pptx':
        downloadPptx(currentContent, `${baseName}.pptx`);
        break;
    }
  };

  const downloadMarkdown = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    saveAs(blob, filename);
  };

  const downloadTxt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    saveAs(blob, filename);
  };

  const downloadDocx = async (content: string, filename: string) => {
    // 마크다운을 파싱하여 Word 문서 생성
    const lines = content.split('\n');
    const paragraphs: Paragraph[] = [];

    lines.forEach(line => {
      const trimmed = line.trim();

      // 빈 줄
      if (!trimmed) {
        paragraphs.push(new Paragraph({ text: '' }));
        return;
      }

      // 헤더 처리 (# ## ### #### ##### ######)
      const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        let headingLevel: typeof HeadingLevel[keyof typeof HeadingLevel];

        switch (level) {
          case 1: headingLevel = HeadingLevel.HEADING_1; break;
          case 2: headingLevel = HeadingLevel.HEADING_2; break;
          case 3: headingLevel = HeadingLevel.HEADING_3; break;
          case 4: headingLevel = HeadingLevel.HEADING_4; break;
          case 5: headingLevel = HeadingLevel.HEADING_5; break;
          case 6: headingLevel = HeadingLevel.HEADING_6; break;
          default: headingLevel = HeadingLevel.HEADING_1;
        }

        paragraphs.push(new Paragraph({
          text: text,
          heading: headingLevel,
          spacing: { before: 200, after: 100 }
        }));
        return;
      }

      // 리스트 처리 (-, *, +, 1.)
      const listMatch = trimmed.match(/^[\-\*\+]\s+(.+)$/);
      const numberMatch = trimmed.match(/^\d+\.\s+(.+)$/);

      if (listMatch || numberMatch) {
        const text = listMatch ? listMatch[1] : numberMatch![1];
        paragraphs.push(new Paragraph({
          children: [
            new TextRun({ text: '• ', bold: true }),
            new TextRun(text)
          ],
          indent: { left: 720 },
          spacing: { after: 50 }
        }));
        return;
      }

      // 테이블 처리 (|)
      if (trimmed.includes('|')) {
        const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        // 간단한 테이블 처리 - 나중에 개선 가능
        if (cells.length > 1) {
          paragraphs.push(new Paragraph({
            text: cells.join(' | '),
            spacing: { after: 50 }
          }));
          return;
        }
      }

      // 코드 블록 처리 (```로 감싸진 부분)
      if (trimmed.startsWith('```')) {
        return; // 코드 블록 시작/종료 무시
      }

      // 일반 텍스트
      paragraphs.push(new Paragraph({
        text: trimmed,
        spacing: { after: 100 }
      }));
    });

    const doc = new DocxDocument({
      sections: [{
        properties: {},
        children: paragraphs
      }]
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, filename);
  };

  const downloadXlsx = (content: string, filename: string) => {
    // 마크다운을 파싱하여 테이블과 텍스트로 변환
    const lines = content.split('\n');
    const worksheetData: (string | { v: string; s: { font: { bold: boolean } } })[][] = [];

    lines.forEach(line => {
      // 헤더 처리 (# ## ###)
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');
        worksheetData.push([{ v: text, s: { font: { bold: true } } }]);
        worksheetData.push([]); // 빈 줄
      }
      // 리스트 처리 (-, *, 1.)
      else if (line.match(/^[\-\*\+]\s/) || line.match(/^\d+\.\s/)) {
        worksheetData.push([{ v: line.trim().replace(/^[\-\*\+\d\.]\s/, '• '), s: { font: { bold: false } } }]);
      }
      // 테이블 처리 (|)
      else if (line.includes('|') && !line.match(/^#{1,6}\s/)) {
        const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (cells.length > 0) {
          worksheetData.push(cells.map(c => c.trim()));
        }
      }
      // 빈 줄
      else if (line.trim() === '') {
        worksheetData.push([]);
      }
      // 일반 텍스트
      else {
        worksheetData.push([line.trim()]);
      }
    });

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // 열 너비 자동 조정
    const colWidths = worksheetData.reduce((max: number[], row) => {
      row.forEach((cell, i) => {
        const len = String(cell).length;
        if (!max[i] || len > max[i]) max[i] = len;
      });
      return max;
    }, []);
    worksheet['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w, 15), 50) }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Document');
    XLSX.writeFile(workbook, filename);
  };

  const downloadPptx = (content: string, filename: string) => {
    const pptx = new PptxGenJS();
    const lines = content.split('\n');

    // 한글 폰트 설정
    pptx.defineLayout({ name: 'A4', width: 10, height: 7.5 });

    // 제목 슬라이드
    const titleSlide = pptx.addSlide();
    const firstLine = lines.find(l => l.match(/^#{1,6}\s/))?.replace(/^#+\s*/, '') || lines[0] || '문서';
    titleSlide.addText(firstLine, {
      x: 0.5, y: 2, w: 9, h: 1.5,
      fontSize: 44, bold: true, align: 'center', color: '363636'
    });

    // 내용 슬라이드들
    let currentSlide: PptxGenJS.Slide = pptx.addSlide();
    let yPosition = 0.5;
    let slideIndex = 0;

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('```')) return;

      // 헤더 처리 (# ## ###) - 새 슬라이드
      const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        currentSlide = pptx.addSlide();
        slideIndex++;
        yPosition = 1;

        const level = headerMatch[1].length;
        const fontSize = 36 - (level * 6);

        currentSlide.addText(headerMatch[2], {
          x: 0.5, y: yPosition, w: 9, h: 0.8,
          fontSize: fontSize, bold: true, color: '363636'
        });
        yPosition += 1.2;
        return;
      }

      // 슬라이드가 꽉 차면 새 슬라이드
      if (yPosition > 6) {
        currentSlide = pptx.addSlide();
        slideIndex++;
        yPosition = 0.5;
      }

      // 리스트 처리
      if (trimmed.match(/^[\-\*\+]\s/) || trimmed.match(/^\d+\.\s/)) {
        const text = trimmed.replace(/^[\-\*\+\d\.]\s/, '');
        currentSlide.addText(`• ${text}`, {
          x: 0.8, y: yPosition, w: 8.4, h: 0.4,
          fontSize: 16, color: '4a4a4a'
        });
        yPosition += 0.5;
      }
      // 테이블 처리
      else if (trimmed.includes('|') && !trimmed.match(/^#/)) {
        const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (cells.length > 1 && !trimmed.includes('---')) {
          currentSlide.addTable([cells.map(c => c.trim())] as any, {
            x: 0.5, y: yPosition, w: 9,
            border: { pt: 1, color: 'CCCCCC' }
          });
          yPosition += 1;
        }
      }
      // 일반 텍스트
      else {
        currentSlide.addText(trimmed, {
          x: 0.8, y: yPosition, w: 8.4, h: 0.4,
          fontSize: 14, color: '4a4a4a'
        });
        yPosition += 0.4;
      }
    });

    pptx.writeFile({ fileName: filename });
  };

  // 생성된 문서 수 계산
  const generatedCount = Object.values(documents).filter(Boolean).length;
  const totalCount = DOCUMENTS.length;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* 왼쪽 사이드바 - 트리 네비게이션 */}
      <div className="w-full lg:w-80 flex-shrink-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col">
        {/* 사이드바 헤더 */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">문서 목록</h2>
        </div>
        {/* 트리 영역 - 스크롤 가능 */}
        <div ref={treeRef} className="flex-1 overflow-y-auto max-h-[60vh]">
          <Tabs value={activeDoc} onValueChange={(v) => setActiveDoc(v as DocType)}>
            <TabsList className="bg-transparent border-none p-0 h-auto flex flex-col items-start gap-0.5 rounded-none w-full">
          {visibleNodes.map(({ node, level }, index) => {
              const hasDoc = !!documents[node.key];
              const { canGenerate } = canGenerateDoc(node.key, documents);
              const isDisabled = !hasDoc && !canGenerate;
              const isExpanded = expandedNodes.has(node.key);
              const hasChildren = node.children.length > 0;
              const hasNextSibling = index < visibleNodes.length - 1 &&
                                     visibleNodes[index + 1].level <= level;

              return (
                <div key={node.key} className="relative w-full">
                  {/* 트리 연결선 */}
                  {level > 0 && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
                      style={{
                        left: `${level * 20 - 8}px`,
                        height: hasNextSibling ? '100%' : '24px'
                      }}
                    />
                  )}
                  {level > 0 && (
                    <div
                      className="absolute left-0 top-3 w-4 h-px bg-slate-200 dark:bg-slate-700"
                      style={{ left: `${level * 20 - 8}px` }}
                    />
                  )}

                  <TabsTrigger
                    value={node.key}
                    className="gap-2 text-sm w-full justify-start px-3 py-2 h-auto rounded-md
                             text-slate-900 dark:text-slate-100
                             data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800
                             data-[state=active]:shadow-sm
                             hover:bg-slate-100 dark:hover:bg-slate-800
                             transition-all duration-150 ease-in-out
                             border border-transparent
                             data-[state=active]:border-slate-200 dark:data-[state=active]:border-slate-700
                             relative group"
                    disabled={isDisabled}
                    style={{ paddingLeft: `${level * 20 + 12}px` }}
                  >
                    {/* 펼침/접힘 버튼 - div로 변경하여 중첩 버튼 문제 해결 */}
                    {hasChildren ? (
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleNode(node.key);
                        }}
                        className="p-0 h-5 w-5 flex items-center justify-center
                               hover:bg-slate-200 dark:hover:bg-slate-700
                               rounded transition-colors duration-150
                               cursor-pointer select-none
                               flex-shrink-0 -ml-6 mr-1
                               group-hover:bg-slate-200 dark:group-hover:bg-slate-700"
                        style={{ marginLeft: `${level * 20 - 28}px` }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 pointer-events-none" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 pointer-events-none" />
                        )}
                      </div>
                    ) : (
                      <span
                        className="h-5 w-5 inline-block flex-shrink-0"
                        style={{ marginLeft: `${level * 20 - 28}px` }}
                      />
                    )}

                    {/* 아이콘과 제목 */}
                    <span className="text-base flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                      {node.icon}
                    </span>
                    <span className="truncate flex-1 text-left text-slate-900 dark:text-slate-100">
                      {node.title}
                    </span>

                    {/* 상태 표시 - 개선된 디자인 */}
                    <span className="ml-auto flex-shrink-0 flex items-center gap-2">
                      {hasDoc && (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                        </span>
                      )}
                      {!hasDoc && !canGenerate && (
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                      )}
                    </span>
                  </TabsTrigger>
                </div>
              );
            })}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* 메인 컨텐츠 영역 */}
      <div className="flex-1 min-w-0">
        {/* 상단 헤더 바 */}
        <div className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between gap-6 px-6 py-3">
            {/* 왼쪽: 문서 생성 현황 */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  문서 생성 현황
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  {generatedCount} / {totalCount}개
                </span>
              </div>
              {/* 진행도 바 */}
              <div className="w-32 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                  style={{ width: `${(generatedCount / totalCount) * 100}%` }}
                />
              </div>
            </div>

            {/* 중앙: 네비게이션 (이전/다음) */}
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePreviousDoc}
                disabled={flatIndex === 0}
                variant="outline"
                size="sm"
                className="h-8"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                이전
              </Button>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 min-w-[120px] text-center">
                {doc?.title || activeDoc}
              </span>
              <Button
                onClick={handleNextDoc}
                disabled={flatIndex === FLAT_DOCUMENTS.length - 1}
                variant="outline"
                size="sm"
                className="h-8"
              >
                다음
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>

            {/* 오른쪽: 전체 생성 버튼 */}
            <Button
              onClick={handleGenerateAll}
              disabled={isGenerating || !currentMeeting?.summary}
              size="sm"
              className="h-8"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  생성 중...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  전체 생성
                </>
              )}
            </Button>

            {/* 모두 내보내기 버튼 */}
            <Button
              onClick={handleDownloadAll}
              disabled={Object.keys(documents).filter(k => documents[k as DocType]).length === 0}
              size="sm"
              variant="outline"
              className="h-8"
            >
              <Download className="w-4 h-4 mr-2" />
              모두 내보내기
            </Button>
          </div>
        </div>

        {/* 문서 컨텐츠 영역 */}
        <div className="p-6">
        <div className="min-w-0">
          {DOCUMENTS.map((doc) => {
            const docContent = documents[doc.key] || '';
            const docHasContent = !!docContent;
            const docIsEditing = isEditing && activeDoc === doc.key;
            const docViewMode = activeDoc === doc.key ? viewMode : 'raw';

            // 활성 탭만 렌더링
            if (activeDoc !== doc.key) return null;

            return (
              <div key={doc.key} className="space-y-4">
                {/* 문서 헤더 */}
                <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <span className="text-2xl flex-shrink-0">{doc.icon}</span>
                        <span className="truncate">{doc.title}</span>
                      </CardTitle>
                      <p className="text-sm text-slate-500 mt-1">{doc.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 flex-shrink-0">
                      {docHasContent ? (
                        <>
                          <Button onClick={handleCopy} variant="outline" size="sm" title="복사">
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                          <Button
                            onClick={() => {
                              if (docViewMode === 'raw') setViewMode('preview');
                              else if (docViewMode === 'preview') setViewMode('visual');
                              else if (docViewMode === 'visual') setViewMode('terminal');
                              else setViewMode('raw');
                            }}
                            variant="outline"
                            size="sm"
                            title="보기 모드"
                          >
                            {docViewMode === 'raw' ? <BookOpen className="w-4 h-4" /> : docViewMode === 'preview' ? <Eye className="w-4 h-4" /> : docViewMode === 'visual' ? <Terminal className="w-4 h-4" /> : <Code className="w-4 h-4" />}
                          </Button>
                          <Button onClick={handlePrint} variant="outline" size="sm" title="인쇄">
                            <Printer className="w-4 h-4" />
                          </Button>
                          {!docIsEditing && docViewMode === 'raw' && (
                            <Button onClick={() => setIsEditing(true)} variant="outline" size="sm" title="편집">
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {docIsEditing && (
                            <Button onClick={() => setIsEditing(false)} variant="outline" size="sm" title="미리보기">
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 px-3 py-2">
                              <Download className="w-4 h-4 mr-2" />
                              내보내기
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDownload('md')}>
                              <File className="w-4 h-4 mr-2" />
                              Markdown (.md)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload('txt')}>
                              <File className="w-4 h-4 mr-2" />
                              텍스트 (.txt)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload('pdf')}>
                              <File className="w-4 h-4 mr-2" />
                              PDF / 인쇄
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload('docx')}>
                              <File className="w-4 h-4 mr-2" />
                              Word (.docx)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload('xlsx')}>
                              <File className="w-4 h-4 mr-2" />
                              Excel (.xlsx)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownload('pptx')}>
                              <Presentation className="w-4 h-4 mr-2" />
                              PowerPoint (.pptx)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          onClick={() => handleGenerateDoc(doc.key)}
                          disabled={isGenerating}
                          variant="outline"
                          size="sm"
                          title="다시 생성"
                        >
                          {isGenerating ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Edit className="w-4 h-4 mr-1" />
                              다시 생성
                            </>
                          )}
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => handleGenerateDoc(doc.key)}
                        disabled={isGenerating}
                        size="sm"
                      >
                        {isGenerating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            생성
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* 문서 내용 */}
            {docHasContent ? (
              <>
                {/* 플로팅 네비게이션 화살표 */}
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-b-lg shadow-lg border border-slate-200 dark:border-slate-700 px-4 py-2 mb-4 -mx-4">
                  <Button
                    onClick={handlePreviousDoc}
                    disabled={flatIndex === 0}
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-8 rounded-full"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">이전</span>
                  </Button>
                  <div className="flex items-center gap-2 px-3">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {FLAT_DOCUMENTS[flatIndex]?.icon}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {flatIndex + 1} / {FLAT_DOCUMENTS.length}
                    </span>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {FLAT_DOCUMENTS[flatIndex]?.title}
                    </span>
                  </div>
                  <Button
                    onClick={handleNextDoc}
                    disabled={flatIndex === FLAT_DOCUMENTS.length - 1}
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-8 rounded-full"
                  >
                    <span className="hidden sm:inline">다음</span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* 상단 여백 (플로팅 버튼 공간 확보) */}
                <div className="h-16"></div>

                {isEditing ? (
                <Card>
                  <CardContent className="pt-6">
                    <Textarea
                      value={editedContent || docContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      className="min-h-[500px] font-mono text-sm"
                      placeholder="문서 내용을 입력하세요..."
                    />
                    <div className="flex gap-2 mt-4">
                      <Button onClick={handleSaveEdit} size="sm">
                        <Save className="w-4 h-4 mr-2" />
                        저장
                      </Button>
                      <Button onClick={() => setIsEditing(false)} variant="outline" size="sm">
                        취소
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : viewMode === 'visual' ? (
                /* 시각화 모드 */
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{doc?.title} 시각화</span>
                      <Button onClick={() => setViewMode('preview')} variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        문서 보기
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    {activeDoc === 'ia' && <ScreenDiagram content={docContent} type="ia" />}
                    {activeDoc === 'flowchart' && (
                      !docContent.trim() ? (
                        <div className="text-center p-8 text-slate-500 dark:text-slate-400">
                          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p className="mb-2">아직 플로우차트 문서가 생성되지 않았습니다.</p>
                          <p className="text-sm">먼저 문서를 생성해주세요.</p>
                        </div>
                      ) : (
                        <MermaidDiagram chart={extractMermaidCode(docContent)} />
                      )
                    )}
                    {activeDoc === 'wireframe' && <ScreenDiagram content={docContent} type="wireframe" />}
                    {activeDoc === 'storyboard' && <StoryboardViewer content={docContent} />}
                    {activeDoc === 'test-plan' && <TestPlanViewer content={docContent} />}
                    {activeDoc === 'wbs' && <WBSViewer content={docContent} />}
                    {['prd', 'feature-list', 'screen-list', 'user-story', 'api-spec', 'deployment'].includes(activeDoc) && (
                      <div className="text-center p-8 text-slate-500 dark:text-slate-400">
                        <p className="mb-4">{doc?.title} 문서는 시각화를 지원하지 않습니다.</p>
                        <Button onClick={() => setViewMode('preview')} variant="outline">
                          <Eye className="w-4 h-4 mr-2" />
                          문서 보기 모드로 전환
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : viewMode === 'terminal' ? (
                /* 터미널 모드 */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
                  {/* 명령어 패널 */}
                  <div className="lg:col-span-1 overflow-hidden">
                    <Card className="h-full">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Terminal className="w-4 h-4" />
                          명령어 패널
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 h-[calc(100%-60px)]">
                        <div className="h-full overflow-y-auto">
                          <CommandPanel />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* 터미널 */}
                  <div className="lg:col-span-2">
                    <Card className="h-full">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Terminal className="w-4 h-4" />
                            터미널
                          </span>
                          <Button
                            onClick={() => setViewMode('visual')}
                            variant="outline"
                            size="sm"
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            문서 보기
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 h-[calc(100%-60px)]">
                        <InAppTerminal
                          commands={terminalCommands}
                          onCommandExecute={(cmd) => {
                            setTerminalCommands(prev => [...prev, cmd]);
                          }}
                        />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : viewMode === 'preview' ? (
                <Card>
                  <CardContent className="p-8">
                    <div className="document-preview max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-lg shadow-inner p-8" style={{ fontFamily: "'NanumGothic', Arial, sans-serif" }}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="text-3xl font-bold border-b-4 border-slate-300 dark:border-slate-600 pb-4 mb-8 mt-0 first:mt-0 text-slate-900 dark:text-white">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-2xl font-bold border-b-2 border-slate-300 dark:border-slate-600 pb-3 mb-6 mt-8 text-slate-900 dark:text-white">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-xl font-bold mb-4 mt-6 text-slate-900 dark:text-white">{children}</h3>,
                          h4: ({ children }) => <h4 className="text-lg font-bold mb-3 mt-5 text-slate-900 dark:text-white">{children}</h4>,
                          h5: ({ children }) => <h5 className="text-base font-bold mb-2 mt-4 text-slate-900 dark:text-white">{children}</h5>,
                          h6: ({ children }) => <h6 className="text-sm font-bold mb-2 mt-4 text-slate-700 dark:text-slate-300">{children}</h6>,
                          p: ({ children }) => <p className="mb-4 leading-relaxed text-slate-900 dark:text-slate-100">{children}</p>,
                          ul: ({ children }) => <ul className="mb-6 ml-8 list-disc space-y-2 marker:text-slate-700 dark:marker:text-slate-400">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-6 ml-8 list-decimal space-y-2 marker:text-slate-700 dark:marker:text-slate-400">{children}</ol>,
                          li: ({ children }) => <li className="text-slate-900 dark:text-slate-100 leading-relaxed">{children}</li>,
                          table: ({ children }) => (
                            <div className="my-6 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
                              <table className="min-w-full">{children}</table>
                            </div>
                          ),
                          thead: ({ children }) => <thead className="bg-slate-100 dark:bg-slate-800">{children}</thead>,
                          th: ({ children }) => <th className="px-4 py-3 text-left font-bold border-b border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white">{children}</th>,
                          td: ({ children }) => <td className="px-4 py-3 border-b border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100">{children}</td>,
                          code: ({ className, children, node }) => {
                            // mermaid 코드 블록 감지
                            const language = className?.replace('language-', '');
                            if (language === 'mermaid') {
                              const codeContent = String(children).replace(/\n$/, '');
                              return <MermaidDiagram chart={codeContent} key={node?.position?.start?.line?.toString()} />;
                            }
                            const isInline = !className;
                            return isInline ? (
                              <code className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-sm font-mono text-pink-600 dark:text-pink-400">{children}</code>
                            ) : (
                              <code className={className}>{children}</code>
                            );
                          },
                          pre: ({ children, node }) => {
                            // mermaid인 경우 이미 처리했으므로 건너뜀
                            const childArray = Array.isArray(children) ? children : [children];
                            const codeChild = childArray.find((c): c is { type: string; props: any } =>
                              typeof c === 'object' && c !== null && 'type' in c && c.type === 'code'
                            );
                            if (codeChild && 'props' in codeChild) {
                              const props = codeChild.props as { className?: string };
                              if (props.className?.includes('language-mermaid')) {
                                return <>{children}</>;
                              }
                            }
                            return (
                              <pre className="mb-6 p-4 bg-slate-900 dark:bg-slate-950 text-green-400 rounded-lg overflow-x-auto border border-slate-700">
                                {children}
                              </pre>
                            );
                          },
                          blockquote: ({ children }) => (
                            <blockquote className="mb-6 pl-4 border-l-4 border-slate-500 dark:border-slate-400 text-slate-700 dark:text-slate-300 italic">{children}</blockquote>
                          ),
                          hr: () => <hr className="my-8 border-slate-300 dark:border-slate-600" />,
                          a: ({ href, children }) => (
                            <a href={href} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">{children}</a>
                          ),
                        }}
                      >
                        {docContent}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-6">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {docContent}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </>
            ) : (
              <Card>
                <CardContent className="text-center py-16">
                  <div className="text-6xl mb-4">{doc.icon}</div>
                  <h3 className="text-lg font-medium mb-2">{doc.title} 문서</h3>
                  <p className="text-slate-500 mb-6">{doc.description}</p>
                  <Button
                    onClick={() => handleGenerateDoc(doc.key)}
                    disabled={isGenerating || !currentMeeting?.summary}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        생성 중...
                      </>
                    ) : (
                      <>
                        <Plus className="w-5 h-5 mr-2" />
                        {doc.title} 생성하기
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
            </div>
          );
        })}
        </div>
        </div>
      </div>

      {/* 전체 생성 확인 다이얼로그 */}
      {!currentMeeting?.summary && (
        <AlertDialog open={showGenerateConfirm} onOpenChange={setShowGenerateConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>요약 먼저 생성 필요</AlertDialogTitle>
              <AlertDialogDescription>
                문서를 생성하려면 먼저 요약을 생성해야 합니다. 요약 탭으로 이동하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                setShowGenerateConfirm(false);
                // 요약 탭으로 이동 - parent로 이벤트 전달 필요 시 추가
              }}>
                요약 탭으로 이동
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {currentMeeting?.summary && generateConfirmData && (
        <AlertDialog open={showGenerateConfirm} onOpenChange={setShowGenerateConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {generateConfirmData.isRegenerate ? '전체 재생성' : '전체 생성'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {generateConfirmData.isRegenerate
                  ? `모든 문서(${generateConfirmData.count}개)가 이미 생성되어 있습니다.\n전체를 다시 생성하시겠습니까?`
                  : `${generateConfirmData.count}개 문서를 생성하시겠습니까?\n(의존성이 충족된 문서만 생성됩니다)`
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={confirmGenerateAll}>
                {generateConfirmData.isRegenerate ? '재생성' : '생성'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

export default PrdViewer;
