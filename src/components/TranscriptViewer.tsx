'use client';

import { useState } from 'react';
import { FileText, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useMeetingStore } from '@/store/meetingStore';

export function TranscriptViewer() {
  const currentMeeting = useMeetingStore(s => s.currentMeeting);
  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState(currentMeeting?.transcript || '');

  // 변환 재생성 (오디오 파일 필요)
  const handleRegenerateTranscript = async () => {
    const audioUrl = currentMeeting?.audioUrl;
    if (!audioUrl) {
      alert('녹음 파일이 없어서 재변환할 수 없습니다.\n오디오 파일을 다시 녹음하거나 업로드해주세요.');
      return;
    }

    setIsRegenerating(true);
    try {
      // 오디오 URL에서 Blob을 가져와서 File로 변환
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const audioFile = new File([blob], 'audio.webm', { type: 'audio/webm' });

      const formData = new FormData();
      formData.append('audioFile', audioFile);
      formData.append('language', 'ko');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('변환 실패');

      const { text } = await res.json();

      setEditedTranscript(text);
      updateCurrentMeeting({ transcript: text });
    } catch (error) {
      console.error('Transcribe regenerate error:', error);
      alert('재변환에 실패했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSummarize = async () => {
    if (!editedTranscript.trim()) return;

    setIsSummarizing(true);
    updateMeetingStep('summarizing');

    try {
      console.log('[Frontend] 요약 요청 시작', {
        textLength: editedTranscript.length,
        title: currentMeeting?.title,
      });

      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editedTranscript,
          context: `${currentMeeting?.title} 회의`,
        }),
      });

      console.log('[Frontend] 요약 응답 수신', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Frontend] API 에러 응답:', errorText);
        throw new Error('요약 실패');
      }

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
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            변환된 텍스트
          </CardTitle>
          <Button
            onClick={handleRegenerateTranscript}
            disabled={isRegenerating || !currentMeeting?.audioUrl}
            variant="outline"
            size="sm"
          >
            {isRegenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                재변환 중...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                변환 재생성
              </>
            )}
          </Button>
        </div>
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
