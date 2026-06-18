'use client';

import { useState, useRef } from 'react';
import { Upload, FileAudio, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useProgressSimulation } from '@/hooks/useProgressSimulation';
import { handleApiError } from '@/lib/apiUtils';
import { useMeetingStore } from '@/store/meetingStore';
import { authedFetch } from '@/lib/authFetch';
import { useBrowserSTT } from '@/hooks/useBrowserSTT';
import { isNoSttProviderResponse } from '@/lib/stt/browserSTT';

interface FileUploaderProps {
  onTranscriptComplete?: (text: string) => void;
}

export function FileUploader({ onTranscriptComplete }: FileUploaderProps) {
  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const browserSTT = useBrowserSTT();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 진행률 시뮬레이션 훅 사용 (오디오용)
  const { progress, startSimulation, stopSimulation, resetSimulation } = useProgressSimulation(200, 10, 90);

  // 문서 처리용 별도 진행률 시뮬레이션
  const { startSimulation: startDocSim, stopSimulation: stopDocSim, resetSimulation: resetDocSim } = useProgressSimulation(200, 15, 90);

  // 클릭 선택·드래그앤드롭 공용 처리 경로
  const processFile = async (file: File) => {
    setUploading(true);
    resetSimulation();

    const fileType = file.type.startsWith('audio/') ? 'audio' : 'document';

    try {
      if (fileType === 'audio') {
        await handleAudioFile(file);
      } else {
        await handleDocumentFile(file);
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert(error instanceof Error ? error.message : '파일 처리에 실패했습니다.');
    } finally {
      setUploading(false);
      stopSimulation();
      stopDocSim();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleAudioFile = async (file: File) => {
    startSimulation();

    const formData = new FormData();
    formData.append('audioFile', file);
    formData.append('language', 'ko');

    const response = await authedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    let text: string;
    let segments: import('@/types').TranscriptSegment[] | undefined;
    let audioDuration: number | undefined;

    if (response.ok) {
      text = data.text || '';
      segments = data.segments;
      audioDuration = data.duration;
    } else if (isNoSttProviderResponse(data)) {
      // 서버 STT 키 없음 → 브라우저 무료 STT(transformers.js)로 폴백 (VoiceRecorder와 동일)
      stopSimulation();
      const result = await browserSTT.transcribeBlob(file, 'ko');
      if (!result || !result.text.trim()) {
        throw new Error(browserSTT.error || '브라우저 음성 변환에 실패했습니다.');
      }
      text = result.text;
      segments = result.segments;
      audioDuration = result.duration;
    } else {
      await handleApiError(response, '변환 실패');
      return;
    }

    stopSimulation();

    if (!text.trim()) throw new Error('변환된 텍스트가 비어 있습니다.');

    updateCurrentMeeting({
      transcript: text,
      ...(segments ? { transcriptSegments: segments } : {}),
      ...(audioDuration ? { duration: audioDuration } : {}),
      audioUrl: URL.createObjectURL(file),
    });

    updateMeetingStep('transcribing');
    onTranscriptComplete?.(text);
  };

  const handleDocumentFile = async (file: File) => {
    // 문서 처리는 더 높은 증가분 사용
    resetDocSim();
    startDocSim();

    const formData = new FormData();
    formData.append('document', file);

    const response = await authedFetch('/api/extract-text', {
      method: 'POST',
      body: formData,
    });

    stopDocSim();

    if (!response.ok) {
      await handleApiError(response, '텍스트 추출 실패');
      return;
    }

    const { text } = await response.json();

    if (!text || !text.trim()) throw new Error('추출된 텍스트가 비어 있습니다.');

    updateCurrentMeeting({
      transcript: text,
    });

    updateMeetingStep('transcribing');
    onTranscriptComplete?.(text);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          파일 업로드
        </CardTitle>
        <CardDescription>
          음성 파일 또는 문서를 업로드하여 변환하세요
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 지원 파일 형식 안내 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <FileAudio className="w-8 h-8 text-blue-500 mb-2" />
            <h3 className="font-medium mb-1">음성 파일</h3>
            <p className="text-sm text-slate-500">MP3, WAV, M4A, WebM</p>
          </div>
          <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
            <FileText className="w-8 h-8 text-green-500 mb-2" />
            <h3 className="font-medium mb-1">문서 파일</h3>
            <p className="text-sm text-slate-500">TXT, PDF (준비 중)</p>
          </div>
        </div>

        {/* 파일 업로드 영역 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            // 컨테이너 내부 자식으로의 이동이면 무시 (깜빡임 방지)
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
              : 'border-slate-300 dark:border-slate-700 hover:border-blue-500'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.txt,application/pdf"
            onChange={handleFileSelect}
            disabled={uploading}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer flex flex-col items-center gap-3"
          >
            <Upload className="w-12 h-12 text-slate-400" />
            <div>
              <p className="font-medium">파일을 선택하거나 드래그하세요</p>
              <p className="text-sm text-slate-500 mt-1">
                음성 파일 또는 텍스트 문서
              </p>
            </div>
            <Button
              type="button"
              disabled={uploading}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('file-upload')?.click();
              }}
            >
              {uploading ? '처리 중...' : '파일 선택'}
            </Button>
          </label>
        </div>

        {/* 진행률 */}
        {uploading && (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {browserSTT.isTranscribing ? '브라우저 음성 변환 중...' : '파일 변환 중...'}
              </span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                {Math.max(progress, browserSTT.progress)}%
              </span>
            </div>
            <Progress value={Math.max(progress, browserSTT.progress)} className="h-3" />
            <p className="text-xs text-center text-slate-500">
              {browserSTT.isTranscribing
                ? '브라우저에서 무료 모델로 음성을 변환 중입니다. 최초 1회 모델 다운로드로 시간이 걸릴 수 있어요...'
                : 'AI가 파일을 분석하여 텍스트로 변환하고 있습니다...'}
            </p>
          </div>
        )}

        {/* 마이크 권한 문제 해결 가이드 */}
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                마이크 권한이 거부되었나요?
              </p>
              <ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-400">
                <li>• 브라우저 주소창의 🔒 아이콘 클릭</li>
                <li>• 마이크 권한을 <strong>허용</strong>으로 변경</li>
                <li>• 페이지를 새로고침</li>
                <li>• macOS: 시스템 설정 → 개인정보 보호 → 마이크</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
