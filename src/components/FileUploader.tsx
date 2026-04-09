'use client';

import { useState, useRef } from 'react';
import { Upload, FileAudio, FileText, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useMeetingStore } from '@/store/meetingStore';

type FileType = 'audio' | 'document';

interface FileUploaderProps {
  onTranscriptComplete?: (text: string) => void;
}

export function FileUploader({ onTranscriptComplete }: FileUploaderProps) {
  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    const fileType = file.type.startsWith('audio/') ? 'audio' : 'document';

    try {
      if (fileType === 'audio') {
        await handleAudioFile(file);
      } else {
        await handleDocumentFile(file);
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert('파일 처리에 실패했습니다.');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAudioFile = async (file: File) => {
    // 진행률 시뮬레이션
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    const formData = new FormData();
    formData.append('audioFile', file);
    formData.append('language', 'ko');

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    clearInterval(interval);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: '변환 실패' }));

      // API 키 누락 특별 처리
      if (errorData.error === 'OPENAI_API_KEY_MISSING') {
        alert('⚠️ OPENAI_API_KEY가 설정되지 않았습니다!\n\n' +
              '.env.local 파일에 다음 내용을 추가하세요:\n' +
              'OPENAI_API_KEY=sk-your-key-here\n\n' +
              'API 키는 https://platform.openai.com/api-keys 에서 받을 수 있습니다.');
        throw new Error('API 키 누락');
      }

      throw new Error(errorData.error || '변환 실패');
    }

    setProgress(100);

    const { text } = await response.json();

    updateCurrentMeeting({
      transcript: text,
      audioUrl: URL.createObjectURL(file),
    });

    updateMeetingStep('transcribing');
    onTranscriptComplete?.(text);
  };

  const handleDocumentFile = async (file: File) => {
    // 진행률 시뮬레이션
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 15;
      });
    }, 200);

    const formData = new FormData();
    formData.append('document', file);

    const response = await fetch('/api/extract-text', {
      method: 'POST',
      body: formData,
    });

    clearInterval(interval);
    setProgress(100);

    if (!response.ok) throw new Error('텍스트 추출 실패');

    const { text } = await response.json();

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
        <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                파일 변환 중...
              </span>
              <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                {progress}%
              </span>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-xs text-center text-slate-500">
              AI가 파일을 분석하여 텍스트로 변환하고 있습니다...
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
