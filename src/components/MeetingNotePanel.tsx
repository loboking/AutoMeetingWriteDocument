'use client';

import { useState, useMemo } from 'react';
import {
  Mic, Plus, Trash2, Clock, Users, FileText, ArrowLeft, ArrowRight, Layers,
  CheckCircle2, Loader2, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DateFormat } from '@/components/DateFormat';
import { formatTime } from '@/lib/timeUtils';
import { useMeetingStore } from '@/store/meetingStore';
import { authedFetch } from '@/lib/authFetch';
import MeetingRecorder from './MeetingRecorder';
import type { MeetingNote, MeetingSummary, TranscriptSegment } from '@/types';

// 회의록 모드(① 회의록 탭). Meeting(② 기획서)과 별개 엔티티 — 가벼운 산출.
// 흐름: 3入口(녹음/업로드/텍스트) → /api/summarize → createMeetingNote → 리스트.
// "저장 후 종료" 1차 CTA(자기완결). "합성 탭에서 결합" 선택 안내.
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

interface MeetingNotePanelProps {
  // "합성 탭에서 결합" 버튼 → 부모(ProjectList)가 ③ composite 탭으로 전환.
  onGoToSynthesize?: () => void;
}

export function MeetingNotePanel({ onGoToSynthesize }: MeetingNotePanelProps) {
  const meetingNotes = useMeetingStore((s) => s.meetingNotes);
  const createMeetingNote = useMeetingStore((s) => s.createMeetingNote);
  const deleteMeetingNote = useMeetingStore((s) => s.deleteMeetingNote);

  const [view, setView] = useState<ViewState>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState('');

  const sortedNotes = useMemo(
    () => [...meetingNotes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    [meetingNotes]
  );

  const selectedNote = selectedId
    ? meetingNotes.find((n) => n.id === selectedId) ?? null
    : null;

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
    }
  };

  const openDetail = (note: MeetingNote) => {
    setSelectedId(note.id);
    setView('detail');
  };

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
        onGoToSynthesize={onGoToSynthesize}
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

      {sortedNotes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            <Mic className="w-12 h-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
            <p className="font-medium text-slate-700 dark:text-slate-300">회의록을 녹음하거나 업로드해 시작하세요</p>
            <p className="text-sm mt-2">
              회의록은 화자별 전사와 요약을 자기완결적으로 저장합니다.
              <br />
              합성 탭에서 여러 회의록을 모아 기획서를 만들 수 있습니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 max-h-[520px] overflow-y-auto">
          {sortedNotes.map((note) => {
            const speakers = speakerCount(note.transcriptSegments);
            return (
              <Card
                key={note.id}
                className="transition-all hover:shadow-md cursor-pointer"
                onClick={() => openDetail(note)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
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
      )}
    </div>
  );
}

// === 상세 하위 컴포넌트 ===
interface NoteDetailProps {
  note: MeetingNote;
  onBack: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onGoToSynthesize?: () => void;
}

function NoteDetail({ note, onBack, onDelete, onGoToSynthesize }: NoteDetailProps) {
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

      {/* 합성 안내 — 선택 CTA. 자동 합성 아님, ③ 탭에서 명시적 선택. */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <div className="font-medium">여러 회의록을 하나로 합성</div>
              <div className="text-slate-600 dark:text-slate-400">
                합성 탭에서 이 회의록을 선택해 단일 기획서 세트를 만들 수 있습니다.
              </div>
            </div>
          </div>
          {onGoToSynthesize && (
            <Button variant="outline" size="sm" onClick={onGoToSynthesize} className="gap-1.5 flex-shrink-0">
              합성 탭으로
              <ArrowRight className="w-3 h-3" aria-hidden="true" />
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default MeetingNotePanel;
