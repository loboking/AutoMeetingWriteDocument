'use client';

import { useState, useMemo } from 'react';
import {
  Mic, Plus, Trash2, Clock, Users, FileText, ArrowLeft, Sparkles,
  CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DateFormat } from '@/components/DateFormat';
import { formatTime } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';
import { useMeetingStore } from '@/store/meetingStore';
import { authedFetch } from '@/lib/authFetch';
import MeetingRecorder from './MeetingRecorder';
import type { MeetingNote, MeetingSummary, TranscriptSegment } from '@/types';

// 회의록 모드(① 회의록 탭). Meeting(② 기획서)과 별개 엔티티 — 가벼운 산출.
// 흐름: 3入口(녹음/업로드/텍스트) → /api/summarize → createMeetingNote → 리스트.
// "저장 후 종료" 1차 CTA(자기완결). 합성(다중 선택 → PRD 합성) 로직을 이 컴포넌트에서 자체 완결.
// 합성 완료 시 onSynthesisComplete → 부모가 ② 기획서 탭으로 전환.
// MeetingRecorder를 mode='note'로 재사용 — 신규 입력 컴포넌트 없음(YAGNI).

// 브라우저 UUID(store generateId와 동일 패턴).
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// transcriptSegments에서 화자 종류 수. 없으면 1.
function speakerCount(segments?: TranscriptSegment[]): number {
  if (!segments || segments.length === 0) return 1;
  return new Set(segments.map((s) => s.speaker)).size;
}

type ViewState = 'list' | 'new' | 'detail';
type SynthState = 'idle' | 'synthesizing' | 'done' | 'error';

interface MeetingNotePanelProps {
  // 합성 완료 시 호출 → 부모(page.tsx 최상위 2탭)가 ② 기획서 탭으로 전환.
  onSynthesisComplete?: () => void;
}

