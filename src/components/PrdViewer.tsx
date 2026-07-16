'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Download, Copy, Check, Loader2, Plus, Edit, Save, Eye, File, Code, BookOpen, Presentation, Printer, ChevronLeft, ChevronRight, Terminal, CheckCircle2, Circle, ToggleLeft, ToggleRight, Lock, Unlock, AlertTriangle, Share2, X, RefreshCw, Maximize, Info } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { saveAs } from 'file-saver';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sanitizeHtml } from '@/lib/sanitize';
import { extractMermaidCode, docTypeToField, canGenerateDoc, getAllDependents, getDirectParentTitles, getStaleParents, DOCUMENTS, DEPENDENCIES, type DocType } from '@/lib/documentUtils';
import { prerenderMermaid } from '@/lib/mermaidExport';
import { contentToHtml, buildDocxBlob, buildXlsxBlob, buildPptxBlob, buildPdfBlob } from '@/lib/exportFormatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
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
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useMeetingStore } from '@/store/meetingStore';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/authFetch';
import { MermaidDiagram } from '@/components/MermaidDiagram';
import { ScreenDiagram, StoryboardViewer } from '@/components/ScreenDiagram';
import { MediaLightbox, type LightboxState } from '@/components/MediaLightbox';
import { downloadMermaidPng, downloadMermaidSvg, downloadElementPng, downloadImageOriginal } from '@/lib/diagramExport';
import { TestPlanViewer } from '@/components/TestPlanViewer';
import { WBSViewer } from '@/components/WBSViewer';
import { InAppTerminal } from '@/components/InAppTerminal';
import { CommandPanel } from '@/components/CommandPanel';

// 전체 내보내기 ZIP에 담을 수 있는 포맷(개별 다운로드와 동일).
type ExportFormat = 'md' | 'txt' | 'pdf' | 'docx' | 'xlsx' | 'pptx';

// 시각화('visual')를 지원하지 않는 문서. 기본 진입은 'preview'로, '시각화' 탭은 유지.
const NO_VISUAL: DocType[] = ['prd', 'feature-list', 'screen-list', 'user-story', 'api-spec', 'deployment'];

// 시각화를 감싸 우상단 확대 버튼 오버레이를 제공. onZoom에 래퍼 DOM을 넘김.
// group/zoom 네임드 variant 사용(뷰어 내부의 group hover와 충돌 방지).
function ZoomBox({ title, children, onZoom }: { title: string; children: React.ReactNode; onZoom: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative group/zoom">
      {children}
      <button
        type="button"
        onClick={() => ref.current && onZoom(ref.current)}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-white/90 dark:bg-slate-800/90 shadow border border-slate-200 dark:border-slate-700 opacity-0 group-hover/zoom:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`${title} 확대`}
        title={`${title} 크게 보기`}
      >
        <Maximize className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      </button>
    </div>
  );
}

