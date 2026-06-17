'use client';

import { useState } from 'react';
import { useMeetingStore } from '@/store/meetingStore';
import { DOCUMENTS } from '@/lib/documentUtils';
import { useBeforeUnload } from '@/hooks/useBeforeUnload';
import { useGenerationRecovery } from '@/hooks/useGenerationRecovery';
import { useWakeLock } from '@/hooks/useWakeLock';
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
import { Loader2, X, Check } from 'lucide-react';

// 전역 생성 가드: PrdViewer 언마운트(탭 이동)와 무관하게
// (1) 새로고침 후 미완성 잡 자동 재개 (2) 어디서든 보이는 진행 + 종료 버튼
// (3) 종료는 명시적 확인 후에만
//
// 생성 중: 전면 딤 오버레이 + 큰 진행 카드(현재 문서/단계/완료목록/주의안내).
// 완료·실패: 딤 없이 작은 토스트로 결과만 잠깐 표시.
export default function GenerationGuard() {
  useGenerationRecovery(); // 새로고침/재방문 시 미완성 잡 자동 재개

  const isGenerating = useMeetingStore((s) => s.isGenerating);
  const progress = useMeetingStore((s) => s.generationProgress);
  const cancelGeneration = useMeetingStore((s) => s.cancelGeneration);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  useWakeLock(isGenerating); // 생성 중 화면 꺼짐 방지 (모바일 백그라운드 동결 완화)

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
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const failed = progress.failedDocs || [];
  const failedNames = failed
    .map((d) => DOCUMENTS.find((x) => x.key === d)?.title || d)
    .join(', ');

  // ── 완료/실패: 작은 토스트(딤 없음) ──────────────────────────────
  if (isDone) {
    return (
      <div
        className="fixed right-4 z-[100] w-80 max-w-[90vw] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-4"
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-base ${progress.status === 'error' ? 'text-amber-500' : 'text-green-500'}`}>
            {progress.status === 'error' ? '⚠️' : '✅'}
          </span>
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {progress.status === 'error' ? '생성 완료 (일부 실패)' : '전체 생성 완료'}
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${progress.status === 'error' ? 'bg-amber-500' : 'bg-green-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {failed.length > 0 ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            실패 {failed.length}개: {failedNames} — 해당 문서를 열어 다시 생성하세요
          </p>
        ) : (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">완료되었습니다</p>
        )}
      </div>
    );
  }

  // ── 생성 중: 전면 딤 오버레이 + 큰 진행 카드 ──────────────────────
  // 현재 진행 인덱스(완료 + 1, 단 total 초과 방지)
  const currentIndex = Math.min(done + 1, total);
  // 단계(레벨) 정보 — DOCUMENTS 평탄 순서 기준으로 현재 문서 위치 표시
  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4
                   bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
        role="dialog"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          className="w-full max-w-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                     rounded-2xl shadow-2xl p-6"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" />
              <span className="text-base font-semibold text-slate-900 dark:text-slate-50 truncate">
                문서 자동 생성 중
              </span>
            </div>
            <button
              onClick={() => setShowCancelDialog(true)}
              className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md
                         bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400
                         hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              title="생성 종료"
            >
              <X className="w-3.5 h-3.5" />
              종료
            </button>
          </div>

          {/* 현재 문서 + 진행 카운트 */}
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {progress.currentDoc ? (
              <>
                <span className="font-medium text-slate-700 dark:text-slate-200">{progress.currentDoc}</span>
                {' '}생성 중 · {currentIndex}/{total}번째
              </>
            ) : (
              <>전체 {total}개 문서를 의존성 순서대로 생성합니다</>
            )}
          </p>

          {/* 큰 진행률 바 + 퍼센트 */}
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-3xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{pct}%</span>
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 tabular-nums">
              {done} / {total} 완료
            </span>
          </div>
          <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* 완료 문서 칩 목록 (정보성) */}
          {done > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4 max-h-24 overflow-y-auto">
              {progress.completedDocs.map((d) => {
                const title = DOCUMENTS.find((x) => x.key === d)?.title || d;
                return (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full
                               bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  >
                    <Check className="w-3 h-3" />
                    {title}
                  </span>
                );
              })}
            </div>
          )}

          {/* 실패 표시 (있으면) */}
          {failed.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
              실패 {failed.length}개: {failedNames} — 끝난 뒤 해당 문서를 열어 다시 생성하세요
            </p>
          )}

          {/* 모바일 백그라운드 주의 안내 */}
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-3 py-2.5">
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              ⚠️ 다른 앱으로 나가면 생성이 멈출 수 있어요.
              <span className="font-medium"> 화면을 켜둔 채 기다리면</span> 가장 빠릅니다.
              나갔다 돌아오면 남은 문서부터 자동으로 이어집니다.
            </p>
          </div>
        </div>
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
