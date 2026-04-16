'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Play, Pause, Upload, FileText, Download, FileUp, FolderOpen, X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useRecorder } from '@/hooks/useRecorder';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useProgressSimulation } from '@/hooks/useProgressSimulation';
import { useMeetingStore } from '@/store/meetingStore';
import { MeetingStep } from '@/types';
import MeetingRecorder from '@/components/MeetingRecorder';
import TranscriptViewer from '@/components/TranscriptViewer';
import SummaryViewer from '@/components/SummaryViewer';
import PrdViewer from '@/components/PrdViewer';
import { ProjectList } from '@/components/ProjectList';
import { DateFormat } from '@/components/DateFormat';

export default function Home() {
  const { currentMeeting, currentStep, createMeeting, updateCurrentMeeting, updateMeetingStep, meetings, setCurrentMeeting } = useMeetingStore();
  const [meetingTitle, setMeetingTitle] = useState('');
  const [mounted, setMounted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showProjectList, setShowProjectList] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 진행률 시뮬레이션 훅 사용
  const { progress: uploadProgress, startSimulation, stopSimulation, resetSimulation } = useProgressSimulation(200, 15, 90);

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

  const [uploadError, setUploadError] = useState('');

  const [showNewMeetingConfirm, setShowNewMeetingConfirm] = useState(false);
  const handleFileUpload = async (file: File) => {
    setUploadError('');
    setUploading(true);
    resetSimulation();
    startSimulation();

    // 파일 크기 검증 (최대 50MB)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setUploadError('파일 크기는 50MB 이하여야 합니다.');
      setUploading(false);
      stopSimulation();
      return;
    }

    const title = meetingTitle.trim() || file.name.replace(/\.[^/.]+$/, '');

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/extract-text', {
        method: 'POST',
        body: formData,
      });

      stopSimulation();

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '파일 처리 실패' }));
        throw new Error(errorData.error || '파일 처리 실패');
      }

      const { text } = await response.json();

      // 업로드 성공 후에만 회의 생성
      createMeeting(title);
      setMeetingTitle('');
      updateCurrentMeeting({ transcript: text });
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
      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
        {/* 헤더 */}
        <header className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <div className="text-center sm:text-left flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 mb-1 sm:mb-2">
                MeetingAutoDocs
              </h1>
              <p className="text-xs sm:text-sm md:text-base text-slate-600 dark:text-slate-400">
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
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">새 회의</span>
                </Button>
              )}
              <Button
                onClick={() => setShowProjectList(true)}
                variant="outline"
                size="sm"
                className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-2.5"
              >
                <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">프로젝트 리스트</span>
                {meetings.length > 0 && (
                  <Badge variant="secondary" className="ml-0.5 sm:ml-1 px-1 sm:px-1.5 py-0 text-[10px] sm:text-xs">{meetings.length}</Badge>
                )}
              </Button>
            </div>
          </div>
        </header>

        {/* 단계 진행 바 */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-1 sm:gap-2 mb-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isPast = getCurrentStepIndex() > index;
              const isClickable = currentMeeting && step.id !== 'idle';

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
          <Progress value={(getCurrentStepIndex() / (steps.length - 1)) * 100} className="h-2" />
        </div>

        {/* 메인 콘텐츠 */}
        {!currentMeeting ? (
          /* 새 회의 시작 카드 */
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
                />
              </div>

              <Tabs defaultValue="record" className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-auto p-1">
                  <TabsTrigger value="record" className="gap-2">
                    <Mic className="w-4 h-4" />
                    녹음 시작
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="gap-2">
                    <FileUp className="w-4 h-4" />
                    파일 업로드
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
                    accept=".txt,.md,.pdf,audio/*"
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
                    지원: TXT, PDF, 음성파일
                  </p>

                  {uploading && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">파일 처리 중...</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                  )}

                  {uploadError && (
                    <Alert variant="destructive">
                      <AlertDescription>{uploadError}</AlertDescription>
                    </Alert>
                  )}
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
                    <CardTitle className="text-lg sm:text-xl md:text-2xl truncate pr-2">{currentMeeting.title}</CardTitle>
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
                <TabsTrigger value="recording" disabled={isTabDisabled('recording')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400">
                  <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">녹음</span>
                </TabsTrigger>
                <TabsTrigger value="transcribing" disabled={isTabDisabled('transcribing')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400">
                  <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">변환</span>
                </TabsTrigger>
                <TabsTrigger value="summarizing" disabled={isTabDisabled('summarizing')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400">
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">요약</span>
                </TabsTrigger>
                <TabsTrigger value="done" disabled={isTabDisabled('done')} className="gap-1 sm:gap-1.5 h-8 sm:h-9 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-blue-400">
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
                <PrdViewer />
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* 프로젝트 목록 모달 */}
        {showProjectList && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">프로젝트 목록</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowProjectList(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <ProjectList onClose={() => setShowProjectList(false)} />
              </div>
            </div>
          </div>
        )}
      </div>

        {/* 새 회의 확인 다이얼로그 */}
        {showNewMeetingConfirm && (
          <AlertDialog open={showNewMeetingConfirm} onOpenChange={setShowNewMeetingConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>새 회의 시작</AlertDialogTitle>
                <AlertDialogDescription>
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
    </div>
  );
}
