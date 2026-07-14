'use client';

import { useState } from 'react';
import { FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useMeetingStore } from '@/store/meetingStore';
import type { TranscriptPayload } from './transcriptPayload';

interface TextInputProps {
  // ② 회의록 모드: onResult 전달 시 Meeting store를 건드리지 않고 결과만 부모로 위로.
  // 미전달(① 기존 흐름) 시 updateCurrentMeeting + updateMeetingStep 기존 동작 100% 유지.
  onResult?: (payload: TranscriptPayload) => void;
}

const MIN_CHARS = 10; // 너무 짧으면 요약/문서생성이 의미 없음 — 빈 입력 방지

export function TextInput({ onResult }: TextInputProps) {
  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const charCount = text.trim().length;

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS) {
      setError(`최소 ${MIN_CHARS}자 이상 입력해주세요. (현재 ${charCount}자)`);
      return;
    }
    setError('');
    // 회의록 모드(② onResult 전달 시)는 Meeting store를 건드리지 않고 결과만 부모로 위로.
    if (onResult) {
      onResult({ text: trimmed });
      return;
    }
    // ① 기존 흐름: STT 없이 입력 텍스트를 그대로 회의록으로 저장 → 요약/문서생성 파이프라인.
    updateCurrentMeeting({ transcript: trimmed });
    updateMeetingStep('transcribing');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          텍스트 입력
        </CardTitle>
        <CardDescription>
          회의록·메모를 직접 입력하거나 붙여넣으세요. 음성 변환 없이 바로 요약·문서로 만듭니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError('');
          }}
          placeholder="회의 내용을 입력하거나 붙여넣으세요...&#10;예) 오늘 회의에서는 신규 기능 우선순위를 논의했다. 결정사항: ..."
          className="min-h-[240px] resize-y"
          aria-label="회의 내용 텍스트 입력"
        />

        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm ${charCount < MIN_CHARS ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {charCount.toLocaleString()}자
          </span>
          <Button onClick={handleSubmit} disabled={charCount < MIN_CHARS} className="gap-1.5">
            다음 단계로
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
