'use client';

import { useState } from 'react';
import { FileText, Loader2, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useMeetingStore } from '@/store/meetingStore';
import { authedFetch } from '@/lib/authFetch';

// 최대 권장 텍스트 길이 (토큰 제한 고려)
const MAX_RECOMMENDED_LENGTH = 15000;

export function TranscriptViewer() {
  const currentMeeting = useMeetingStore(s => s.currentMeeting);
  const { updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [editedTranscript, setEditedTranscript] = useState(currentMeeting?.transcript || '');
  const [summarizeProgress, setSummarizeProgress] = useState('');
  const [isTooLong, setIsTooLong] = useState(false);

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

      const res = await authedFetch('/api/transcribe', {
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

    // 텍스트 길이 확인
    if (editedTranscript.length > MAX_RECOMMENDED_LENGTH) {
      const confirmed = confirm(
        `텍스트가 너무 길어서 API 요청이 실패할 수 있습니다.\n\n` +
        `현재 길이: ${editedTranscript.length.toLocaleString()}자\n` +
        `권장 길이: ${MAX_RECOMMENDED_LENGTH.toLocaleString()}자\n\n` +
        `계속 진행하시겠습니까?`
      );
      if (!confirmed) return;
      setIsTooLong(true);
    }

    setIsSummarizing(true);
    updateMeetingStep('summarizing');

    // 진행 상태 메시지
    setSummarizeProgress('API 요청 준비 중...');

    try {
      console.log('[Frontend] 요약 요청 시작', {
        textLength: editedTranscript.length,
        title: currentMeeting?.title,
      });

      // 음성 STT 출처(transcriptSegments 존재)면 맥락 보정 1회 — 한국어 STT 오인식 교정(회의 내용 정확 파악 1순위)
      let textForSummary = editedTranscript;
      if (currentMeeting?.transcriptSegments && currentMeeting.transcriptSegments.length > 0) {
        try {
          setSummarizeProgress('회의 내용 맥락 보정 중...');
          const refineRes = await authedFetch('/api/refine-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: editedTranscript }),
          });
          if (refineRes.ok) {
            const { refined } = await refineRes.json();
            if (refined && refined.trim()) textForSummary = refined;
          }
        } catch {
          // 보정 실패 시 원문으로 진행 (파이프라인 끊지 않음)
        }
      }

      setSummarizeProgress('AI 모델에 요청 전송 중...');

      const response = await authedFetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textForSummary,
          context: `${currentMeeting?.title} 회의`,
        }),
      });

      console.log('[Frontend] 요약 응답 수신', {
        status: response.status,
        ok: response.ok,
      });

      setSummarizeProgress('요약 결과 분석 중...');

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Frontend] API 에러 응답:', errorText);
        throw new Error('요약 실패');
      }

      const { summary } = await response.json();

      setSummarizeProgress('저장 중...');
      updateCurrentMeeting({
        transcript: editedTranscript,
        summary,
      });

      updateMeetingStep('summarizing');
      setSummarizeProgress('');
    } catch (error) {
      console.error('Summarize error:', error);
      alert('요약 생성에 실패했습니다. 다시 시도해주세요.');
      updateMeetingStep('transcribing');
      setSummarizeProgress('');
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
    <div className="relative">
      {/* 요약 중 전체 화면 로딩 오버레이 */}
      {isSummarizing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-lg">
          <div className="text-center">
            <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-500" />
            <p className="text-lg font-medium">AI 요약 생성 중...</p>
            <p className="text-sm text-slate-500 mt-2">{summarizeProgress || '회의 내용을 분석하고 있습니다'}</p>
          </div>
        </div>
      )}

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
          <span className={`text-sm self-center ${editedTranscript.length > MAX_RECOMMENDED_LENGTH ? 'text-amber-500 font-medium' : 'text-slate-500'}`}>
            {editedTranscript.length.toLocaleString()}자
            {editedTranscript.length > MAX_RECOMMENDED_LENGTH && ' (권장 길이 초과)'}
          </span>
          <Button
            onClick={handleSummarize}
            disabled={isSummarizing || !editedTranscript.trim()}
            size="lg"
          >
            {isSummarizing ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                요약 생성 중...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                AI 요약 생성
              </>
            )}
          </Button>
        </div>

        {/* 텍스트 길이 경고 */}
        {editedTranscript.length > MAX_RECOMMENDED_LENGTH && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">텍스트가 너무 길어서 API 요청이 실패할 수 있습니다.</p>
              <p className="mt-1">
                현재 <strong>{editedTranscript.length.toLocaleString()}자</strong> (권장: {MAX_RECOMMENDED_LENGTH.toLocaleString()}자 이하)
              </p>
              <p className="mt-1">불필요한 내용을 삭제하거나, 여러 부분으로 나눠서 요약을 진행해주세요.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

export default TranscriptViewer;
