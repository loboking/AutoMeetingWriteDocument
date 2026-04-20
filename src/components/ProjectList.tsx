'use client';

import { useState, useEffect, memo } from 'react';
import { FolderOpen, Trash2, Clock, FileText, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMeetingStore } from '@/store/meetingStore';
import type { Meeting } from '@/types';
import { DateFormat } from '@/components/DateFormat';

interface ProjectListProps {
  onClose: () => void;
}

// 개별 프로젝트 카드 (memo 적용으로 불필요한 리렌더링 방지)
interface MeetingCardProps {
  meeting: Meeting;
  isCurrent: boolean;
  docCount: number;
  onLoad: (meeting: Meeting) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const MeetingCard = memo(({ meeting, isCurrent, docCount, onLoad, onDelete }: MeetingCardProps) => (
  <Card
    className={`transition-all hover:shadow-md ${
      isCurrent ? 'ring-2 ring-blue-500 opacity-60' : 'cursor-pointer'
    }`}
    onClick={() => !isCurrent && onLoad(meeting)}
  >
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium truncate">{meeting.title || '제목 없음'}</h3>
            {isCurrent && (
              <Badge variant="default" className="gap-1">
                현재
              </Badge>
            )}
            {meeting.isCompleted && (
              <Badge variant="secondary" className="gap-1">
                <Check className="w-3 h-3" />
                완료
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              <DateFormat date={meeting.createdAt} format="date" />
            </span>
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" aria-hidden="true" />
              {docCount}/11 문서
            </span>
          </div>
          {meeting.summary && (
            <p className="text-sm text-slate-600 mt-2 line-clamp-2">
              {meeting.summary.overview}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => onDelete(meeting.id, e)}
          className="text-red-500 hover:text-red-700 hover:bg-red-50"
          aria-label="프로젝트 삭제"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </CardContent>
  </Card>
));

MeetingCard.displayName = 'MeetingCard';

export function ProjectList({ onClose }: ProjectListProps) {
  const meetings = useMeetingStore(s => s.meetings);
  const currentMeeting = useMeetingStore(s => s.currentMeeting);
  const { deleteMeeting, setCurrentMeeting } = useMeetingStore();
  const [filter, setFilter] = useState<'all' | 'in-progress' | 'completed'>('all');

  // 생성일 역순 정렬
  const sortedMeetings = [...meetings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // 필터링
  const filteredMeetings = sortedMeetings.filter((meeting) => {
    if (filter === 'in-progress') return !meeting.isCompleted;
    if (filter === 'completed') return meeting.isCompleted;
    return true;
  });

  // 문서 생성 수 계산
  const getDocumentCount = (meeting: Meeting) => {
    const docs = [
      meeting.prd,
      meeting.featureList,
      meeting.screenList,
      meeting.ia,
      meeting.wireframe,
      meeting.storyboard,
      meeting.userStory,
      meeting.wbs,
      meeting.apiSpec,
      meeting.testPlan,
      meeting.deployment,
    ];
    return docs.filter(Boolean).length;
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('프로젝트를 삭제하시겠습니까?')) {
      deleteMeeting(id);
    }
  };

  const handleLoad = (meeting: Meeting) => {
    setCurrentMeeting(meeting);
    onClose();
  };

  // 현재 프로젝트는 목록에서도 표시하지만 비활성화 표시
  const displayMeetings = filteredMeetings;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">프로젝트 목록</h2>
          <p className="text-sm text-slate-500">
            총 {displayMeetings.length}개 프로젝트
          </p>
        </div>
        <Button onClick={onClose} variant="outline" size="sm">
          닫기
        </Button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          전체
        </Button>
        <Button
          variant={filter === 'in-progress' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('in-progress')}
        >
          진행 중
        </Button>
        <Button
          variant={filter === 'completed' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('completed')}
        >
          완료됨
        </Button>
      </div>

      {/* 프로젝트 목록 */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {displayMeetings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-500">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>프로젝트가 없습니다.</p>
            </CardContent>
          </Card>
        ) : (
          displayMeetings.map((meeting) => {
            const docCount = getDocumentCount(meeting);
            const isCurrent = meeting.id === currentMeeting?.id;

            return (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                isCurrent={isCurrent}
                docCount={docCount}
                onLoad={handleLoad}
                onDelete={handleDelete}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export default ProjectList;
