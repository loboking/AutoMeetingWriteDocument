'use client';

import { useState, useMemo } from 'react';
import { Layers, Sparkles, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { useMeetingStore } from '@/store/meetingStore';
import { DateFormat } from '@/components/DateFormat';
import { cn } from '@/lib/utils';

// 브라우저 환경 UUID 생성(store의 generateId와 동일 패턴. 컴포넌트 로컬 사용).
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// NoteAccumulator: 여러 회의 요약을 모아 하나의 합성 프로젝트(composite)를 만드는 UX.
// 흐름: 회의 다중선택 → 합성 프로젝트 생성 → synthesizeNotes 호출 → 문서생성 시작.
// 단일회의 흐름(page.tsx)은 무변경. 이 컴포넌트는 별도 진입점(모달/탭)에서 렌더된다.

type SynthState = 'idle' | 'synthesizing' | 'done' | 'error';

export function NoteAccumulator({ onClose }: { onClose?: () => void }) {
  const meetings = useMeetingStore((s) => s.meetings);
  const projects = useMeetingStore((s) => s.projects);
  const createProject = useMeetingStore((s) => s.createProject);
  const synthesizeNotes = useMeetingStore((s) => s.synthesizeNotes);
  const startCompositeGeneration = useMeetingStore((s) => s.startCompositeGeneration);
  const getProject = useMeetingStore((s) => s.getProject);
  const isGenerating = useMeetingStore((s) => s.isGenerating);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [synthState, setSynthState] = useState<SynthState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // summary가 있는 회의만 선택 가능
  const eligibleMeetings = useMemo(
    () => meetings.filter((m) => !!m.summary),
    [meetings]
  );

  // 이미 합성된 프로젝트(완료된 것도 표시)
  const compositeProjects = projects.filter((p) => p.mode === 'composite');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const canCreate = selectedIds.length >= 2 && synthState !== 'synthesizing';

  // 1) 합성 프로젝트 생성 + synthesizeNotes 호출
  // M-1/M-3(좀비 방지): createProject를 synthesizeNotes 성공 후로 미룬다.
  // 임시 projectId는 메모리만. 합성 실패/탭 종료 시 빈 composite project가 persist에 박제되지 않게.
  const handleSynthesize = async () => {
    if (selectedIds.length < 2) return;
    setErrorMsg('');
    setSynthState('synthesizing');

    const title = projectTitle.trim() || `통합 프로젝트 ${new Date().toLocaleDateString('ko-KR')}`;
    const id = generateId();
    setProjectId(id);
    try {
      // 합성 먼저 시도(project 미생성 상태). sourceNoteIds를 직접 전달.
      const result = await synthesizeNotes(id, selectedIds);
      if (!result) {
        setProjectId(null);
        setSynthState('error');
        setErrorMsg('회의록 합성에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.');
        return;
      }
      // 성공한 경우에만 project 생성 + masterSummary 저장.
      createProject({
        id,
        title,
        mode: 'composite',
        sourceNoteIds: selectedIds,
        masterSummary: result,
      });
      setSynthState('done');
    } catch (e) {
      console.error('[NoteAccumulator] 합성 예외:', e);
      setProjectId(null);
      setSynthState('error');
      setErrorMsg(e instanceof Error ? e.message : '합성 중 알 수 없는 오류가 발생했습니다.');
    }
  };

  // 2) 합성 완료 후 문서 생성 시작
  const handleStartGeneration = async () => {
    if (!projectId) return;
    await startCompositeGeneration(projectId);
    onClose?.();
  };

  const reset = () => {
    setSelectedIds([]);
    setProjectTitle('');
    setProjectId(null);
    setSynthState('idle');
    setErrorMsg('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5" aria-hidden="true" />
            회의록 통합
          </h2>
          <p className="text-sm text-slate-500">
            여러 회의 요약을 하나로 합성해 단일 문서세트를 생성합니다.
          </p>
        </div>
        {onClose && (
          <Button onClick={onClose} variant="outline" size="sm">닫기</Button>
        )}
      </div>

      {synthState === 'idle' && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              통합 프로젝트 제목 (선택)
            </label>
            <Input
              type="text"
              placeholder="예: 2026 Q3 제품 기획 통합"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              className="h-11"
              aria-label="통합 프로젝트 제목"
            />
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-400">
            합성할 회의를 2개 이상 선택하세요 ({selectedIds.length}개 선택)
          </div>

          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {eligibleMeetings.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-slate-500">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" aria-hidden="true" />
                  <p>요약이 완료된 회의가 없습니다.</p>
                  <p className="text-xs mt-1">먼저 회의를 녹음/업로드해 요약을 생성하세요.</p>
                </CardContent>
              </Card>
            ) : (
              eligibleMeetings.map((m) => {
                const checked = selectedIds.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      checked
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(m.id)}
                      className="mt-1 w-4 h-4 accent-blue-500"
                      aria-label={`${m.title} 선택`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{m.title || '제목 없음'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <DateFormat date={m.createdAt} format="datetime" />
                      </div>
                      {m.summary?.overview && (
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                          {m.summary.overview}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              onClick={handleSynthesize}
              disabled={!canCreate}
              className="gap-2"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              {selectedIds.length < 2
                ? '2개 이상 선택하세요'
                : `${selectedIds.length}개 회의 통합 합성`}
            </Button>
          </div>
        </>
      )}

      {synthState === 'synthesizing' && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              AI가 {selectedIds.length}개 회의를 하나의 요약으로 합성하는 중...
            </p>
            <p className="text-xs text-slate-400">최대 30초 소요될 수 있습니다.</p>
          </CardContent>
        </Card>
      )}

      {synthState === 'done' && projectId && (
        <Card className="border-green-200 dark:border-green-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
              합성 완료
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const p = getProject(projectId);
              if (!p?.masterSummary) return null;
              return (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-slate-500 mb-1">통합 개요</div>
                    <p className="text-sm">{p.masterSummary.overview}</p>
                  </div>
                  {p.masterSummary.keyPoints.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-slate-500 mb-1">
                        핵심 사항 ({p.masterSummary.keyPoints.length})
                      </div>
                      <ul className="text-sm space-y-1 list-disc pl-5">
                        {p.masterSummary.keyPoints.slice(0, 5).map((k, i) => (
                          <li key={i}>{k}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button variant="outline" onClick={reset}>새 통합 만들기</Button>
              <Button onClick={handleStartGeneration} disabled={isGenerating} className="gap-2">
                <Layers className="w-4 h-4" aria-hidden="true" />
                {isGenerating ? '생성 중...' : '14종 문서 생성 시작'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {synthState === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <div>{errorMsg}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={reset}>다시 시도</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 기존 합성 프로젝트 목록 */}
      {compositeProjects.length > 0 && synthState === 'idle' && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            기존 통합 프로젝트
          </div>
          <div className="space-y-2">
            {compositeProjects.map((p) => (
              <Card key={p.id}>
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {p.title}
                      <Badge variant="secondary" className="shrink-0">
                        <Layers className="w-3 h-3 mr-1" aria-hidden="true" />
                        {p.sourceNoteIds.length}개 통합
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      <DateFormat date={p.createdAt} format="datetime" />
                      {' · '}
                      {p.completedDocs.length}/14 문서
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NoteAccumulator;
