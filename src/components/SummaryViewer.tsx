'use client';

import { useState, useEffect } from 'react';
import { FileText, Loader2, CheckCircle, Clock, User, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useMeetingStore } from '@/store/meetingStore';

export function SummaryViewer() {
  const { currentMeeting, updateCurrentMeeting, updateMeetingStep } = useMeetingStore();
  const summary = currentMeeting?.summary;
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // 요약 재생성
  const handleRegenerateSummary = async () => {
    if (!currentMeeting?.transcript) return;

    setIsRegenerating(true);
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentMeeting.transcript,
          context: `${currentMeeting.title} 회의`,
        }),
      });

      if (!response.ok) throw new Error('요약 재생성 실패');

      const { summary: newSummary } = await response.json();
      updateCurrentMeeting({ summary: newSummary });
    } catch (error) {
      console.error('Summary regenerate error:', error);
      alert('요약 재생성에 실패했습니다.');
    } finally {
      setIsRegenerating(false);
    }
  };

  // 페이지 이탈 방지 (PRD 생성 중)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isGenerating) {
        const message = '문서 생성 중입니다. 페이지를 나가시면 생성이 취소됩니다.';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGenerating]);

  const handleGeneratePrd = async () => {
    if (!summary || !currentMeeting) return;

    setIsGenerating(true);
    updateMeetingStep('done');

    try {
      const response = await fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType: 'prd',
          summary,
          transcript: currentMeeting.transcript || '',
          meetingInfo: {
            title: currentMeeting.title,
            date: new Date(currentMeeting.createdAt).toLocaleDateString('ko-KR'),
          },
        }),
      });

      if (!response.ok) throw new Error('PRD 생성 실패');

      const { prd } = await response.json();

      updateCurrentMeeting({ prd });
      updateMeetingStep('done');
    } catch (error) {
      console.error('PRD generation error:', error);
      alert('PRD 생성에 실패했습니다.');
      updateMeetingStep('summarizing');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>요약 대기 중</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12 text-slate-500">
          텍스트 변환 후 AI 요약을 생성해주세요.
        </CardContent>
      </Card>
    );
  }

  const priorityColors = {
    high: 'destructive',
    medium: 'default',
    low: 'secondary',
  } as const;

  return (
    <div className="space-y-6">
      {/* 요약 재생성 버튼 */}
      <div className="flex justify-end">
        <Button
          onClick={handleRegenerateSummary}
          disabled={isRegenerating}
          variant="outline"
          size="sm"
        >
          {isRegenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              재생성 중...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              요약 재생성
            </>
          )}
        </Button>
      </div>

      {/* 개요 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            회의 개요
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
            {summary.overview}
          </p>
        </CardContent>
      </Card>

      {/* 핵심 사항 */}
      <Card>
        <CardHeader>
          <CardTitle>핵심 논의 사항</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {summary.keyPoints.map((point, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-medium flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-slate-700 dark:text-slate-300">{point}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 의사결정 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-500" />
            의사결정
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {summary.decisions.map((decision, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700 dark:text-slate-300">{decision}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Action Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            Action Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summary.actionItems.map((item, i) => (
              <div key={i} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {item.task}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {item.assignee && (
                        <Badge variant="outline" className="gap-1">
                          <User className="w-3 h-3" />
                          {item.assignee}
                        </Badge>
                      )}
                      {item.deadline && (
                        <Badge variant="outline" className="gap-1">
                          <Clock className="w-3 h-3" />
                          {item.deadline}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {item.priority && (
                    <Badge variant={priorityColors[item.priority]}>
                      {item.priority.toUpperCase()}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* PRD 생성 버튼 */}
      <div className="flex justify-end">
        <Button
          onClick={handleGeneratePrd}
          disabled={isGenerating}
          size="lg"
          className="w-full sm:w-auto"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              PRD 생성 중...
            </>
          ) : (
            <>
              <FileText className="w-5 h-5 mr-2" />
              PRD 생성하기
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default SummaryViewer;
