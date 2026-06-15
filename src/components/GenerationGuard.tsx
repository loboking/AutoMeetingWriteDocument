'use client';

import { useMeetingStore } from '@/store/meetingStore';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { Loader2, X } from 'lucide-react';

// 전역 생성 가드: PrdViewer 언마운트(탭 이동)와 무관하게
// (1) beforeunload 경고 유지 (2) 어디서든 보이는 진행률+취소 플로팅 바
export default function GenerationGuard() {
  const isGenerating = useMeetingStore((s) => s.isGenerating);
  const progress = useMeetingStore((s) => s.generationProgress);
  const cancelGeneration = useMeetingStore((s) => s.cancelGeneration);

  useBeforeUnload(isGenerating, '문서 생성이 진행 중입니다. 나가시면 진행 중 작업이 취소됩니다.');

  if (!isGenerating || !progress) return null;

  const pct = progress.totalLevels > 0 ? (progress.completedDocs.length / progress.totalLevels) * 100 : 0;

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 max-w-[90vw] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {progress.currentDoc ? `${progress.currentDoc} 생성 중` : '문서 생성 중'}
          </span>
        </div>
        <button
          onClick={cancelGeneration}
          className="flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          title="생성 취소"
        >
          <X className="w-3.5 h-3.5" />
          취소
        </button>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400">전체 문서 자동 생성</span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {progress.completedDocs.length} / {progress.totalLevels}
        </span>
      </div>
      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
        다른 탭으로 이동해도 생성은 계속 진행됩니다
      </p>
    </div>
  );
}