export function MeetingNotePanel({ onSynthesisComplete }: MeetingNotePanelProps) {
  const meetingNotes = useMeetingStore((s) => s.meetingNotes);
  const createMeetingNote = useMeetingStore((s) => s.createMeetingNote);
  const deleteMeetingNote = useMeetingStore((s) => s.deleteMeetingNote);
  // 합성 로직(NoteAccumulator 흡수). createProject/synthesizeNotes/startCompositeGeneration.
  const createProject = useMeetingStore((s) => s.createProject);
  const synthesizeNotes = useMeetingStore((s) => s.synthesizeNotes);
  const startCompositeGeneration = useMeetingStore((s) => s.startCompositeGeneration);

  const [view, setView] = useState<ViewState>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  // 다중 선택(합성) 모드 — 카드 체크박스. 단일 클릭(상세 뷰)과 독립.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [projectTitle, setProjectTitle] = useState('');
  const [synthState, setSynthState] = useState<SynthState>('idle');
  const [synthError, setSynthError] = useState('');

  const sortedNotes = useMemo(
    () => [...meetingNotes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    [meetingNotes]
  );

  const selectedNote = selectedId
    ? meetingNotes.find((n) => n.id === selectedId) ?? null
    : null;

  // 선택된 회의록(합성 입력). 예상 입력 토큰(대략치) = summary 문자열 길이 합.
  const selectedNotes = useMemo(
    () => selectedIds
      .map((id) => meetingNotes.find((n) => n.id === id))
      .filter((n): n is MeetingNote => !!n?.summary),
    [selectedIds, meetingNotes]
  );
  const estimatedTokens = selectedNotes.reduce((sum, n) => {
    const s = n.summary;
    const len = (s.overview?.length ?? 0)
      + s.keyPoints.join('').length
      + s.decisions.join('').length
      + s.actionItems.map((a) => a.task).join('').length;
    return sum + len;
  }, 0);

  // 전사 결과 → /api/summarize → createMeetingNote → 리스트 복귀.
  // 텍스트 모드는 STT 건너뛰고 transcript 바로 요약.
  const handleTranscriptReady = async (payload: {
    text: string;
    segments?: TranscriptSegment[];
    duration?: number;
    audioUrl?: string;
  }) => {
    if (!payload.text.trim()) {
      setSummarizeError('전사 결과가 비어있습니다.');
      return;
    }
    setSummarizing(true);
    setSummarizeError('');
    try {
      const res = await authedFetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: payload.text, context: '회의록' }),
      });
      if (!res.ok) {
        throw new Error(`요약 실패 (${res.status})`);
      }
      const body = await res.json() as { summary?: MeetingSummary };
      if (!body.summary) throw new Error('빈 요약 응답');

      const title = payload.text.trim().split('\n')[0].slice(0, 40) || `회의록 ${new Date().toLocaleDateString('ko-KR')}`;
      createMeetingNote({
        id: generateId(),
        title,
        transcript: payload.text,
        transcriptSegments: payload.segments,
        summary: body.summary,
        audioUrl: payload.audioUrl,
        duration: payload.duration,
        source: payload.audioUrl ? 'recording' : (payload.segments && payload.segments.length > 0 ? 'file' : 'text'),
      });
      setView('list');
    } catch (e) {
      console.error('[MeetingNotePanel] 요약 실패:', e);
      setSummarizeError(e instanceof Error ? e.message : '요약에 실패했습니다.');
    } finally {
      setSummarizing(false);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('이 회의록을 삭제하시겠습니까?')) {
      deleteMeetingNote(id);
      if (selectedId === id) {
        setSelectedId(null);
        setView('list');
      }
      // 다중 선택에서도 제거
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    }
  };

  const openDetail = (note: MeetingNote) => {
    setSelectedId(note.id);
    setView('detail');
  };

  // === 합성 로직(NoteAccumulator.tsx에서 흡수) ===
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // 합성: synthesizeNotes → createProject(composite) → startCompositeGeneration → onSynthesisComplete.
  // M-1/M-3(좀비 방지): createProject를 synthesizeNotes 성공 후로 미룬다.
  // 임시 projectId는 메모리만. 합성 실패 시 빈 composite project persist 박제 차단.
  const handleSynthesize = async () => {
    if (selectedIds.length < 1) return;
    setSynthError('');
    setSynthState('synthesizing');

    const title = projectTitle.trim() || `통합 프로젝트 ${new Date().toLocaleDateString('ko-KR')}`;
    const id = generateId();
    try {
      // 합성 먼저(project 미생성). sourceNoteIds를 직접 전달.
      const result = await synthesizeNotes(id, selectedIds);
      if (!result) {
        setSynthState('error');
        setSynthError('회의록 합성에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.');
        return;
      }
      // 성공 시에만 project 생성 + masterSummary 저장.
      createProject({
        id,
        title,
        mode: 'composite',
        sourceNoteIds: selectedIds,
        masterSummary: result,
      });
      // 14종 문서 생성 시작(composite project). runGenerationLoop가 store(React 밖)에서 돈다.
      await startCompositeGeneration(id);
      // 합성(생성) 시작 완료 → 부모에게 알려 ② 기획서 탭으로 전환.
      // 사용자는 ② 탭에서 생성 진행을 보게 된다(진입점은 ② 탭 composite 영역 — 도현 설계).
      resetSelection();
      onSynthesisComplete?.();
    } catch (e) {
      console.error('[MeetingNotePanel] 합성 예외:', e);
      setSynthState('error');
      setSynthError(e instanceof Error ? e.message : '합성 중 알 수 없는 오류가 발생했습니다.');
    }
  };

  const resetSelection = () => {
    setSelectedIds([]);
    setProjectTitle('');
    setSynthState('idle');
    setSynthError('');
  };

  const canSynth = selectedIds.length >= 1 && synthState !== 'synthesizing';

  // === 새 회의록 입력 뷰 ===
  if (view === 'new') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setView('list')} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            목록으로
          </Button>
        </div>

        {summarizeError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            <AlertDescription>{summarizeError}</AlertDescription>
          </Alert>
        )}

        {summarizing ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-500" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                회의록을 요약하는 중...
              </p>
              <p className="text-xs text-slate-500">AI가 전사 내용을 분석해 요약·핵심사항·결정사항을 추출합니다.</p>
            </CardContent>
          </Card>
        ) : (
          <MeetingRecorder mode="note" onTranscriptReady={handleTranscriptReady} />
        )}
      </div>
    );
  }

  // === 상세 뷰 ===
  if (view === 'detail' && selectedNote) {
    return (
      <NoteDetail
        note={selectedNote}
        onBack={() => { setSelectedId(null); setView('list'); }}
        onDelete={(e) => handleDelete(selectedNote.id, e)}
      />
    );
  }

  // === 리스트 뷰 ===
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Mic className="w-5 h-5" aria-hidden="true" />
            회의록
          </h3>
          <p className="text-sm text-slate-500">총 {sortedNotes.length}개</p>
        </div>
        <Button onClick={() => { setSummarizeError(''); setView('new'); }} className="gap-1.5">
          <Plus className="w-4 h-4" aria-hidden="true" />
          새 회의록
        </Button>
      </div>

      {/* 합성 에러 */}
      {synthState === 'error' && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <AlertDescription className="space-y-2">
            <div>{synthError}</div>
            <Button size="sm" variant="outline" onClick={resetSelection}>다시 시도</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 합성 진행 로딩 */}
      {synthState === 'synthesizing' && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-500" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              AI가 {selectedIds.length}개 회의록을 합성해 PRD를 생성하는 중...
            </p>
            <p className="text-xs text-slate-500">완료되면 기획서 탭으로 이동합니다.</p>
          </CardContent>
        </Card>
      )}

      {sortedNotes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            <Mic className="w-12 h-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
            <p className="font-medium text-slate-700 dark:text-slate-300">회의록을 녹음하거나 업로드해 시작하세요</p>
            <p className="text-sm mt-2">
              회의록은 화자별 전사와 요약을 자기완결적으로 저장합니다.
              <br />
              회의록을 여러 개 만든 뒤 선택해 하나의 기획서로 합성할 수 있습니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 다중 선택 합성 바 — 1개 이상 선택 시 sticky 노출 */}
          {selectedIds.length > 0 && synthState !== 'synthesizing' && (
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border rounded-lg p-3 space-y-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm">
                  <span className="font-medium">{selectedIds.length}개 선택됨</span>
                  <span className="text-slate-500 ml-2">예상 입력 약 {estimatedTokens.toLocaleString()}자</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={resetSelection}>선택 해제</Button>
                  <Button
                    size="sm"
                    onClick={handleSynthesize}
                    disabled={!canSynth}
                    className="gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    선택 {selectedIds.length}개로 PRD 합성
                  </Button>
                </div>
              </div>
              <Input
                type="text"
                placeholder="합성 프로젝트 제목 (선택)"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                className="h-9"
                aria-label="합성 프로젝트 제목"
              />
            </div>
          )}

          <div className="space-y-3 max-h-[520px] overflow-y-auto">
            {sortedNotes.map((note) => {
              const speakers = speakerCount(note.transcriptSegments);
              const checked = selectedIds.includes(note.id);
              return (
                <Card
                  key={note.id}
                  className={cn(
                    'transition-all hover:shadow-md cursor-pointer',
                    checked && 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                  )}
                  onClick={() => openDetail(note)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* 체크박스 — 클릭 버블링 분리(카드 클릭=상세, 체크박스=선택 토글) */}
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(note.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 w-4 h-4 accent-blue-500 flex-shrink-0"
                          aria-label={`${note.title} 합성 선택`}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{note.title || '제목 없음'}</h4>
                          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <DateFormat date={note.createdAt} format="date" />
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" aria-hidden="true" />
                              {speakers}명
                            </span>
                            {typeof note.duration === 'number' && note.duration > 0 && (
                              <span>{formatTime(note.duration)}</span>
                            )}
                            {note.source && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                                {note.source === 'recording' ? '녹음' : note.source === 'file' ? '업로드' : '텍스트'}
                              </Badge>
                            )}
                          </div>
                          {note.summary?.overview && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 line-clamp-2">
                              {note.summary.overview}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDelete(note.id, e)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                        aria-label="회의록 삭제"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// === 상세 하위 컴포넌트 ===
interface NoteDetailProps {
  note: MeetingNote;
  onBack: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function NoteDetail({ note, onBack, onDelete }: NoteDetailProps) {
  const speakers = speakerCount(note.transcriptSegments);
  const hasSegments = !!note.transcriptSegments && note.transcriptSegments.length > 0;
  const s = note.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          목록으로
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1.5"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          삭제
        </Button>
      </div>

      {/* 헤더 */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="text-lg font-bold break-words">{note.title || '제목 없음'}</h3>
          <div className="flex items-center gap-3 text-sm text-slate-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              <DateFormat date={note.createdAt} format="datetime" />
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" aria-hidden="true" />
              {speakers}명
            </span>
            {typeof note.duration === 'number' && note.duration > 0 && (
              <span>{formatTime(note.duration)}</span>
            )}
            {note.source && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                {note.source === 'recording' ? '녹음' : note.source === 'file' ? '업로드' : '텍스트'}
              </Badge>
            )}
          </div>
          {note.audioUrl && (
            <audio src={note.audioUrl} controls className="w-full mt-2" aria-label="회의록 오디오" />
          )}
        </CardContent>
      </Card>

      {/* 요약 */}
      {s && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-4 h-4" aria-hidden="true" />
              요약
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {s.overview && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">개요</div>
                <p className="text-sm">{s.overview}</p>
              </div>
            )}
            {s.keyPoints.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">핵심 사항 ({s.keyPoints.length})</div>
                <ul className="text-sm space-y-1 list-disc pl-5">
                  {s.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              </div>
            )}
            {s.decisions.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">결정 사항 ({s.decisions.length})</div>
                <ul className="text-sm space-y-1 list-disc pl-5">
                  {s.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {s.actionItems.length > 0 && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">Action Items ({s.actionItems.length})</div>
                <ul className="text-sm space-y-1.5">
                  {s.actionItems.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-blue-500 flex-shrink-0" aria-hidden="true" />
                      <span>
                        {a.task}
                        {a.assignee && <span className="text-slate-500"> · {a.assignee}</span>}
                        {a.deadline && <span className="text-slate-500"> · {a.deadline}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 전사(화자별) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="w-4 h-4" aria-hidden="true" />
            전사
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 gap-0.5">
              <Users className="w-3 h-3" aria-hidden="true" />
              {speakers}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasSegments ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {note.transcriptSegments!.map((seg, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-shrink-0 w-16 text-xs">
                    <div className="font-medium text-blue-600 dark:text-blue-400">
                      {seg.speaker || 'Unknown'}
                    </div>
                    <div className="text-slate-400">
                      {formatTime(seg.start)}
                    </div>
                  </div>
                  <p className="text-sm flex-1">{seg.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap max-h-[400px] overflow-y-auto">
              {note.transcript || '(전사 내용 없음)'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default MeetingNotePanel;
