'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, Square, Pause, Play, FileUp, AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecorder } from '@/hooks/useRecorder';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useProgressSimulation } from '@/hooks/useProgressSimulation';
import { formatTime } from '@/lib/timeUtils';
import { useMeetingStore } from '@/store/meetingStore';
import { useBrowserSTT } from '@/hooks/useBrowserSTT';
import { transcribeAudio } from '@/lib/transcribeAudio';
import { FileUploader } from './FileUploader';
import { TextInput } from './TextInput';
import type { TranscriptPayload } from './transcriptPayload';

interface VoiceRecorderProps {
  // ② 회의록 모드: onResult 전달 시 Meeting store를 건드리지 않고 결과만 부모로 위로.
  // 미전달(① 기존 흐름) 시 updateCurrentMeeting + updateMeetingStep 기존 동작 100% 유지.
  onResult?: (payload: TranscriptPayload) => void;
}

function VoiceRecorder({ onResult }: VoiceRecorderProps = {}) {
  const {
    isRecording,
    isPaused,
    duration,
    audioUrl,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    getAudioBlob,
    reset,
  } = useRecorder();

  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const browserSTT = useBrowserSTT();
  const [isUploading, setIsUploading] = useState(false);
  const hasAutoTranscribed = useRef(false);

  // 진행률 시뮬레이션 훅 사용
  const { progress: uploadProgress, startSimulation, stopSimulation, resetSimulation } = useProgressSimulation(300, 10, 90);

  // 페이지 이탈 방지 훅 사용
  const isUploadingOrRecording = isRecording || isPaused || isUploading;
  useBeforeUnload(
    isUploadingOrRecording,
    isRecording || isPaused
      ? '녹음 중입니다. 페이지를 나가시면 녹음이 중단됩니다.'
      : '음성 변환 중입니다. 페이지를 나가시면 변환이 취소됩니다.'
  );

  // 녹음·변환 중 화면 자동 꺼짐 방지(모바일 백그라운드 동결 완화). 단, 화면 자동 꺼짐만 막고
  // 사용자가 직접 잠그거나 다른 앱으로 전환하는 것은 브라우저 한계상 못 막는다(아래 경고 배너로 보완).
  useWakeLock(isUploadingOrRecording);

  const handleStopRecording = async () => {
    stopRecording();
    // 회의록 모드(② onResult 전달 시)는 Meeting store를 건드리지 않는다.
    if (!onResult) updateCurrentMeeting({ duration });
    hasAutoTranscribed.current = false;
  };

  const handleTranscribe = async () => {
    const blob = getAudioBlob();
    if (!blob) return;

    setIsUploading(true);
    resetSimulation();
    startSimulation();
    if (!onResult) updateMeetingStep('transcribing');

    try {
      // 저장소 업로드 → 서명URL → 서버 Whisper(키 없으면 브라우저 STT 폴백). 임시 사본은 헬퍼가 정리.
      const result = await transcribeAudio(blob, 'ko', {
        browserTranscribe: (b, lang) => browserSTT.transcribeBlob(b, lang),
        browserError: browserSTT.error,
      });

      stopSimulation();

      // 회의록 모드(② onResult 전달 시)는 Meeting store를 건드리지 않고 결과만 부모로 위로.
      if (onResult) {
        onResult({
          text: result.text,
          ...(result.segments ? { segments: result.segments } : {}),
          duration: result.duration || duration,
          ...(audioUrl ? { audioUrl } : {}),
        });
        return;
      }

      updateCurrentMeeting({
        transcript: result.text,
        ...(result.segments ? { transcriptSegments: result.segments } : {}),
        duration: result.duration || duration,
        audioUrl: audioUrl || undefined,
      });

      updateMeetingStep('transcribing');
    } catch (error) {
      console.error('Transcribe error:', error);
      alert(error instanceof Error ? error.message : '음성 변환에 실패했습니다.');
      if (!onResult) updateMeetingStep('recording');
    } finally {
      stopSimulation();
      setIsUploading(false);
    }
  };

  // 녹음 완료 후 자동으로 텍스트 변환 시작
  useEffect(() => {
    if (audioUrl && !isRecording && !hasAutoTranscribed.current) {
      hasAutoTranscribed.current = true;
      // 약간의 지연 후 변환 시작 (사용자가 완료를 인지할 수 있도록)
      const timer = setTimeout(() => {
        handleTranscribe();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [audioUrl, isRecording]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="w-5 h-5" />
          음성 녹음
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 녹음 상태 표시 */}
        <div className="text-center space-y-4" role="status" aria-live="polite">
          <div className="text-6xl font-mono font-bold text-slate-800 dark:text-slate-200" aria-label={`녹음 시간 ${formatTime(duration)}`}>
            {formatTime(duration)}
          </div>

          <div className="flex justify-center gap-2">
            {isRecording && (
              <Badge variant="destructive" className="animate-pulse">
                녹음 중
              </Badge>
            )}
            {isPaused && (
              <Badge variant="secondary">
                일시정지
              </Badge>
            )}
          </div>

          {/* 오디오 파형 시각화 */}
          {isRecording && (
            <div className="flex items-center justify-center gap-1 h-12">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-blue-500 rounded-full animate-pulse"
                  style={{
                    height: `${Math.random() * 40 + 10}px`,
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 컨트롤 버튼 */}
        <div className="flex justify-center gap-4">
          {!isRecording ? (
            <Button
              onClick={startRecording}
              size="lg"
              className="w-32 h-32 rounded-full"
              disabled={!!audioUrl}
              aria-label={audioUrl ? "녹음 완료됨" : "녹음 시작"}
              aria-pressed={false}
            >
              <Mic className="w-8 h-8" aria-hidden="true" />
            </Button>
          ) : (
            <>
              {isPaused ? (
                <Button
                  onClick={resumeRecording}
                  size="lg"
                  className="h-16 w-16 rounded-full"
                  variant="secondary"
                  aria-label="녹음 재개"
                  aria-pressed={false}
                >
                  <Play className="w-6 h-6" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  onClick={pauseRecording}
                  size="lg"
                  className="h-16 w-16 rounded-full"
                  variant="secondary"
                  aria-label="녹음 일시정지"
                  aria-pressed={true}
                >
                  <Pause className="w-6 h-6" aria-hidden="true" />
                </Button>
              )}

              <Button
                onClick={handleStopRecording}
                size="lg"
                className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600"
                aria-label="녹음 정지"
              >
                <Square className="w-6 h-6" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>

        {/* 녹음/변환 중 백그라운드 경고 (화면 끄거나 앱 전환 시 중단 위험 — WakeLock으로도 못 막는 케이스) */}
        {(isRecording || isPaused || isUploading) && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300" role="status" aria-live="polite">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {isUploading
                ? '변환이 끝날 때까지 화면을 켜 두세요. 화면을 끄거나 다른 앱으로 전환하면 변환이 중단될 수 있어요.'
                : '녹음 중에는 화면을 끄거나 다른 앱으로 전환하지 마세요. 모바일에서는 녹음이 중단되거나 유실될 수 있어요.'}
            </span>
          </div>
        )}

        {/* 녹음 완료 후 변환 진행 상태 */}
        {audioUrl && !isRecording && (
          <div className="space-y-4">
            <audio src={audioUrl} controls className="w-full" aria-label="녹음된 오디오 재생" />

            {/* 변환 중인 경우 진행률 표시 */}
            {isUploading ? (
              <div className="space-y-3" role="status" aria-live="polite">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {browserSTT.isTranscribing ? '브라우저 음성 변환 중...' : '텍스트 변환 중...'}
                  </span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                    {Math.max(uploadProgress, browserSTT.progress)}%
                  </span>
                </div>
                <Progress value={Math.max(uploadProgress, browserSTT.progress)} className="h-3" aria-label={`변환 진행률 ${Math.max(uploadProgress, browserSTT.progress)}퍼센트`} />
                <p className="text-xs text-center text-slate-500">
                  {browserSTT.isTranscribing
                    ? '브라우저에서 무료 모델로 음성을 변환 중입니다. 최초 1회 모델 다운로드로 시간이 걸릴 수 있어요...'
                    : 'AI가 음성을 텍스트로 변환하고 있습니다. 잠시만 기다려주세요...'}
                </p>
              </div>
            ) : (
              /* 변환 완료 후 옵션 */
              <div className="flex gap-2">
                <Button onClick={reset} variant="outline" size="lg" className="flex-1">
                  다시 녹음
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface MeetingRecorderProps {
  // mode='note'(② 회의록 모드): 자식 입력 컴포넌트들이 Meeting store를 건드리지 않고
  //   전사 결과를 onTranscriptReady로 부모에게 위로 올려보낸다. 부모가 /api/summarize → createMeetingNote.
  // mode='meeting'(기본, ① 기획서 흐름): 기존 동작 100% 보존(updateCurrentMeeting + updateMeetingStep).
  mode?: 'meeting' | 'note';
  // mode='note'일 때만 의미. 전사 완료 페이로드.
  onTranscriptReady?: (payload: TranscriptPayload) => void;
}

export function MeetingRecorder({ mode = 'meeting', onTranscriptReady }: MeetingRecorderProps = {}) {
  const [activeTab, setActiveTab] = useState('voice');
  // 회의록 모드에서만 자식에게 onResult를 넘긴다. meeting 모드는 undefined → 자식 기존 동작.
  const onResult = mode === 'note' ? onTranscriptReady : undefined;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-3 mb-6" role="tablist">
        <TabsTrigger value="voice" className="gap-1.5 sm:gap-2" aria-label="음성 녹음 탭">
          <Mic className="w-4 h-4" aria-hidden="true" />
          <span className="truncate">음성 녹음</span>
        </TabsTrigger>
        <TabsTrigger value="file" className="gap-1.5 sm:gap-2" aria-label="파일 업로드 탭">
          <FileUp className="w-4 h-4" aria-hidden="true" />
          <span className="truncate">파일 업로드</span>
        </TabsTrigger>
        <TabsTrigger value="text" className="gap-1.5 sm:gap-2" aria-label="텍스트 입력 탭">
          <FileText className="w-4 h-4" aria-hidden="true" />
          <span className="truncate">텍스트 입력</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="voice">
        <VoiceRecorder onResult={onResult} />
      </TabsContent>

      <TabsContent value="file">
        <FileUploader onResult={onResult} />
      </TabsContent>

      <TabsContent value="text">
        <TextInput onResult={onResult} />
      </TabsContent>
    </Tabs>
  );
}

export default MeetingRecorder;
