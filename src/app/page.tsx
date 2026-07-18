'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Play, Upload, FileText, Download, FileUp, Layers, Plus, CreditCard, RefreshCw, Trash2, FolderOpen, Pencil } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useProgressSimulation } from '@/hooks/useProgressSimulation';
import { useMeetingStore } from '@/store/meetingStore';
import { MeetingStep } from '@/types';
import { FILE_ACCEPT_TYPES, SHOW_FILE_LIMIT_HINT, MAX_FILE_SIZE_BYTES, MAX_DURATION_HOURS } from '@/lib/inputRouter';
import { useBrowserSTT } from '@/hooks/useBrowserSTT';
import { ingestFile } from '@/lib/ingestFile';
import MeetingRecorder from '@/components/MeetingRecorder';
import TranscriptViewer from '@/components/TranscriptViewer';
import SummaryViewer from '@/components/SummaryViewer';
import PrdViewer from '@/components/PrdViewer';
import { TextInput } from '@/components/TextInput';
import DocAssistant from '@/components/DocAssistant';
import { MeetingNotePanel } from '@/components/MeetingNotePanel';
import { PageContainer } from '@/components/layout/PageContainer';
import { DateFormat } from '@/components/DateFormat';

export default function Home() {
  const currentMeeting = useMeetingStore(s => s.currentMeeting);
  const currentStep = useMeetingStore(s => s.currentStep);
  const syncFromServer = useMeetingStore(s => s.syncFromServer);
  const isSyncing = useMeetingStore(s => s.isSyncing);
  // composite Project 진입점(② 기획서 탭 하단). 합성 결과 기획서 세트 목록.
  // hotfix(도현): 합성 Project는 meetings[]에 평탄화 동기화돼 DB 영속됨.
  // selector에서 filter(새 배열 반환)하지 않고 meetings 통째로 받아 컴포넌트 본문에서 filter
  // (zustand 기본 selector가 Object.is 비교 — 인라인 filter는 무한 리렌더 위험).
  const meetings = useMeetingStore(s => s.meetings);
  const { createMeeting, updateCurrentMeeting, updateMeetingStep, setCurrentMeeting, deleteMeeting, setMeetings } = useMeetingStore();
  // C안 어댑터 — composite Project를 currentMeeting으로 주입(PrdViewer 회귀 0).
  const openCompositeProject = useMeetingStore((s) => s.openCompositeProject);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [mounted, setMounted] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 홈 최상위 2탭 — 기본 notes(① 회의록). 오너 확정: 합성 탭 제거, 2탭(① 회의록 / ② 기획서).
  // 합성은 ① 회의록 안 흡수(MeetingNotePanel). 합성 완료 시 onSynthesisComplete → ② 기획서로.
  const [topTab, setTopTab] = useState<'notes' | 'meetings'>('notes');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 진행률 시뮬레이션 훅 사용
  const { progress: uploadProgress, startSimulation, stopSimulation, resetSimulation } = useProgressSimulation(200, 15, 90);
  // 서버 STT(키) 없을 때 브라우저 무료 STT(transformers.js) 폴백
  const browserSTT = useBrowserSTT();

  useEffect(() => {
    setMounted(true);
  }, []);

  // 페이지 이탈 방지 훅 사용
  useBeforeUnload(uploading, '파일 처리 중입니다. 페이지를 나가시면 처리가 취소됩니다.');

  const handleTabChange = (value: string) => {
    if (currentMeeting) {
      updateMeetingStep(value as MeetingStep);
    }
  };

  const handleStartMeeting = () => {
    const title = meetingTitle.trim() || `회의 #${Date.now()}`;
    createMeeting(title);
    setMeetingTitle('');
  };

  // 텍스트 입력 탭 제출 핸들러 — record/upload 패턴과 대칭.
  // TextInput onResult로 텍스트만 위로 받아, createMeeting(title) 선행 후 updateCurrentMeeting.
  // currentMeeting 없이 TextInput이 updateCurrentMeeting을 직접 부르면 빈 회의가 만들어지지 않는 함정 방어.
  const handleTextSubmit = (payload: { text: string }) => {
    const title = meetingTitle.trim() || `회의 #${Date.now()}`;
    createMeeting(title);
    setMeetingTitle('');
    updateCurrentMeeting({ transcript: payload.text });
    updateMeetingStep('transcribing');
  };

  const [uploadError, setUploadError] = useState('');

  const [showNewMeetingConfirm, setShowNewMeetingConfirm] = useState(false);
  // composite Project 진입 완화 다이얼로그 — ② 진행 중(currentMeeting 미완료) 단일회의 작업이 있을 때,
  // openCompositeProject가 currentMeeting을 덮어쓰기 전에 사용자 확인.
  // 돌이킬 수 없는 건 아님: persist partialize로 저장된 데이터는 유지(화면만 전환).
  const [pendingCompositeId, setPendingCompositeId] = useState<string | null>(null);
  // "내 문서" 모달 — 헤더 버튼으로 오픈. 기존 회의(단일/합성) 카드 목록을 팝업으로 표시.
  const [showDocsModal, setShowDocsModal] = useState(false);
  // 삭제 undo — 도현 설계(pendingDelete 방식, sonner 없이 인라인 배너).
  // 삭제 클릭 → meetings[]에서 즉시 제거(UI) + 5초 카운트다운 배너. 취소 시 복원, 5초 후 deleteMeeting(본체) 확정.
  // 주의: store의 deleteMeeting 본문은 그대로 두고(cutScope), 지연/취소 로직은 page.tsx 레벨에서.
  // 타이머 핸들은 state가 아닌 ref로 보관(re-render 유발 방지 + cleanup 단순화).
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    meeting: typeof meetings[number];
    remaining: number;
  } | null>(null);
  // 진행 화면 title 인라인 편집 — 도현 설계(Pencil 버튼 → input 토글 → updateCurrentMeeting).
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // composite Project 보기 진입 래퍼 — currentMeeting이 진행 중(미완료)이면 다이얼로그로 확인,
  // 아니면(null/완료) 바로 openCompositeProject + ② 기획서 탭으로.
  const handleViewComposite = (projectId: string) => {
    const inProgress = !!currentMeeting && currentStep !== 'done';
    if (inProgress) {
      setPendingCompositeId(projectId);
      return;
    }
    openCompositeProject(projectId);
    setTopTab('meetings');
  };

  // 삭제 undo — "내 문서" 모달의 삭제 버튼이 부르는 진입점.
  // meetings[]에서 즉시 제거(UI 반영) + 5초 카운트다운 배너. tombstone/DB 삭제는 5초 후 deleteMeeting(본체)이 담당.
  const PENDING_DELETE_MS = 5000;
  const handlePendingDelete = (id: string) => {
    const meeting = meetings.find((m) => m.id === id);
    if (!meeting) return;
    // 이미 진행 중인 pending 삭제가 있으면 타이머 정리(이전 삭제는 그냥 사라짐 — 드문 케이스).
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
    }
    // UI에서 즉시 제거. currentMeeting이 대상이면 진행 화면도 닫아 잔상 방지.
    setMeetings(meetings.filter((m) => m.id !== id));
    if (currentMeeting?.id === id) {
      setCurrentMeeting(null);
    }
    pendingDeleteTimerRef.current = setTimeout(() => {
      // 5초 후 확정 — deleteMeeting 본체가 tombstone + clearChatMessages + deleteMeetingRow(DB) 처리.
      deleteMeeting(id);
      pendingDeleteTimerRef.current = null;
      setPendingDelete(null);
    }, PENDING_DELETE_MS);
    setPendingDelete({ id, meeting, remaining: 5 });
  };

  const cancelPendingDelete = () => {
    if (!pendingDelete) return;
    if (pendingDeleteTimerRef.current) {
      clearTimeout(pendingDeleteTimerRef.current);
      pendingDeleteTimerRef.current = null;
    }
    // meetings[]에 복원.
    setMeetings([...meetings, pendingDelete.meeting]);
    setPendingDelete(null);
  };

  // 매초 카운트다운 표시 갱신. pendingDelete가 있을 때만 동작.
  const pendingDeleteId = pendingDelete?.id;
  useEffect(() => {
    if (!pendingDeleteId) return;
    const interval = setInterval(() => {
      setPendingDelete((cur) => {
        if (!cur) return cur;
        const next = cur.remaining - 1;
        return next <= 0 ? cur : { ...cur, remaining: next };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingDeleteId]); // id가 바뀔 때만 재구독(remaining 변화엔 재생성 X).

  // 컴포넌트 언마운트 시 타이머 누수 방지.
  useEffect(() => {
    return () => {
      if (pendingDeleteTimerRef.current) {
        clearTimeout(pendingDeleteTimerRef.current);
        pendingDeleteTimerRef.current = null;
      }
    };
  }, []);

  // title 인라인 편집 시작 — 진행 화면 CardTitle 옆 Pencil 버튼이 호출.
  const startEditTitle = () => {
    if (!currentMeeting) return;
    setTitleDraft(currentMeeting.title);
    setEditingTitle(true);
  };
  const commitEditTitle = () => {
    const trimmed = titleDraft.trim();
    if (currentMeeting && trimmed && trimmed !== currentMeeting.title) {
      updateCurrentMeeting({ title: trimmed });
    }
    setEditingTitle(false);
  };
  const cancelEditTitle = () => {
    setEditingTitle(false);
  };

  const handleFileUpload = async (file: File) => {
    setUploadError('');
    setUploading(true);
    resetSimulation();
    startSimulation();

    const title = meetingTitle.trim() || file.name.replace(/\.[^/.]+$/, '');

    try {
      const result = await ingestFile(file, {
        browserTranscribe: (b, lang) => browserSTT.transcribeBlob(b, lang),
        browserError: browserSTT.error,
      });
      stopSimulation();

      createMeeting(title);
      setMeetingTitle('');
      updateCurrentMeeting({
        transcript: result.text,
        ...(result.segments ? { transcriptSegments: result.segments } : {}),
        ...(result.duration ? { duration: result.duration } : {}),
        ...(result.audioObjectUrl ? { audioUrl: result.audioObjectUrl } : {}),
      });
      updateMeetingStep('transcribing');
    } catch (error) {
      console.error('File upload error:', error);
      setUploadError(error instanceof Error ? error.message : '파일 처리에 실패했습니다.');
    } finally {
      stopSimulation();
      setUploading(false);
    }
  };

  const steps = [
    { id: 'idle', label: '대기', icon: Mic },
    { id: 'recording', label: '녹음', icon: Play },
    { id: 'transcribing', label: '변환', icon: Upload },
    { id: 'summarizing', label: '요약', icon: FileText },
    { id: 'done', label: '완료', icon: Download },
  ] as const;

  const getCurrentStepIndex = () => {
    return steps.findIndex((s) => s.id === currentStep);
  };

  const isTabDisabled = (stepValue: string) => {
    if (!currentMeeting) return true;

    // 실제 데이터 존재 여부를 기준으로 판단 (단계 기반 + 데이터 기반)
    const hasRecording = !!currentMeeting.audioUrl;
    const hasTranscript = !!currentMeeting.transcript?.trim();
    const hasSummary = !!currentMeeting.summary;
    const hasDocuments = !!currentMeeting.prd || !!currentMeeting.userStory ||
                        !!currentMeeting.featureList || !!currentMeeting.screenList ||
                        !!currentMeeting.apiSpec || !!currentMeeting.wireframe ||
                        !!currentMeeting.storyboard || !!currentMeeting.testPlan ||
                        !!currentMeeting.testCase || !!currentMeeting.database ||
                        !!currentMeeting.wbs || !!currentMeeting.deployment ||
                        !!currentMeeting.flowchart || !!currentMeeting.ia;

    switch (stepValue) {
      case 'recording':
        return false; // 항상 활성화
      case 'transcribing':
        return !hasRecording && !hasTranscript && !hasSummary && !hasDocuments;
      case 'summarizing':
        return !hasTranscript && !hasSummary && !hasDocuments;
      case 'done':
        return !hasSummary && !hasDocuments;
      default:
        return true;
    }
  };

  // Hydration 방지 - 클라이언트 마운트 전까지 로딩 표시
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-900">
      <PageContainer width="default" className="py-6 sm:py-8">
        {/* 헤더 */}
        <header className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <div className="text-center sm:text-left flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-1 sm:mb-2">
                MeetingAutoDocs
              </h1>
              <p className="text-xs sm:text-sm md:text-base text-muted-foreground">
                회의 녹음 → 요약 → 기획 문서 자동 생성
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 shrink-0">
              {currentMeeting && (
                <Button
                  onClick={() => {
                    if (confirm('새 회의를 시작하시겠습니까? 현재 회의는 저장됩니다.')) {
                      setCurrentMeeting(null);
                    }
                  }}
                  variant="default"
                  size="sm"
                  className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5"
                  aria-label="새 회의 시작"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden xs:inline">새 회의</span>
                </Button>
              )}
              <Button
                onClick={() => { void syncFromServer(); }}
                disabled={isSyncing}
                variant="outline"
                size="sm"
                className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5"
                aria-label="서버에서 최신 데이터 동기화"
                title="다른 기기의 변경사항을 받아옵니다"
              >
                <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span className="hidden xs:inline">{isSyncing ? '동기화 중' : '동기화'}</span>
              </Button>
              <Link
                href="/pricing"
                aria-label="요금제 보기"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5'
                )}
              >
                <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                <span className="hidden xs:inline">요금제</span>
              </Link>
              <Button
                onClick={() => setShowDocsModal(true)}
                variant="outline"
                size="sm"
                className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5"
                aria-label="내 문서 보기"
              >
                <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                <span className="hidden xs:inline">내 문서</span>
              </Button>
            </div>
          </div>
        </header>

        {/* 삭제 undo 인라인 배너 — pendingDelete가 있을 때만 표시. sonner(토스트) 없이 Alert 재사용(도현 설계). */}
        {pendingDelete && (
          <Alert className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-amber-900 dark:text-amber-100">
                회의 &quot;{pendingDelete.meeting.title}&quot;이(가) 삭제되었습니다.
                <span className="text-amber-700 dark:text-amber-300 ml-1">({pendingDelete.remaining}초 후 영구 삭제)</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={cancelPendingDelete}
                className="h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                취소
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* 홈 최상위 2탭 — 오너 확정(합성 탭 제거). 합성은 ① 회의록 안에서 자체 완결 후 ② 기획서로.
            ① 회의록(MeetingNotePanel + 다중 선택 합성) / ② 기획서(기존 단일회의 흐름 100% 보존) */}
        <Tabs value={topTab} onValueChange={(v) => setTopTab(v as 'notes' | 'meetings')} className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-auto p-1 mb-6">
            <TabsTrigger value="notes" className="gap-1.5">
              <Mic className="w-4 h-4" aria-hidden="true" />
              회의록
            </TabsTrigger>
            <TabsTrigger value="meetings" className="gap-1.5">
              <FileText className="w-4 h-4" aria-hidden="true" />
              기획서
            </TabsTrigger>
          </TabsList>

          {/* ① 회의록 탭 — MeetingNote(회의록) 전용 패널. 다중 선택 합성 흡수.
              B안: 합성 완료 시 자동 탭 전환 X — 녹색 완료 카드에서 "기획서 탭에서 보기"로 이동. */}
          <TabsContent value="notes">
            <MeetingNotePanel
              onViewComposite={(projectId) => handleViewComposite(projectId)}
            />
          </TabsContent>

          {/* ② 기획서 탭 — 기존 단일회의 진행 흐름 100% 보존 (회귀 0) */}
          <TabsContent value="meetings">
        {/* 단계 진행 바 */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-1 sm:gap-2 mb-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isPast = getCurrentStepIndex() > index;

              return (
                <div key={step.id} className="flex flex-col items-center flex-1 min-w-0">
                  <div
                    className={`
                      w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center mb-1 sm:mb-1.5 md:mb-2 transition-all shrink-0
                      ${isActive ? 'bg-blue-500 text-white scale-105 sm:scale-110 shadow-lg shadow-blue-500/30' : ''}
                      ${isPast ? 'bg-green-500 text-white' : ''}
                      ${!isActive && !isPast ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' : ''}
                    `}
                  >
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5" />
                  </div>
                  <span className={`text-[10px] xs:text-xs sm:text-sm font-medium truncate w-full text-center ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
          <Progress value={(getCurrentStepIndex() / (steps.length - 1)) * 100} className="h-2" aria-label="회의 진행률" />
        </div>

        {/* 메인 콘텐츠 */}
        {!currentMeeting ? (
          /* 새 회의 시작 카드. 기존 회의/합성 카드는 헤더 "내 문서" 모달로 이동. */
          <Card className="max-w-lg mx-auto shadow-lg border-slate-200 dark:border-slate-700">
            <CardHeader className="pb-4 sm:pb-6">
              <CardTitle className="text-lg sm:text-xl">새 회의 시작</CardTitle>
              <CardDescription className="text-sm">녹음 또는 파일 업로드로 회의를 시작하세요</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-6 pt-2 sm:pt-0">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  회의 제목 (선택사항)
                </label>
                <Input
                  type="text"
                  placeholder="회의 제목을 입력하세요"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  className="h-11"
                  id="meeting-title"
                  aria-label="회의 제목"
                />
              </div>

              <Tabs defaultValue="record" className="w-full">
                <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                  <TabsTrigger value="record" className="gap-2">
                    <Mic className="w-4 h-4" />
                    녹음 시작
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-2">
                    <FileUp className="w-4 h-4" />
                    파일 업로드
                  </TabsTrigger>
                  <TabsTrigger value="text" className="gap-2">
                    <FileText className="w-4 h-4" />
                    텍스트 입력
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="record" className="mt-6 space-y-4">
                  <Button onClick={handleStartMeeting} className="w-full h-12 text-base" size="lg">
                    <Mic className="w-5 h-5 mr-2" />
                    회의 시작하기
                  </Button>
                  <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                    마이크로 실시간 녹음 (Safari 권장)
                  </p>
                </TabsContent>

                <TabsContent value="upload" className="mt-6 space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={FILE_ACCEPT_TYPES}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    disabled={uploading}
                    className="hidden"
                    id="quick-file-upload"
                  />
                  <label htmlFor="quick-file-upload">
                    <Button
                      type="button"
                      disabled={uploading}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById('quick-file-upload')?.click();
                      }}
                      className="w-full h-12 text-base"
                      size="lg"
                    >
                      {uploading ? '처리 중...' : <><Upload className="w-5 h-5 mr-2" />파일 선택</>}
                    </Button>
                  </label>
                  <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                    지원: 음성(MP3·WAV·M4A·WebM·OGG·FLAC·AAC), 문서(TXT·MD·PDF·DOCX·XLSX)
                  </p>
                  {SHOW_FILE_LIMIT_HINT && (
                    <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                      최대 {MAX_FILE_SIZE_BYTES / 1024 / 1024 / 1024}GB / {MAX_DURATION_HOURS}시간 (음성)
                    </p>
                  )}

                  {uploading && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">
                          {browserSTT.isTranscribing ? '브라우저 음성 변환 중...' : '파일 처리 중...'}
                        </span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{Math.max(uploadProgress, browserSTT.progress)}%</span>
                      </div>
                      <Progress value={Math.max(uploadProgress, browserSTT.progress)} className="h-2" />
                      {browserSTT.isTranscribing && (
                        <p className="text-xs text-center text-slate-500">
                          브라우저에서 무료 모델로 변환 중입니다. 최초 1회 모델 다운로드로 시간이 걸릴 수 있어요...
                        </p>
                      )}
                    </div>
                  )}

                  {uploadError && (
                    <Alert variant="destructive">
                      <AlertDescription>{uploadError}</AlertDescription>
                    </Alert>
                  )}
                </TabsContent>

                <TabsContent value="text" className="mt-6">
                  {/* ③ 텍스트 입력 — TextInput 재사용(onResult로 텍스트만 위로).
                      도현 좌표: record/upload 패턴과 대칭. handleTextSubmit가 createMeeting 선후 update. */}
                  <TextInput onResult={handleTextSubmit} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          /* 회의 진행 화면 */
          <div className="space-y-6">
            {/* 현재 회의 정보 */}
            <Card className="shadow-sm border-slate-200 dark:border-slate-700">
              <CardHeader className="pb-3 sm:pb-4">
                <div className="flex items-start sm:items-center justify-between gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    {editingTitle ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditTitle();
                            else if (e.key === 'Escape') cancelEditTitle();
                          }}
                          onBlur={commitEditTitle}
                          autoFocus
                          className="text-lg sm:text-xl md:text-2xl h-9 px-2 py-1 max-w-[60vw]"
                          aria-label="회의 제목 편집"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CardTitle className="text-lg sm:text-xl md:text-2xl truncate pr-2">{currentMeeting.title}</CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={startEditTitle}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                          aria-label="회의 제목 편집"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                    <CardDescription className="mt-0.5 sm:mt-1 text-xs sm:text-sm">
                      <DateFormat date={currentMeeting.createdAt} />
                    </CardDescription>
                  </div>
                  <Badge variant={currentStep === 'done' ? 'default' : 'secondary'} className="shrink-0 text-xs">
                    {steps.find((s) => s.id === currentStep)?.label}
                  </Badge>
                </div>
              </CardHeader>
            </Card>

            {/* 단계별 컴포넌트 렌더링 */}
            <Tabs value={currentStep} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-4 h-auto p-1 bg-slate-100 dark:bg-slate-800">
                <TabsTrigger value="recording" disabled={isTabDisabled('recording')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400" aria-label="녹음 탭">
                  <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">녹음</span>
                </TabsTrigger>
                <TabsTrigger value="transcribing" disabled={isTabDisabled('transcribing')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400" aria-label="변환 탭">
                  <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">변환</span>
                </TabsTrigger>
                <TabsTrigger value="summarizing" disabled={isTabDisabled('summarizing')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400" aria-label="요약 탭">
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">요약</span>
                </TabsTrigger>
                <TabsTrigger value="done" disabled={isTabDisabled('done')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400" aria-label="문서 탭">
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">문서</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="recording" className="mt-6">
                <MeetingRecorder />
              </TabsContent>

              <TabsContent value="transcribing" className="mt-6">
                <TranscriptViewer />
              </TabsContent>

              <TabsContent value="summarizing" className="mt-6">
                <SummaryViewer />
              </TabsContent>

              <TabsContent value="done" className="mt-6">
                <PrdViewer key={currentMeeting?.id || 'default'} />
              </TabsContent>
            </Tabs>
          </div>
        )}
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* 문서 채팅 도우미 (플로팅) — 회의/문서 없으면 스스로 숨김 */}
      <DocAssistant />

      {/* 새 회의 확인 다이얼로그 */}
      {showNewMeetingConfirm && (
        <AlertDialog open={showNewMeetingConfirm} onOpenChange={setShowNewMeetingConfirm}>
          <AlertDialogContent role="alertdialog" aria-describedby="new-meeting-desc">
            <AlertDialogHeader>
              <AlertDialogTitle id="new-meeting-title">새 회의 시작</AlertDialogTitle>
              <AlertDialogDescription id="new-meeting-desc">
                현재 회의 내용은 자동 저장됩니다. 새 회의를 시작하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setCurrentMeeting(null);
                  setShowNewMeetingConfirm(false);
                }}
              >
                시작하기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* composite Project 보기 진입 확인 다이얼로그 — ② 진행 중 단일회의 작업이 있을 때.
          openCompositeProject가 currentMeeting을 덮어쓰므로 화면에서 사라지지만,
          persist로 저장된 데이터는 유지됨(화면만 전환). */}
      <AlertDialog
        open={pendingCompositeId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCompositeId(null);
        }}
      >
        <AlertDialogContent role="alertdialog" aria-describedby="composite-view-desc">
          <AlertDialogHeader>
            <AlertDialogTitle>진행 중인 회의 작업이 있어요</AlertDialogTitle>
            <AlertDialogDescription id="composite-view-desc">
              지금 <span className="font-semibold">진행 중</span>인 회의 작업이 있어요.
              합성 결과를 보면 해당 작업 내용이 화면에서 사라집니다.
              <span className="text-slate-500"> 저장된 데이터는 유지됩니다.</span> 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCompositeId) {
                  openCompositeProject(pendingCompositeId);
                  setTopTab('meetings');
                }
                setPendingCompositeId(null);
              }}
            >
              계속
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 내 문서 모달 — 헤더 "내 문서" 버튼으로 오픈.
          기존 회의(단일/합성) 카드 목록을 팝업으로 표시.
          인라인 카드(page.tsx 본문)는 중복 제거로 여기로 이전. */}
      <Dialog open={showDocsModal} onOpenChange={setShowDocsModal}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>내 문서</DialogTitle>
          </DialogHeader>
          {meetings.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">저장된 회의가 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {/* 단일 회의 — 기존 회의 카드(열기/삭제). */}
              {meetings.filter(m => !m.isComposite).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      회의 ({meetings.filter(m => !m.isComposite).length})
                    </h3>
                  </div>
                  {meetings.filter(m => !m.isComposite).map((m) => (
                    <Card key={m.id} className="border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow">
                      <CardContent className="p-3 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{m.title}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <DateFormat date={m.createdAt} format="datetime" />
                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                              {(m.completedDocs?.length ?? 0)}/14 문서
                            </Badge>
                            {(m.isCompleted || m.step === 'done') && (
                              <Badge variant="default" className="text-[10px] py-0 px-1.5 h-4 bg-green-600 hover:bg-green-600">
                                완료
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentMeeting(m);
                              setShowDocsModal(false);
                            }}
                            className="text-xs gap-1.5"
                            aria-label={`${m.title} 회의 이어보기`}
                          >
                            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                            열기
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePendingDelete(m.id)}
                            className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 gap-1"
                            aria-label={`${m.title} 삭제`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* 합성 회의 — 기존 합성 카드(보기). currentMeeting 진행 중이면 handleViewComposite가 확인 다이얼로그 오픈. */}
              {meetings.filter(m => m.isComposite).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      합성으로 만든 기획서 ({meetings.filter(m => m.isComposite).length})
                    </h3>
                  </div>
                  {meetings.filter(m => m.isComposite).map((m) => (
                    <Card key={m.id} className="border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow">
                      <CardContent className="p-3 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{m.title}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <DateFormat date={m.createdAt} format="datetime" />
                            <span>· {(m.compositeSourceNoteIds?.length ?? 0)}개 회의록 통합</span>
                            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
                              {(m.completedDocs?.length ?? 0)}/14 문서
                            </Badge>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowDocsModal(false);
                            handleViewComposite(m.id);
                          }}
                          className="flex-shrink-0 text-xs gap-1.5"
                          aria-label={`${m.title} 기획서 보기`}
                        >
                          <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                          보기
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
