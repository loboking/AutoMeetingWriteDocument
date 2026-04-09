'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface WBSTask {
  id: string;
  name: string;
  level: number;
  parent?: string;
  assignee?: string;
  status: 'todo' | 'in-progress' | 'done';
  days?: number;
  startDay?: number;
  children?: WBSTask[];
}

interface WBSViewerProps {
  content: string;
}

function parseWBS(content: string): WBSTask[] {
  const lines = content.split('\n');
  const tasks: WBSTask[] = [];
  const taskMap = new Map<string, WBSTask>();

  // WBS 테이블 파싱
  const tableMatch = content.match(/\|[^|]+WBS[^|]*\|[\s\S]+?\n\n/);
  if (tableMatch) {
    const tableLines = tableMatch[0].split('\n').slice(2);
    let idx = 1;
    for (const line of tableLines) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        const idMatch = cells[0].match(/(WBS-\d+|[A-Z]\.\d+)/i);
        if (idMatch || cells[0]) {
          const task: WBSTask = {
            id: idMatch ? idMatch[1] : `WBS-${String(idx++).padStart(3, '0')}`,
            name: cells[1] || '',
            level: (cells[0]?.match(/^\./g) || []).length + 1,
            status: 'todo',
          };
          tasks.push(task);
          taskMap.set(task.id, task);
        }
      }
    }
  }

  // 텍스트에서 작업 추출 (fallback)
  if (tasks.length === 0) {
    const workMatches = content.matchAll(/(?:작업|Work|Task)[:\s]+(.+?)(?:\n|담당자|기간)/gi);
    let idx = 1;
    for (const m of workMatches) {
      const name = m[1].trim();
      if (name && name.length > 2 && name.length < 100) {
        tasks.push({
          id: `WBS-${String(idx++).padStart(3, '0')}`,
          name,
          level: 1,
          status: 'todo',
        });
      }
    }
  }

  return tasks;
}

const statusColors = {
  'todo': 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'done': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
};

export function WBSViewer({ content }: WBSViewerProps) {
  const tasks = useMemo(() => parseWBS(content), [content]);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const toggleTask = (id: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedTasks(newExpanded);
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500 dark:text-slate-400">
        <p>WBS 작업을 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span className="w-3 h-3 bg-orange-500 rounded-full"></span>
          WBS 작업 분류 구조
        </h3>
        <span className="text-sm text-slate-600 dark:text-slate-400">총 {tasks.length}개 작업</span>
      </div>

      {/* 간트 차트 스타일 타임라인 */}
      <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <div className="min-w-[600px]">
          {/* 타임라인 헤더 */}
          <div className="flex border-b border-slate-200 dark:border-slate-700 pb-2 mb-4">
            <div className="w-48 flex-shrink-0 font-semibold text-sm text-slate-700 dark:text-slate-300">작업명</div>
            <div className="flex-1 flex">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex-1 text-center text-xs text-slate-500 dark:text-slate-400 border-l border-slate-100 dark:border-slate-800">
                  {i + 1}주
                </div>
              ))}
            </div>
          </div>

          {/* 작업 바 */}
          {tasks.map((task, idx) => (
            <div key={task.id} className="flex items-center py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
              <div
                className="w-48 flex-shrink-0 flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 px-2 py-1 rounded"
                style={{ paddingLeft: `${(task.level - 1) * 16 + 8}px` }}
                onClick={() => toggleTask(task.id)}
              >
                <span className="text-xs text-slate-500">{task.id}</span>
                <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{task.name}</span>
              </div>
              <div className="flex-1 relative h-8">
                {/* 작업 바 */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 transition-colors cursor-pointer shadow-sm"
                  style={{
                    left: `${(idx % 8) * 12}%`,
                    width: `${Math.max(15, (task.id.length * 2))}%`,
                  }}
                  title={`${task.name} (예상기간: ${task.days || 3}일)`}
                >
                  <span className="text-xs text-white font-medium px-2 truncate block">
                    {task.days || 3}d
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 트리 뷰 */}
      <div className="bg-white dark:bg-slate-950 rounded-lg overflow-hidden shadow-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">작업 트리</span>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {tasks.map((task) => (
            <div key={task.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 flex items-center justify-center cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  onClick={() => toggleTask(task.id)}
                >
                  {expandedTasks.has(task.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                <span className="text-xs font-mono text-slate-500">{task.id}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-white">{task.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[task.status]}`}>
                      {task.status === 'todo' ? '대기' : task.status === 'in-progress' ? '진행중' : '완료'}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {task.assignee || '미정'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 진행률 요약 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700 text-center">
          <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">{tasks.length}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">전체 작업</div>
        </div>
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700 text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">0</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">진행 중</div>
        </div>
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">0</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">완료</div>
        </div>
      </div>
    </div>
  );
}
