'use client';

import { useState } from 'react';
import { useMeetingStore } from '@/store/meetingStore';
import { DOCUMENTS } from '@/lib/documentUtils';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useGenerationRecovery } from '@/hooks/useGenerationRecovery';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, X } from 'lucide-react';

// 전역 생성 가드: PrdViewer 언마운트(탭 이동)와 무관하게
// (1) 새로고침 후 미완성 잡 자동 재개 (2) 어디서든 보이는 진행률+종료 버튼
// (3) 종료는 명시적 확인 후에만
export default function GenerationGuard() {
  useGenerationRecovery(); // 새로고침/재방문 시 미완성 잡 자동 재개

  const isGenerating = useMeetingStore((s) => s.isGenerating);
  const progress = useMeetingStore((s) => s.generationProgress);
  const cancelGeneration = useMeetingStore((s) => s.cancelGeneration);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  useBeforeUnload(
    isGenerating,
    '문서 생성 진행 상황은 저장됩니다. 다시 방문하면 남은 문서부터 이어서 생성됩니다.'
  );

  // 생성 중이거나, 종료됐어도 결과(완료/실패)를 잠깐 보여줄 progress가 있으면 렌더
  if (!progress) return null;
  const isDone = !isGenerating && (progress.status === 'completed' || progress.status === 'error');
  if (!isGenerating && !isDone) return null;

  const done = progress.completedDocs.length;
  const total = progress.totalLevels;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const failed = progress.failedDocs || [];
  const failedNames = failed
    .map((d) => DOCUMENTS.find((x) => x.key === d)?.title || d)
    .join(', ');

  return (
    <>
      <div
        className="fixed right-4 z-[100] w-80 max-w-[90vw] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-4"
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            {isDone ? (
              <span className={`flex-shrink-0 text-base ${progress.status === 'error' ? 'text-amber-500' : 'text-green-500'}`}>
                {progress.status === 'error' ? '⚠️' : '✅'}
              </span>
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
            )}
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
              {isDone
                ? progress.status === 'error'
                  ? '생성 완료 (일부 실패)'
                  : '전체 생성 완료'
                : progress.currentDoc
                  ? `${progress.currentDoc} 생성 중`
                  : '문서 생성 중'}
            </span>
          </div>
          {!isDone && (
            <button
              onClick={() => setShowCancelDialog(true)}
              className="flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              title="생성 종료"
            >
              <X className="w-3.5 h-3.5" />
              종료
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {!isDone && progress.currentDoc ? `${done + 1}번째 · ${total}개 중` : '전체 문서 자동 생성'}
          </span>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {done} / {total}
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${progress.status === 'error' ? 'bg-amber-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {failed.length > 0 ? (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">
            실패 {failed.length}개: {failedNames} — 해당 문서를 열어 다시 생성하세요
          </p>
        ) : (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
            {isDone ? '완료되었습니다' : '새로고침/탭 이동 후 다시 오면 남은 문서부터 이어서 생성됩니다'}
          </p>
        )}
      </div>

      {/* 명시적 종료 확인 다이얼로그 */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문서 생성을 종료할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              지금까지 생성된 <span className="font-semibold">{done}개</span> 문서는 저장됩니다.
              {total - done > 0 && (
                <> 남은 <span className="font-semibold">{total - done}개</span> 문서는 생성되지 않습니다.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>아니오, 계속 생성</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelGeneration();
                setShowCancelDialog(false);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              예, 종료
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
