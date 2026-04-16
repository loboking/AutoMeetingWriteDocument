'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, Square, Pause, Play, Upload, Loader2, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecorder } from '@/hooks/useRecorder';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useProgressSimulation } from '@/hooks/useProgressSimulation';
import { handleApiError } from '@/lib/apiUtils';
import { formatTime } from '@/lib/timeUtils';
import { useMeetingStore } from '@/store/meetingStore';
import { FileUploader } from './FileUploader';

function VoiceRecorder() {
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

  const handleStopRecording = async () => {
    stopRecording();
    updateCurrentMeeting({ duration });
    hasAutoTranscribed.current = false;
  };

  const handleTranscribe = async () => {
    const blob = getAudioBlob();
    if (!blob) return;

    setIsUploading(true);
    resetSimulation();
    startSimulation();
    updateMeetingStep('transcribing');

    try {
      const formData = new FormData();
      formData.append('audioFile', blob, 'recording.webm');
      formData.append('language', 'ko');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        await handleApiError(response, '변환 실패');
      }

      const { text, duration: audioDuration } = await response.json();

      stopSimulation();

      updateCurrentMeeting({
        transcript: text,
        duration: audioDuration || duration,
        audioUrl: audioUrl || undefined,
      });

      updateMeetingStep('transcribing');
    } catch (error) {
      console.error('Transcribe error:', error);
      alert('음성 변환에 실패했습니다.');
      updateMeetingStep('recording');
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
        <div className="text-center space-y-4">
          <div className="text-6xl font-mono font-bold text-slate-800 dark:text-slate-200">
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
            >
              <Mic className="w-8 h-8" />
            </Button>
          ) : (
            <>
              {isPaused ? (
                <Button
                  onClick={resumeRecording}
                  size="lg"
                  className="h-16 w-16 rounded-full"
                  variant="secondary"
                >
                  <Play className="w-6 h-6" />
                </Button>
              ) : (
                <Button
                  onClick={pauseRecording}
                  size="lg"
                  className="h-16 w-16 rounded-full"
                  variant="secondary"
                >
                  <Pause className="w-6 h-6" />
                </Button>
              )}

              <Button
                onClick={handleStopRecording}
                size="lg"
                className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600"
              >
                <Square className="w-6 h-6" />
              </Button>
            </>
          )}
        </div>

        {/* 녹음 완료 후 변환 진행 상태 */}
        {audioUrl && !isRecording && (
          <div className="space-y-4">
            <audio src={audioUrl} controls className="w-full" />

            {/* 변환 중인 경우 진행률 표시 */}
            {isUploading ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    텍스트 변환 중...
                  </span>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                    {uploadProgress}%
                  </span>
                </div>
                <Progress value={uploadProgress} className="h-3" />
                <p className="text-xs text-center text-slate-500">
                  AI가 음성을 텍스트로 변환하고 있습니다. 잠시만 기다려주세요...
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

export function MeetingRecorder() {
  const [activeTab, setActiveTab] = useState('voice');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-2 mb-6">
        <TabsTrigger value="voice" className="gap-2">
          <Mic className="w-4 h-4" />
          음성 녹음
        </TabsTrigger>
        <TabsTrigger value="file" className="gap-2">
          <FileUp className="w-4 h-4" />
          파일 업로드
        </TabsTrigger>
      </TabsList>

      <TabsContent value="voice">
        <VoiceRecorder />
      </TabsContent>

      <TabsContent value="file">
        <FileUploader />
      </TabsContent>
    </Tabs>
  );
}

export default MeetingRecorder;
