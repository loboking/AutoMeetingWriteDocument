'use client';

import { useState } from 'react';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useMeetingStore } from '@/store/meetingStore';

export function TranscriptViewer() {
  const { currentMeeting, updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState(currentMeeting?.transcript || '');

  const handleSummarize = async () => {
    if (!editedTranscript.trim()) return;

    setIsSummarizing(true);
    updateMeetingStep('summarizing');

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editedTranscript,
          context: `${currentMeeting?.title} 회의`,
        }),
      });

      if (!response.ok) throw new Error('요약 실패');

      const { summary } = await response.json();

      updateCurrentMeeting({
        transcript: editedTranscript,
        summary,
      });

      updateMeetingStep('summarizing');
    } catch (error) {
      console.error('Summarize error:', error);
      alert('요약 생성에 실패했습니다.');
      updateMeetingStep('transcribing');
    } finally {
      setIsSummarizing(false);
    }
  };

  if (!currentMeeting?.transcript && !isSummarizing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>변환 대기 중</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-slate-500">
          녹음 완료 후 텍스트 변환이 필요합니다.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          변환된 텍스트
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={editedTranscript}
          onChange={(e) => setEditedTranscript(e.target.value)}
          placeholder="변환된 텍스트가 여기에 표시됩니다..."
          className="min-h-[400px] font-mono text-sm"
        />

        <div className="flex justify-end gap-2">
          <span className="text-sm text-slate-500 self-center">
            {editedTranscript.length}자
          </span>
          <Button
            onClick={handleSummarize}
            disabled={isSummarizing || !editedTranscript.trim()}
            size="lg"
          >
            {isSummarizing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                요약 중...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                AI 요약 생성
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default TranscriptViewer;