export function PrdViewer() {
  const { currentMeeting, updateCurrentMeeting, toggleCompleteDoc, isDocCompleted, getNextIncompleteDoc, setAutoAdvance } = useMeetingStore();
  const {
    getDocStatus,
    freezeDoc,
    unfreezeDoc,
    isDocFrozen,
    canRegenerateDoc,
    setDocStatus,
    incrementDocVersion,
    markDependentsOutdated,
    recordDocVersion
  } = useMeetingStore();

  // 항상 PRD로 시작 - 초기화 함수 사용
  const [activeDoc, setActiveDoc] = useState<DocType>('prd');

  // 현재 보고 있는 문서를 전역에 반영 → 채팅 도우미가 컨텍스트로 사용
  const setActiveDocType = useMeetingStore(s => s.setActiveDocType);
  useEffect(() => {
    setActiveDocType(activeDoc);
  }, [activeDoc, setActiveDocType]);

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
  // 전체 생성 상태는 store에서 구독 (백그라운드 지속 — PrdViewer 언마운트와 무관)
  const isGenerating = useMeetingStore(s => s.isGenerating);
  const generationProgress = useMeetingStore(s => s.generationProgress);
  const startGeneration = useMeetingStore(s => s.startGeneration);
  const cancelGeneration = useMeetingStore(s => s.cancelGeneration);
  const regenerateDocs = useMeetingStore(s => s.regenerateDocs);
  // 단일 문서 생성 전용 플래그 (전체 생성과 분리)
  const [isSingleGenerating, setIsSingleGenerating] = useState(false);
  // mermaid 다이어그램 렌더 실패 감지 (깨진 다이어그램 → 재생성 유도 배너)
  const [diagramBroken, setDiagramBroken] = useState(false);
  // 전체 내보내기(ZIP) 진행 중 — 중복 클릭 방지 + 로딩 표시
  const [exporting, setExporting] = useState(false);
  // 다이어그램/이미지 확대 라이트박스 (단일 상태)
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [generateConfirmData, setGenerateConfirmData] = useState<{ count: number; isRegenerate: boolean; docsToRegenerate: DocType[] } | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // 수정모드 저장 분기 확인 (사소 수정 / 주요 변경)
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  // 저장 후 "영향받은 N개 문서" 안내 배너 (위상순서 하위 목록)
  const [impactedDocs, setImpactedDocs] = useState<DocType[]>([]);
  // 자식 수정 저장 시 상위(부모) 모순 경고 모달
  const [parentWarning, setParentWarning] = useState<{ docType: DocType; parents: string[] } | null>(null);
  // 단일 재생성 시 stale 부모(outdated) 컨텍스트 덮어쓰기 경고 (#7)
  const [staleGuard, setStaleGuard] = useState<{ docType: DocType; parents: DocType[] } | null>(null);
  // '현재 브라우저 기준' 고지 1회 노출 여부 (#10). 영향배너 첫 표시 때만, localStorage 플래그로 재표시 차단.
  const [showScopeHint, setShowScopeHint] = useState(false);

  const [editedContent, setEditedContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showShareSuccess, setShowShareSuccess] = useState(false);
  // 기본 시각화. 단 시각화 미지원 문서로 시작하면 빈 패널 대신 'preview'로 진입.
  const [viewMode, setViewMode] = useState<'raw' | 'preview' | 'visual' | 'terminal'>(() => NO_VISUAL.includes(activeDoc) ? 'preview' : 'visual');
  const [terminalCommands, setTerminalCommands] = useState<string[]>([]);
  const treeRef = useRef<HTMLDivElement>(null);
  const tabsListRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // 학습 완료 관련 상태
  const [autoAdvance, setAutoAdvanceState] = useState(false);
  const [sequentialMode, setSequentialMode] = useState(false); // 순차적 진행 모드
  const [scrollAtBottom, setScrollAtBottom] = useState(false);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 페이지 이탈 방지 (편집 중) — 전체 생성 중 경고는 전역 GenerationGuard가 담당
  useBeforeUnload(
    isEditing,
    '편집 중인 내용이 저장되지 않을 수 있습니다. 정말 나가시겠습니까?'
  );

  // 컴포넌트 마운트 시 항상 activeDoc 초기화 및 강력한 스크롤 초기화
  useEffect(() => {
    setActiveDoc('prd');
    console.log('[PrdViewer] Mounted, set activeDoc to prd');

    // 강력한 스크롤 초기화 (마운트 시 즉시 실행)
    const forceScrollReset = () => {
      // 전체 페이지 스크롤
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      // localStorage에서 스크롤 위치 삭제
      try {
        localStorage.removeItem('scrollPosition');
        localStorage.removeItem('tabs-scroll-position');
        sessionStorage.clear();
      } catch {}

      // treeRef 스크롤만 맨 위로 초기화
      // 주의: overflow='visible'이나 scrollIntoView()는 사이드바 콘텐츠를
      // 위로 밀어 상위 항목(PRD 등)을 잘리게 하므로 사용 금지
      if (treeRef.current) {
        treeRef.current.scrollTop = 0;
      }
    };

    forceScrollReset();

    // 여러 타이밍에서 재시도
    [0, 10, 50, 100, 200].forEach(delay => {
      setTimeout(forceScrollReset, delay);
    });
  }, []);

  // currentMeeting 변경 시 documents 동기화
  // 전체 생성이 store(currentMeeting)에 문서를 추가하므로, 생성된 문서 개수 변화도 감지해 미러 갱신
  const docCountKey = currentMeeting
    ? DOCUMENTS.filter(d => !!(currentMeeting as unknown as Record<string, unknown>)[docTypeToField(d.key)]).length
    : 0;
  // 문서 "내용" 변경(개수 불변)도 감지해야 DocHelper 수정 적용 즉시 화면 반영.
  // updateCurrentMeeting이 항상 updatedAt을 갱신하므로 이를 의존성에 포함.
  const updatedKey = currentMeeting?.updatedAt ? new Date(currentMeeting.updatedAt).getTime() : 0;
  useEffect(() => {
    // 편집(raw) 중이면 사용자 입력 유실 방지 위해 미러 갱신 보류(편집 종료 시 재동기화됨).
    if (isEditing) return;
    setDocuments(getDocumentsFromMeeting());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMeeting?.id, docCountKey, updatedKey, isEditing]);

  // 활성 문서 전환 보정: 시각화 미지원 문서로 넘어갈 때 'visual'이면 빈 패널 방지를 위해 'preview'로.
  // (사용자가 고른 'raw'/'preview'/'terminal'은 건드리지 않음)
  useEffect(() => {
    if (viewMode === 'visual' && NO_VISUAL.includes(activeDoc)) {
      setViewMode('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc]);

  // 스크롤 초기화 - 컴포넌트 마운트 시와 activeDoc 변경 시 실행
  useEffect(() => {
    console.log('[PrdViewer] Scroll reset, activeDoc:', activeDoc);

    // 브라우저 스크롤 복원 비활성화
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    const resetScroll = () => {
      // 1. 전체 페이지 스크롤 초기화 (가장 강력)
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      // 2. tabsListRef 초기화
      if (tabsListRef.current) {
        tabsListRef.current.scrollTop = 0;
        console.log('[PrdViewer] tabsListRef.scrollTop reset to 0, current:', tabsListRef.current.scrollTop);
      }
      // 3. treeRef 초기화
      if (treeRef.current) {
        treeRef.current.scrollTop = 0;
      }
      // 4. id로 초기화
      const container = document.getElementById('document-list-container');
      if (container) {
        container.scrollTop = 0;
      }
      // 5. data-slot으로 초기화
      const tabsList = document.querySelector('[data-slot="tabs-list"]');
      if (tabsList) {
        (tabsList as HTMLElement).scrollTop = 0;
      }
      // 6. 모든 overflow-y 가능한 요소 초기화
      const scrollableElements = document.querySelectorAll('[class*="overflow"], [style*="overflow"]');
      scrollableElements.forEach((el) => {
        const element = el as HTMLElement;
        if (element.scrollTop > 0) {
          element.scrollTop = 0;
        }
      });
    };

    // 즉시 실행
    resetScroll();

    // 여러 타이밍에서 재시도 (더 긴 타이밍 추가)
    const timeouts = [0, 10, 50, 100, 200, 300].map(delay =>
      setTimeout(resetScroll, delay)
    );

    return () => timeouts.forEach(clearTimeout);
  }, [activeDoc]); // activeDoc 변경 시마다 실행

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
    // 문서가 변경되면 스크롤 상태 리셋
    setScrollAtBottom(false);
    // 문서 변경 시 다이어그램 깨짐 표시 리셋(새 문서에서 다시 판정)
    setDiagramBroken(false);
  }, [currentMeeting, activeDoc]);

  // autoAdvance 상태 동기화
  useEffect(() => {
    if (currentMeeting?.autoAdvance !== undefined) {
      setAutoAdvanceState(currentMeeting.autoAdvance);
    }
  }, [currentMeeting?.autoAdvance]);

  // 일괄/개별 갱신으로 더 이상 outdated가 아닌 문서를 영향배너 칩에서 비움.
  // docStatuses(persist)를 구독해 regen 잡이 문서별 latest로 풀 때마다 칩이 줄어든다.
  const docStatusesForMeeting = useMeetingStore(
    s => (currentMeeting?.id ? s.docStatuses[currentMeeting.id] : undefined)
  );
  useEffect(() => {
    if (!currentMeeting?.id || impactedDocs.length === 0) return;
    const still = impactedDocs.filter(d => getDocStatus(currentMeeting.id, d) === 'outdated');
    if (still.length !== impactedDocs.length) setImpactedDocs(still);
    // getDocStatus/impactedDocs는 매 렌더 안정적 참조가 아니므로 docStatuses 변화로만 트리거.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docStatusesForMeeting, currentMeeting?.id]);

  // '현재 브라우저 기준' 고지(#10): 영향배너가 처음 뜰 때 1회만. 이미 본 적 있으면 표시 안 함.
  useEffect(() => {
    if (impactedDocs.length > 0 && typeof window !== 'undefined'
        && !localStorage.getItem('madStatusScopeHintSeen')) {
      setShowScopeHint(true);
    }
  }, [impactedDocs.length]);

  // 현재 문서 컨텐츠
  const currentContent = documents[activeDoc] || '';
  const doc = DOCUMENTS.find(d => d.key === activeDoc);
  const flatIndex = DOCUMENTS.findIndex(d => d.key === activeDoc);

  // 스크롤 끝 도달 감지
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = contentElement;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

      if (isAtBottom && !scrollAtBottom) {
        setScrollAtBottom(true);

        // 문서 완료 처리 (이미 완료되지 않은 경우만)
        const content = documents[activeDoc] || '';
        if (!isDocCompleted(activeDoc) && content) {
          toggleCompleteDoc(activeDoc);

          // 자동 넘김이 활성화된 경우 다음 문서로 이동
          if (autoAdvance) {
            setTimeout(() => {
              const nextDoc = getNextIncompleteDoc();
              if (nextDoc) {
                setActiveDoc(nextDoc);
              }
            }, 500);
          }
        }
      } else if (!isAtBottom && scrollAtBottom) {
        setScrollAtBottom(false);
      }
    };

    contentElement.addEventListener('scroll', handleScroll);
    return () => contentElement.removeEventListener('scroll', handleScroll);
  }, [activeDoc, documents, scrollAtBottom, autoAdvance, isDocCompleted, toggleCompleteDoc, getNextIncompleteDoc]);


  const handleGenerateDoc = async (docType: DocType, forceProceed = false) => {
    if (!currentMeeting?.summary) {
      alert('먼저 요약을 생성해주세요.');
      return;
    }

    // 잡 인지 가드: 전체생성/일괄갱신이 진행 중이면 단일 재생성 차단(동시 덮어쓰기 방지).
    // disabled는 같은 탭에서만 유효 → 타탭/복귀재개 타이밍을 store 실시간 상태로 한 번 더 방어.
    {
      const st = useMeetingStore.getState();
      if (st.isGenerating || st.activeJob?.status === 'running') {
        alert('전체 생성 또는 일괄 갱신이 진행 중입니다. 끝난 뒤에 다시 시도해주세요.');
        return;
      }
    }

    // frozen 체크
    if (currentMeeting?.id) {
      const { can, reason } = canRegenerateDoc(currentMeeting.id, docType);
      if (!can) {
        alert(`이 문서는 ${reason || '고정되어 있어'} AI가 수정할 수 없습니다.\n고정을 해제한 후 다시 시도해주세요.`);
        return;
      }
    }

    // 의존성 체크
    const { canGenerate, missing } = canGenerateDoc(docType, documents);
    if (!canGenerate) {
      const missingNames = missing.map(dep => DOCUMENTS.find(d => d.key === dep)?.title || dep).join(', ');
      alert(`먼저 다음 문서를 생성해주세요:\n\n${missingNames}`);
      return;
    }

    // stale 부모 가드: 직계 부모가 outdated인데 자식을 먼저 재생성하면, 낡은 부모 본문이
    // 컨텍스트로 굳어버린다(silent overwrite). 경고 후 사용자가 결정(자동변경 0).
    if (!forceProceed && currentMeeting?.id) {
      const stale = getStaleParents(docType, documents, d => getDocStatus(currentMeeting.id, d));
      if (stale.length > 0) {
        setStaleGuard({ docType, parents: stale });
        return; // fetch race 차단 — 다이얼로그에서 '그래도 진행' 시 forceProceed=true로 재호출
      }
    }

    // 실패 시 정확 복원을 위해 진입 시점 상태를 스냅샷(outdated 하드코딩 금지).
    const prevStatus = currentMeeting?.id ? getDocStatus(currentMeeting.id, docType) : null;

    setIsSingleGenerating(true);
    try {
      // 의존 문서를 컨텍스트로 전달 (품질 향상)
      const contextDocs: Record<string, string> = {};
      for (const dep of (DEPENDENCIES[docType] || [])) {
        if (documents[dep]) contextDocs[dep] = documents[dep]!;
      }
      const response = await authedFetch('/api/generate-doc', {
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
          contextDocs,
          meetingId: currentMeeting.id,
        }),
      });

      if (!response.ok) throw new Error('문서 생성 실패');

      const { content } = await response.json();
      setDocuments(prev => ({ ...prev, [docType]: content }));
      updateCurrentMeeting({ [docTypeToField(docType)]: content });
      // 재생성 성공 → self latest + 버전++ + 하위 재전파 (outdated 배지 해소 + 그래프 연결)
      markRegenerated(docType, true);
      // 방금 갱신한 문서를 영향 배너 목록에서 제거
      setImpactedDocs(prev => prev.filter(d => d !== docType));
    } catch (error) {
      console.error('Doc generation error:', error);
      // 실패 → 진입 전 상태로 정확 복원. latest였던 문서가 실패로 거짓 outdated 강등되는 회귀 차단.
      if (currentMeeting?.id && prevStatus) {
        setDocStatus(currentMeeting.id, docType, prevStatus);
      }
    } finally {
      setIsSingleGenerating(false);
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

  const confirmGenerateAll = () => {
    setShowGenerateConfirm(false);
    setGenerateConfirmData(null);
    if (!currentMeeting?.summary) return;
    // 루프는 store에서 백그라운드로 실행됨 (PrdViewer 언마운트해도 지속). await 안 함.
    startGeneration();
  };


  // 파일명에서 경로 불가 문자 제거(개별 파일이 doc.title을 파일시스템에 노출).
  const sanitizeFilename = (s: string) =>
    s.replace(/\s+/g, '-').replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);

  // 선택 포맷의 Blob 생성(ZIP 묶기 공용). 포맷별 build 헬퍼 재사용.
  const buildBlobFor = async (format: ExportFormat, content: string): Promise<Blob> => {
    switch (format) {
      case 'md': return new Blob([content], { type: 'text/markdown' });
      case 'txt': return new Blob([content], { type: 'text/plain' });
      case 'docx': return buildDocxBlob(content);
      case 'xlsx': return buildXlsxBlob(content);
      case 'pptx': return buildPptxBlob(content);
      case 'pdf': return buildPdfBlob(content);
    }
  };

  // 생성된 전체 문서를 "각 문서별 개별 파일"로 만들어 ZIP으로 묶어 내보낸다.
  // 포맷: md/txt/pdf/docx/xlsx/pptx (개별 다운로드가 지원하는 전체 포맷).
  const handleDownloadAll = async (format: ExportFormat) => {
    if (!currentMeeting) return;
    const generatedDocs = DOCUMENTS.filter((doc) => documents[doc.key]);
    if (generatedDocs.length === 0) return;

    setExporting(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const safeTitle = sanitizeFilename(currentMeeting.title);
      const timestamp = new Date().toISOString().slice(0, 10);

      // 순차 처리: docx/pptx/pdf는 비동기 + mermaid 렌더 포함 → 동시 실행 시 충돌/부하.
      for (const doc of generatedDocs) {
        const content = documents[doc.key];
        if (!content) continue;
        try {
          const blob = await buildBlobFor(format, content);
          zip.file(`${sanitizeFilename(doc.title)}.${format}`, blob);
        } catch (e) {
          console.error(`${doc.title} ${format} 변환 실패(건너뜀):`, e);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${safeTitle}-전체문서-${format}-${timestamp}.zip`);
    } catch (e) {
      console.error('전체 내보내기 실패:', e);
      alert('전체 내보내기에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setExporting(false);
    }
  };

  // ── 다이어그램/이미지 확대 + 다운로드 라이트박스 오프너 ──
  const lightboxTs = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  // mermaid: 코드로 재렌더 표시 + PNG/SVG 다운로드
  const openMermaidLightbox = (title: string, code: string) => {
    if (!code?.trim()) return;
    setLightbox({
      title,
      body: <div className="max-w-full overflow-auto"><MermaidDiagram chart={code} id="lightbox" /></div>,
      actions: [
        {
          label: 'PNG',
          onClick: async () => {
            if (!(await downloadMermaidPng(code, `${sanitizeFilename(title)}-${lightboxTs()}.png`)))
              alert('PNG 변환에 실패했습니다. SVG로 시도해 주세요.');
          },
        },
        {
          label: 'SVG',
          onClick: async () => {
            if (!(await downloadMermaidSvg(code, `${sanitizeFilename(title)}-${lightboxTs()}.svg`)))
              alert('SVG 내보내기에 실패했습니다.');
          },
        },
      ],
    });
  };

  // HTML 뷰어(IA/와이어프레임/스토리보드/WBS/테스트계획): clone 확대 표시 + PNG 다운로드
  const openHtmlLightbox = (title: string, srcEl: HTMLElement) => {
    const clone = srcEl.cloneNode(true) as HTMLElement;
    setLightbox({
      title,
      body: (
        <div
          className="max-w-[88vw]"
          ref={(n) => { if (n && !n.firstChild) n.appendChild(clone); }}
        />
      ),
      actions: [
        {
          label: 'PNG',
          onClick: async () => {
            if (!(await downloadElementPng(srcEl, `${sanitizeFilename(title)}-${lightboxTs()}.png`)))
              alert('이미지 변환에 실패했습니다.');
          },
        },
      ],
    });
  };

  // 본문 일반 이미지: 확대 + 원본 다운로드
  const openImageLightbox = (src: string, alt: string) => {
    setLightbox({
      title: alt || '이미지',
      body: <img src={src} alt={alt} className="max-w-[88vw] max-h-[80vh] object-contain" />,
      actions: [{ label: '다운로드', onClick: async () => { await downloadImageOriginal(src, alt || 'image'); } }],
    });
  };

  const handleShare = async () => {
    if (!currentMeeting) return;

    // 최소 하나의 문서가 있는지 확인
    const hasDoc = Object.values(documents).some(d => d && d.trim().length > 0);
    if (!hasDoc) {
      alert('공유할 문서가 없습니다. 먼저 문서를 생성해주세요.');
      return;
    }

    setSharing(true);
    try {
      // 공유 생성은 로그인 사용자만 — 토큰 첨부 (AuthGate가 미로그인을 이미 차단하지만 안전 처리)
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(currentMeeting),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '공유 링크 생성 실패');
      }

      const { shareUrl } = await response.json();
      const fullUrl = `${window.location.origin}${shareUrl}`;

      await navigator.clipboard.writeText(fullUrl);
      setShowShareSuccess(true);
      setTimeout(() => setShowShareSuccess(false), 3000);
    } catch (error) {
      console.error('Share error:', error);
      alert(error instanceof Error ? error.message : '공유 링크 생성에 실패했습니다.');
    } finally {
      setSharing(false);
    }
  };

  // 문서 본문이 바뀐 뒤 공통으로 부르는 상태 갱신:
  // 자기 자신 latest + 버전++ (+ major면 하위 전파). 단일 재생성/편집 저장이 공유.
  const markRegenerated = (docType: DocType, propagate: boolean) => {
    if (!currentMeeting?.id) return;
    setDocStatus(currentMeeting.id, docType, 'latest');
    incrementDocVersion(currentMeeting.id, docType);
    if (propagate) {
      // 하위 문서들을 outdated로 표시 (frozen 제외는 store가 처리)
      markDependentsOutdated(currentMeeting.id, docType);
    }
  };

  // 실제 저장 수행. major=true면 하위 전파 + 영향 배너, 부모 모순 경고.
  const performSaveEdit = (major: boolean) => {
    const savedDoc = activeDoc;
    // 덮어쓰기 직전 기존 내용을 버전으로 보존 (수동 편집 이력)
    const prevContent = documents[savedDoc] ?? '';
    if (currentMeeting?.id && prevContent.trim() && prevContent !== editedContent) {
      recordDocVersion(currentMeeting.id, savedDoc, prevContent, 'manual-edit');
    }
    setDocuments(prev => ({ ...prev, [savedDoc]: editedContent }));
    updateCurrentMeeting({ [docTypeToField(savedDoc)]: editedContent });

    markRegenerated(savedDoc, major);

    if (major && currentMeeting?.id) {
      // 영향받은 하위 문서(존재하면서 frozen 아닌) 위상순서로 안내
      const order = DOCUMENTS.map(d => d.key);
      const affected = getAllDependents(savedDoc)
        .filter(d => documents[d] && getDocStatus(currentMeeting.id, d) === 'outdated')
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
      setImpactedDocs(affected);

      // 자식을 수정했으면 직계 부모와의 모순 가능성을 모달로 강하게 경고
      const parents = getDirectParentTitles(savedDoc);
      if (parents.length > 0) {
        setParentWarning({ docType: savedDoc, parents });
      }
    } else {
      setImpactedDocs([]);
    }

    setShowSaveConfirm(false);
    setIsEditing(false);
  };

  // 저장 버튼: 분기 선택 모달을 띄움
  const handleSaveEdit = () => {
    setShowSaveConfirm(true);
  };

  // 문서 네비게이션
  const handlePreviousDoc = () => {
    if (flatIndex > 0) {
      setActiveDoc(DOCUMENTS[flatIndex - 1].key);
    }
  };

  const handleNextDoc = () => {
    if (flatIndex < DOCUMENTS.length - 1) {
      const nextDoc = DOCUMENTS[flatIndex + 1];

      // 순차적 진행 모드 체크
      if (sequentialMode && !isDocCompleted(activeDoc)) {
        alert(`먼저 "${DOCUMENTS[flatIndex]?.title}" 문서를 완료해주세요.\n\n(문서 끝까지 스크롤하면 완료됩니다)`);
        return;
      }

      setActiveDoc(nextDoc.key);
    }
  };

  const handleCopy = async () => {
    if (!currentContent) return;
    await navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = async () => {
    if (!currentContent) return;
    // ★ mermaid 다이어그램 사전 래스터화 (인쇄 HTML에 <img>로 임베드)
    const diagrams = await prerenderMermaid(currentContent);
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
          h1 { font-size: 28px; color: #1e3a8a; border-bottom: 3px solid #2563eb; padding-bottom: 8px; }
          h2 { font-size: 22px; color: #1e40af; border-left: 5px solid #2563eb; padding-left: 12px; }
          h3 { font-size: 19px; color: #1f2937; }
          h4 { font-size: 17px; color: #374151; }
          h5 { font-size: 15px; }
          h6 { font-size: 14px; }
          ul, ol { margin: 12px 0; padding-left: 24px; }
          li { margin: 4px 0; }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 16px 0;
            box-shadow: 0 1px 3px rgba(0,0,0,.08);
          }
          th, td {
            border: 1px solid #d1d5db;
            padding: 8px 12px;
            text-align: left;
            font-size: 0.95em;
          }
          th, tr:first-child td {
            background-color: #2563eb;
            color: #ffffff;
            font-weight: 600;
          }
          tbody tr:nth-child(even) { background-color: #f9fafb; }
          .diagram { text-align: center; margin: 20px 0; page-break-inside: avoid; }
          .diagram img { max-width: 100%; height: auto; }
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
        ${contentToHtml(currentContent, diagrams)}
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    // 다이어그램 <img>(dataURL)가 모두 로드된 뒤 인쇄 (빈칸 방지)
    const doPrint = () => printWindow.print();
    const imgs = Array.from(printWindow.document.images);
    if (imgs.length === 0) {
      setTimeout(doPrint, 250);
    } else {
      Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.onload = () => res();
                img.onerror = () => res();
              })
        )
      ).then(() => setTimeout(doPrint, 150));
    }
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
        // PDF는 인쇄 다이얼로그 사용 (브라우저 네이티브 PDF 저장). mermaid 사전 렌더로 async.
        void handlePrint().catch((e) => console.error('PDF 내보내기 실패:', e));
        break;
      case 'docx':
        void downloadDocx(currentContent, `${baseName}.docx`).catch((e) => console.error('DOCX 실패:', e));
        break;
      case 'xlsx':
        downloadXlsx(currentContent, `${baseName}.xlsx`);
        break;
      case 'pptx':
        void downloadPptx(currentContent, `${baseName}.pptx`).catch((e) => console.error('PPTX 실패:', e));
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

  // build* 함수는 @/lib/exportFormatters로 이동. saveAs 래퍼들만 PrdViewer에 남김.
  const downloadDocx = async (content: string, filename: string) =>
    saveAs(await buildDocxBlob(content), filename);
  const downloadXlsx = (content: string, filename: string) =>
    saveAs(buildXlsxBlob(content), filename);

  const downloadPptx = async (content: string, filename: string) =>
    saveAs(await buildPptxBlob(content), filename);

  // 생성된 문서 수 계산
  const generatedCount = Object.values(documents).filter(Boolean).length;
  const totalCount = DOCUMENTS.length;

  return (
    <div className="relative">
      {/* 다이어그램/이미지 확대+다운로드 라이트박스 */}
      <MediaLightbox state={lightbox} onClose={() => setLightbox(null)} />
      {/* 햄버거 버튼 - 항상 표시 */}
      <button
        onClick={() => {
          setSidebarOpen(true);
          setTimeout(() => {
            if (treeRef.current) {
              treeRef.current.scrollTop = 0;
            }
          }, 100);
        }}
        className="fixed top-4 left-4 z-50 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
        aria-label="문서 목록 열기"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* 슬라이드 사이드바 - 항상 숨겨져 있음, 버튼으로만 열림 */}
      <div
        className={`
          fixed top-0 left-0 z-50 h-full w-80 max-w-[80vw]
          bg-white dark:bg-slate-900
          border-r border-slate-200 dark:border-slate-700
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* 사이드바 헤더 */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">문서 목록</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 문서 목록 영역 */}
        <div
          id="document-list-container"
          ref={treeRef}
          className="overflow-y-auto overflow-x-hidden"
          style={{ height: 'calc(100% - 60px)', minHeight: '400px' }}
        >
          {/* orientation="vertical" 필수: 없으면 Tabs 루트가 가로(flex-row)로 렌더되어
              세로 사이드바 항목들이 컨테이너 밖으로 밀려 상위 항목(PRD 등)이 잘림 */}
          <Tabs orientation="vertical" value={activeDoc} onValueChange={(v) => {
            const newDoc = v as DocType;
            const docIndex = DOCUMENTS.findIndex(d => d.key === newDoc);

            // 순차적 진행 모드 체크
            if (sequentialMode && docIndex > 0) {
              const prevDoc = DOCUMENTS[docIndex - 1];
              if (!isDocCompleted(prevDoc.key)) {
                alert(`먼저 "${prevDoc.title}" 문서를 완료해주세요.\n\n(문서 끝까지 스크롤하면 완료됩니다)`);
                return;
              }
            }

            setActiveDoc(newDoc);

            // 스크롤을 맨 위로 초기화
            setTimeout(() => {
              if (treeRef.current) {
                treeRef.current.scrollTop = 0;
              }
            }, 0);
          }}>
            <TabsList
              ref={tabsListRef}
              className="bg-transparent border-none p-0 h-auto flex flex-col items-start gap-0.5 rounded-none w-full"
              style={{ scrollBehavior: 'auto', overflowAnchor: 'none', scrollPaddingTop: 0 }}
            >
              {DOCUMENTS.map((doc) => {
                const hasDoc = !!documents[doc.key];
                const { canGenerate } = canGenerateDoc(doc.key, documents);
                const isDisabled = !hasDoc && !canGenerate;
                const isCompleted = isDocCompleted(doc.key);

                // 순차적 진행 모드에서 이전 문서 완료 체크
                const docIndex = DOCUMENTS.findIndex(d => d.key === doc.key);
                const prevDoc = docIndex > 0 ? DOCUMENTS[docIndex - 1] : null;
                const isPrevCompleted = !prevDoc || isDocCompleted(prevDoc.key);
                const isSequentiallyDisabled = sequentialMode && hasDoc && !isCompleted && !isPrevCompleted;

                return (
                  <TabsTrigger
                    key={doc.key}
                    value={doc.key}
                    className="gap-2 text-sm w-full justify-start px-3 py-2 h-auto rounded-md
                             text-slate-900 dark:text-slate-100
                             data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800
                             data-[state=active]:shadow-sm
                             hover:bg-slate-100 dark:hover:bg-slate-800
                             transition-all duration-150 ease-in-out
                             border border-transparent
                             data-[state=active]:border-slate-200 dark:data-[state=active]:border-slate-700
                             relative group
                             disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isDisabled || isSequentiallyDisabled}
                    onClick={() => {
                      // 순차적 진행 모드에서 이전 문서 완료 경고
                      if (sequentialMode && hasDoc && !isCompleted && !isPrevCompleted) {
                        alert(`먼저 "${prevDoc?.title}" 문서를 완료해주세요.\n\n(문서 끝까지 스크롤하면 완료됩니다)`);
                      }
                    }}
                  >
                    {/* 완료 상태 아이콘 */}
                    <span className="text-base flex-shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <span className="opacity-80 group-hover:opacity-100 transition-opacity">
                          {doc.icon}
                        </span>
                      )}
                    </span>
                    <span className={`truncate flex-1 text-left ${
                      isCompleted
                        ? 'text-green-700 dark:text-green-400 line-through opacity-70'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}>
                      {doc.title}
                    </span>

                    {/* 상태 표시 */}
                    <span className="ml-auto flex-shrink-0 flex items-center gap-1.5">
                      {/* 문서 상태 배지 */}
                      {currentMeeting?.id && (() => {
                        const status = getDocStatus(currentMeeting.id, doc.key);
                        if (status === 'outdated') {
                          return (
                            <span
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                              title="상위 문서가 수정되어 내용이 오래되었을 수 있어요. 이 문서를 열어 '재생성'하면 최신으로 갱신됩니다."
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              업데이트 필요
                            </span>
                          );
                        }
                        if (status === 'frozen') {
                          return (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
                              <Lock className="w-2.5 h-2.5" />
                              고정됨
                            </span>
                          );
                        }
                        if (status === 'regenerating') {
                          return (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              재생성 중
                            </span>
                          );
                        }
                        if (status === 'partial') {
                          return (
                            <span
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700"
                              title="일부 섹션이 생성되지 않았어요. 이 문서를 열어 '재생성'하면 다시 시도합니다."
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              일부 미완성
                            </span>
                          );
                        }
                        if (status === 'pending') {
                          // composite 핵심 완료 후 본문 없이 남은 문서(생성 칩).
                          // single에는 발생하지 않는다(회귀 0).
                          return (
                            <span
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700"
                              title="아직 생성되지 않았어요. 이 문서를 열어 '생성'을 누르면 만듭니다."
                            >
                              <Plus className="w-2.5 h-2.5" />
                              미생성
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {hasDoc && !isCompleted && (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                        </span>
                      )}
                      {isCompleted && (
                        <span className="text-green-500 text-xs">완료</span>
                      )}
                      {!hasDoc && !canGenerate && (
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                      )}
                    </span>
                  </TabsTrigger>
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
          <div className="flex flex-wrap items-center justify-between gap-y-2 gap-3 sm:gap-6 px-4 sm:px-6 py-3 pl-16 sm:pl-6">
            {/* 왼쪽: 문서 생성 현황 (모바일 숨김 — 햄버거 버튼 공간 + 플로팅 네비에 진행표시 있음) */}
            <div className="hidden md:flex items-center gap-4">
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

            {/* 중앙: 네비게이션 (이전/다음). 모바일은 화살표·제목 밀착(가운데 벌어짐 방지) */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <Button
                onClick={handlePreviousDoc}
                disabled={flatIndex === 0}
                variant="outline"
                size="sm"
                className="h-8 flex-shrink-0"
              >
                <ChevronLeft className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">이전</span>
              </Button>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 max-w-[120px] sm:min-w-[120px] text-center truncate">
                {doc?.title || activeDoc}
              </span>
              <Button
                onClick={handleNextDoc}
                disabled={flatIndex === DOCUMENTS.length - 1 || (sequentialMode && isDocCompleted(activeDoc) === false && !!currentContent)}
                variant="outline"
                size="sm"
                className="h-8 flex-shrink-0"
              >
                <span className="hidden sm:inline">다음</span>
                <ChevronRight className="w-4 h-4 sm:ml-1" />
              </Button>
            </div>

            {/* 오른쪽: 학습 설정 (모바일 숨김 — 좁은 화면에서 네비 우선) */}
            <div className="hidden lg:flex items-center gap-3 border-l border-slate-200 dark:border-slate-700 pl-4">
              {/* 순차적 진행 모드 토글 */}
              <button
                onClick={() => setSequentialMode(!sequentialMode)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  sequentialMode
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="순차적 진행: 이전 문서를 완료해야 다음 문서로 이동 가능"
              >
                <span className="text-xs">🔒</span>
                순차적 진행
              </button>

              {/* 자동 넘김 토글 */}
              <button
                onClick={() => {
                  const newValue = !autoAdvance;
                  setAutoAdvanceState(newValue);
                  setAutoAdvance(newValue);
                }}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  autoAdvance
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="자동 넘김: 문서를 다 읽으면 다음 문서로 자동 이동"
              >
                {autoAdvance ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                자동 넘김
              </button>

              {/* 문서 고정 토글 */}
              {currentMeeting?.id && (
                <button
                  onClick={() => {
                    const frozen = isDocFrozen(currentMeeting.id, activeDoc);
                    if (frozen) {
                      unfreezeDoc(currentMeeting.id, activeDoc);
                    } else {
                      freezeDoc(currentMeeting.id, activeDoc);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    isDocFrozen(currentMeeting.id, activeDoc)
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                  title={isDocFrozen(currentMeeting.id, activeDoc) ? "문서 고정 해제: AI가 이 문서를 수정하지 않음" : "문서 고정: AI가 이 문서를 덮어쓰지 않음"}
                >
                  {isDocFrozen(currentMeeting.id, activeDoc) ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  고정
                </button>
              )}
            </div>

            {/* 우측 액션 그룹 (모바일: 폭 초과 시 통째로 줄바꿈 → 버튼 잘림/밀림 방지) */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 ml-auto">
            {/* 전체 생성 버튼 (생성 중에는 취소 버튼으로 전환) */}
            {isGenerating ? (
              <Button
                onClick={cancelGeneration}
                size="sm"
                variant="destructive"
                className="h-8"
                title="전체 생성 취소"
              >
                <X className="w-4 h-4 mr-2" />
                취소 {generationProgress ? `(${generationProgress.completedDocs.length}/${generationProgress.totalLevels})` : ''}
              </Button>
            ) : (
              <Button
                onClick={handleGenerateAll}
                disabled={!currentMeeting?.summary}
                size="sm"
                className="h-8 flex-shrink-0"
              >
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">전체 생성</span>
              </Button>
            )}

            {/* 진행률 표시 (생성 중일 때) */}
            {generationProgress && generationProgress.status === 'generating' && (
              <div className="absolute -bottom-16 left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 shadow-lg z-40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {generationProgress.currentDoc ? `${generationProgress.currentDoc} 생성 중...` : '준비 중...'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {generationProgress.completedDocs.length} / {generationProgress.totalLevels}개 완료
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${(generationProgress.completedDocs.length / generationProgress.totalLevels) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* 취소 완료 안내 */}
            {generationProgress && generationProgress.status === 'cancelled' && (
              <div className="absolute -bottom-12 left-0 right-0 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-2.5 shadow-lg z-40">
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  생성 취소됨 · {generationProgress.completedDocs.length}개 저장됨
                </span>
              </div>
            )}

            {/* 공유 버튼 */}
            <Button
              onClick={handleShare}
              disabled={sharing || generatedCount === 0}
              title={generatedCount === 0 ? '생성된 문서가 없어 비활성화됨 — 먼저 문서를 생성하세요' : '문서 공유 링크 생성'}
              size="sm"
              variant="outline"
              className="h-8 flex-shrink-0"
            >
              {sharing ? (
                <>
                  <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
                  <span className="hidden sm:inline">생성 중...</span>
                </>
              ) : showShareSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 sm:mr-2 text-green-500" />
                  <span className="hidden sm:inline">링크 복사됨!</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">공유</span>
                </>
              )}
            </Button>

            {/* 모두 내보내기 (각 문서 개별파일 → ZIP, 포맷 선택) */}
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={exporting || generatedCount === 0}
                title={generatedCount === 0 ? '생성된 문서가 없어 비활성화됨 — 먼저 문서를 생성하세요' : '이 문서만 또는 전체를 내보내기'}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 px-3 flex-shrink-0"
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">{exporting ? '내보내는 중...' : '내보내기'}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
                {/* ① 이 문서만 — 현재 보고 있는 문서 1개 개별 다운로드 */}
                {currentContent && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                      이 문서만 · {DOCUMENTS.find(d => d.key === activeDoc)?.title || activeDoc}
                    </div>
                    <DropdownMenuItem onClick={() => handleDownload('pdf')}>
                      <File className="w-4 h-4 mr-2" /> PDF / 인쇄
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('docx')}>
                      <File className="w-4 h-4 mr-2" /> Word (.docx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('pptx')}>
                      <Presentation className="w-4 h-4 mr-2" /> PowerPoint (.pptx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('xlsx')}>
                      <File className="w-4 h-4 mr-2" /> Excel (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('md')}>
                      <File className="w-4 h-4 mr-2" /> Markdown (.md)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload('txt')}>
                      <File className="w-4 h-4 mr-2" /> 텍스트 (.txt)
                    </DropdownMenuItem>
                  </>
                )}
                {/* ② 전체 — 생성된 모든 문서를 개별 파일로 묶어 ZIP */}
                <div className="px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-700 mt-1 pt-2">
                  전체 문서 (ZIP) · {generatedCount}개
                </div>
                <DropdownMenuItem onClick={() => handleDownloadAll('pdf')}>
                  <File className="w-4 h-4 mr-2" /> PDF (.pdf) ZIP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadAll('docx')}>
                  <File className="w-4 h-4 mr-2" /> Word (.docx) ZIP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadAll('pptx')}>
                  <Presentation className="w-4 h-4 mr-2" /> PowerPoint (.pptx) ZIP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadAll('xlsx')}>
                  <File className="w-4 h-4 mr-2" /> Excel (.xlsx) ZIP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadAll('md')}>
                  <File className="w-4 h-4 mr-2" /> Markdown (.md) ZIP
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadAll('txt')}>
                  <File className="w-4 h-4 mr-2" /> 텍스트 (.txt) ZIP
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        </div>

        {/* 문서 컨텐츠 영역 */}
        <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4" ref={contentRef}>
        {/* 다이어그램 렌더 실패 → 재생성 유도 배너 */}
        {diagramBroken && (
          <Card className="rounded-lg ring-0 border border-red-200 bg-red-50 dark:border-red-700 dark:bg-red-900/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-800 dark:text-red-300">
                  다이어그램(아키텍처)이 깨졌어요.
                </p>
                <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                  AI가 만든 다이어그램 코드에 오류가 있어 그림으로 그려지지 않습니다. 이 문서를 다시 생성하면 새 다이어그램이 만들어집니다.
                </p>
                <Button
                  onClick={() => handleGenerateDoc(activeDoc)}
                  disabled={isSingleGenerating || isGenerating}
                  size="sm"
                  variant="outline"
                  className="mt-2 h-8 border-red-300 dark:border-red-600 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
                >
                  {isSingleGenerating ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-1" />
                  )}
                  이 문서 다시 생성
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* 저장 후 영향받은 하위 문서 안내 배너 */}
        {impactedDocs.length > 0 && (
          <Card className="rounded-lg ring-0 border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  이 변경으로 {impactedDocs.length}개 하위 문서가 영향을 받았습니다.
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  자동으로 바뀌지 않아요. 한 번에 순서대로 다시 만들거나, 아래에서 원하는 문서만 고르세요.
                </p>
                {/* 일괄: 순서대로 모두 갱신. 진행 표시는 GenerationGuard 전면 딤이 담당. */}
                <button
                  onClick={() => currentMeeting?.id && regenerateDocs(currentMeeting.id, impactedDocs)}
                  disabled={isSingleGenerating || isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 mt-2 rounded-md text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
                  title="영향받은 문서를 의존 순서대로 한 번에 다시 만들기"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  순서대로 모두 갱신 ({impactedDocs.length})
                </button>
                {/* 개별: 특정 문서만 골라 갱신 */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {impactedDocs.map(d => {
                    const t = DOCUMENTS.find(x => x.key === d)?.title || d;
                    return (
                      <button
                        key={d}
                        onClick={() => { setActiveDoc(d); handleGenerateDoc(d); }}
                        disabled={isSingleGenerating || isGenerating}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50"
                        title={`${t}만 지금 갱신`}
                      >
                        <Plus className="w-3 h-3" />
                        {t}
                      </button>
                    );
                  })}
                </div>
                {/* '현재 브라우저 기준' 1회 고지 (#10) */}
                {showScopeHint && (
                  <div className="flex items-start gap-1.5 mt-3 pt-2 border-t border-amber-200 dark:border-amber-700/50">
                    <p className="flex-1 text-[11px] text-amber-600 dark:text-amber-400/80">
                      표시(업데이트 필요·고정됨)는 지금 보는 브라우저 기준이에요. 문서 내용 자체는 로그인하면 기기 간 동기화됩니다.
                    </p>
                    <button
                      onClick={() => {
                        if (typeof window !== 'undefined') localStorage.setItem('madStatusScopeHintSeen', '1');
                        setShowScopeHint(false);
                      }}
                      className="text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:underline flex-shrink-0"
                    >
                      확인
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setImpactedDocs([])}
                className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 flex-shrink-0"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </Card>
        )}
        {/* 자식 수정 → 상위(부모) 모순 가능성 안내 (비-blocking 인라인, 영향배너와 독립 dismiss) (#8) */}
        {parentWarning && (
          <Card className="rounded-lg ring-0 border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 p-3">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 text-blue-500 dark:text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  상위 문서와 어긋날 수 있어요
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  방금 수정한 내용이 아래 상위 문서와 맞지 않을 수 있어요. 자동으로 바꾸지 않으니 직접 확인해 주세요.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {parentWarning.parents.map(p => {
                    const key = DOCUMENTS.find(d => d.title === p)?.key;
                    return (
                      <button
                        key={p}
                        onClick={() => { if (key) setActiveDoc(key); }}
                        className="px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600"
                        title={`${p} 열기`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => setParentWarning(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0"
                title="닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </Card>
        )}
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
                {/* outdated 상단 배너 (#12): 진입 시 자동 모달 없이 조용히 안내 + 직계 부모명.
                    클릭 전엔 아무것도 재생성/변경하지 않음. */}
                {docHasContent && currentMeeting?.id && getDocStatus(currentMeeting.id, doc.key) === 'outdated' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                          이 문서는 업데이트가 필요해요
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                          {getDirectParentTitles(doc.key).length > 0
                            ? `상위 문서(${getDirectParentTitles(doc.key).join('·')})에서 파생된 문서예요. 상위가 바뀌어 내용이 오래됐을 수 있어요.`
                            : '상위 문서가 바뀌어 내용이 오래됐을 수 있어요.'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleGenerateDoc(doc.key)}
                        disabled={isSingleGenerating || isGenerating}
                        className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        지금 갱신
                      </Button>
                    </div>
                  </div>
                )}

                {/* frozen 전파 제외 노트 (#9): frozen 문서에만 침묵 사실 1줄 고지 */}
                {docHasContent && currentMeeting?.id && isDocFrozen(currentMeeting.id, doc.key) && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30 p-2.5">
                    <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                      이 문서는 AI 자동수정에서 제외돼요. 상위가 바뀌어도 &lsquo;업데이트 필요&rsquo; 표시가 자동으로 뜨지 않습니다.
                    </p>
                  </div>
                )}

                {/* 문서 완료 상태 표시 */}
                {docHasContent && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                    isDocCompleted(doc.key)
                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                      : scrollAtBottom
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 animate-pulse'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                  }`}>
                    {isDocCompleted(doc.key) ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        이 문서를 완료했습니다
                      </>
                    ) : scrollAtBottom ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        문서 완료! {autoAdvance ? '다음 문서로 자동 이동합니다...' : '다음 문서로 이동하세요'}
                      </>
                    ) : (
                      <>
                        <Circle className="w-4 h-4" />
                        문서 끝까지 스크롤하여 완료하세요
                      </>
                    )}
                  </div>
                )}

                {/* 문서 헤더 */}
                <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <span className="text-2xl flex-shrink-0">{doc.icon}</span>
                        <span className="truncate">{doc.title}</span>
                        {isDocCompleted(doc.key) && (
                          <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                        )}
                      </CardTitle>
                      <p className="text-sm text-slate-500 mt-1">{doc.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                      {docHasContent ? (
                        <>
                          {/* 보조 아이콘 액션(복사·인쇄) 한 묶음 */}
                          <div className="inline-flex rounded-md border divide-x">
                            <Button onClick={handleCopy} variant="ghost" size="sm" className="rounded-none" title="복사">
                              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                            <Button onClick={() => void handlePrint()} variant="ghost" size="sm" className="rounded-none" title="인쇄">
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
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
                          {!docIsEditing && (
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
                          disabled={isGenerating || isSingleGenerating}
                          variant="outline"
                          size="sm"
                          title="다시 생성"
                        >
                          {isSingleGenerating ? (
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
                        onClick={() => {
                          // pending(composite 핵심 완료 후 본문 없이 남은 문서)은 regenerateDocs 경유.
                          // single은 status가 'pending'이 될 수 없어 이 분기를 타지 않는다(회귀 0).
                          const isPending = !!currentMeeting?.id
                            && getDocStatus(currentMeeting.id, doc.key) === 'pending';
                          if (isPending && currentMeeting?.id) {
                            void regenerateDocs(currentMeeting.id, [doc.key]);
                          } else {
                            void handleGenerateDoc(doc.key);
                          }
                        }}
                        disabled={isGenerating || isSingleGenerating}
                        size="sm"
                      >
                        {isSingleGenerating ? (
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
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-b-lg shadow-lg border border-slate-200 dark:border-slate-700 px-3 sm:px-4 py-2 mb-4 -mx-4">
                  <Button
                    onClick={handlePreviousDoc}
                    disabled={flatIndex === 0}
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-8 rounded-full flex-shrink-0"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">이전</span>
                  </Button>
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 px-1 sm:px-3">
                    <span className="text-sm flex-shrink-0">
                      {DOCUMENTS[flatIndex]?.icon}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
                      {flatIndex + 1}/{DOCUMENTS.length}
                    </span>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                      {DOCUMENTS[flatIndex]?.title}
                    </span>
                  </div>
                  <Button
                    onClick={handleNextDoc}
                    disabled={flatIndex === DOCUMENTS.length - 1 || (sequentialMode && isDocCompleted(activeDoc) === false && !!currentContent)}
                    variant="ghost"
                    size="sm"
                    className="gap-1 h-8 rounded-full flex-shrink-0"
                  >
                    <span className="hidden sm:inline">다음</span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                {/* 상단 여백 (플로팅 버튼 공간 확보) */}
                <div className="h-16"></div>

                {isEditing ? (
                <Card>
                  <CardContent className="py-4 sm:py-6">
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
                  <CardContent className="py-4 sm:py-6">
                    {activeDoc === 'ia' && (
                      <ZoomBox title="정보 구조도(IA)" onZoom={(el) => openHtmlLightbox('정보 구조도(IA)', el)}>
                        <ScreenDiagram content={docContent} type="ia" />
                      </ZoomBox>
                    )}
                    {activeDoc === 'flowchart' && (
                      !docContent.trim() ? (
                        <div className="text-center p-4 sm:p-8 text-slate-500 dark:text-slate-400">
                          <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p className="mb-2">아직 플로우차트 문서가 생성되지 않았습니다.</p>
                          <p className="text-sm">먼저 문서를 생성해주세요.</p>
                        </div>
                      ) : (
                        <ZoomBox title="플로우차트" onZoom={() => openMermaidLightbox('플로우차트', extractMermaidCode(docContent))}>
                          <MermaidDiagram
                            chart={extractMermaidCode(docContent)}
                            onRenderError={() => setDiagramBroken(true)}
                            onRenderSuccess={() => setDiagramBroken(false)}
                          />
                        </ZoomBox>
                      )
                    )}
                    {activeDoc === 'wireframe' && (
                      <ZoomBox title="화면 구성도" onZoom={(el) => openHtmlLightbox('화면 구성도', el)}>
                        <ScreenDiagram content={docContent} type="wireframe" />
                      </ZoomBox>
                    )}
                    {activeDoc === 'storyboard' && (
                      <ZoomBox title="스토리보드" onZoom={(el) => openHtmlLightbox('스토리보드', el)}>
                        <StoryboardViewer content={docContent} />
                      </ZoomBox>
                    )}
                    {activeDoc === 'test-plan' && (
                      <ZoomBox title="테스트 계획" onZoom={(el) => openHtmlLightbox('테스트 계획', el)}>
                        <TestPlanViewer content={docContent} />
                      </ZoomBox>
                    )}
                    {activeDoc === 'wbs' && (
                      <ZoomBox title="WBS" onZoom={(el) => openHtmlLightbox('WBS', el)}>
                        <WBSViewer content={docContent} />
                      </ZoomBox>
                    )}
                    {NO_VISUAL.includes(activeDoc) && (
                      <div className="text-center p-4 sm:p-8 text-slate-500 dark:text-slate-400">
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
                  <CardContent className="py-4 sm:py-6">
                    <div className="document-preview max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-lg shadow-inner p-4 sm:p-8" style={{ fontFamily: "'NanumGothic', Arial, sans-serif" }}>
                      <ReactMarkdown
                        // singleTilde:false → 물결 1개(~)는 일반 텍스트로 처리.
                        // 한 단락/표셀에 '단어~단어' 범위표현이 2회 이상이면(예: '기간 1~2주, 인원 5~10명')
                        // 그 사이가 취소선으로 오인되던 문제 방지. 의도된 ~~취소선~~(2개)은 그대로 유지.
                        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
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
                              let codeContent = String(children).replace(/\n$/, '');
                              // HTML 엔티티를 원래 기호로 변환
                              codeContent = codeContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/--&gt;/g, '-->');
                              return (
                                <ZoomBox key={node?.position?.start?.line?.toString()} title="다이어그램" onZoom={() => openMermaidLightbox('다이어그램', codeContent)}>
                                  <MermaidDiagram chart={codeContent} onRenderError={() => setDiagramBroken(true)} />
                                </ZoomBox>
                              );
                            }
                            const isInline = !className;
                            return isInline ? (
                              <code className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-sm font-mono text-pink-600 dark:text-pink-400">{children}</code>
                            ) : (
                              <code className={className}>{children}</code>
                            );
                          },
                          pre: ({ children }) => {
                            // mermaid인 경우 이미 처리했으므로 건너뜀
                            const childArray = Array.isArray(children) ? children : [children];
                            const codeChild = childArray.find((c): c is { type: string; props: { className?: string } } =>
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
                          img: ({ src, alt }) => {
                            if (!src || typeof src !== 'string') return null;
                            return (
                              <img
                                src={src}
                                alt={alt ?? ''}
                                loading="lazy"
                                className="max-w-full rounded-lg border border-slate-200 dark:border-slate-700 cursor-zoom-in my-4"
                                onClick={() => openImageLightbox(src, alt ?? '이미지')}
                              />
                            );
                          },
                        }}
                      >
                        {sanitizeHtml(docContent)}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-4 sm:py-6">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {docContent}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </>
            ) : (
              <Card>
                <CardContent className="text-center py-12 sm:py-16">
                  <div className="text-6xl mb-4">{doc.icon}</div>
                  <h3 className="text-lg font-medium mb-2">{doc.title} 문서</h3>
                  <p className="text-slate-500 mb-6">{doc.description}</p>
                  <Button
                    onClick={() => handleGenerateDoc(doc.key)}
                    disabled={isGenerating || isSingleGenerating || !currentMeeting?.summary}
                  >
                    {isSingleGenerating ? (
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
                  ? `모든 문서(14개 전체)를 다시 생성하시겠습니까?`
                  : `첫 번째 문서부터 시작하여 의존성에 따라\n최대 14개의 문서를 자동으로 생성합니다.\n\n생성 가능: ${generateConfirmData.count}개 → 연속 생성으로 완료`
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

      {/* 수정모드 저장 분기: 사소 수정 / 주요 변경 */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>변경 내용을 저장할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block mb-2">
                <strong>주요 변경</strong>: 내용이 의미 있게 바뀌었어요. 이 문서에서 파생된 하위 문서에 &lsquo;업데이트 필요&rsquo; 표시가 떠요.
              </span>
              <span className="block">
                <strong>사소 수정</strong>: 오타·표현 등 가벼운 수정이에요. 하위 문서는 그대로 둬요.
              </span>
              <span className="block mt-2 text-slate-500 dark:text-slate-400">
                잘 모르겠으면 주요 변경을 고르세요. 하위 문서는 자동으로 바뀌지 않고 &lsquo;업데이트 필요&rsquo; 표시만 떠요.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="outline" onClick={() => performSaveEdit(false)}>
              사소 수정
            </Button>
            <AlertDialogAction onClick={() => performSaveEdit(true)}>
              주요 변경
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 단일 재생성 시 상위(부모) 문서가 '업데이트 필요'(stale)일 때 경고 (#7) */}
      <AlertDialog open={!!staleGuard} onOpenChange={(open) => { if (!open) setStaleGuard(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>상위 문서가 아직 오래된 상태예요</AlertDialogTitle>
            <AlertDialogDescription>
              이 문서가 참고하는 상위 문서에 &lsquo;업데이트 필요&rsquo;가 떠 있어요. 지금 이 문서를 만들면 오래된 상위 내용이 그대로 반영될 수 있습니다. 상위 문서를 먼저 갱신하는 걸 권장해요.
              <span className="mt-3 block font-medium text-slate-700 dark:text-slate-200">
                {staleGuard?.parents.map(p => DOCUMENTS.find(d => d.key === p)?.title || p).join(', ')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const first = staleGuard?.parents[0];
                setStaleGuard(null);
                if (first) setActiveDoc(first); // 상위 문서로 이동만(자동 갱신 안 함)
              }}
            >
              상위 먼저 보기
            </Button>
            <AlertDialogAction
              onClick={() => {
                const dt = staleGuard?.docType;
                setStaleGuard(null);
                if (dt) handleGenerateDoc(dt, true); // 그래도 진행
              }}
            >
              그래도 진행
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default PrdViewer;
