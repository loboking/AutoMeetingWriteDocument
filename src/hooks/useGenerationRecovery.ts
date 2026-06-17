'use client';

// 미완성 문서 생성 잡을 자동 재개한다.
// (1) 마운트 직후 1회 (새로고침/재방문)
// (2) 화면 복귀(visibilitychange='visible')/BFCache 복귀(pageshow)마다
//     → 모바일 웹뷰가 백그라운드에서 생성을 멈춘 뒤 돌아왔을 때 즉시 이어서 생성.
// resumeGeneration은 내부에 isGenerating 가드 + status==='running' 체크 +
// navigator.locks(ifAvailable)가 있어 중복/좀비 없이 안전하게 반복 호출 가능.
import { useEffect, useRef } from 'react';
import { useMeetingStore } from '@/store/meetingStore';

export function useGenerationRecovery() {
  const resumeGeneration = useMeetingStore((s) => s.resumeGeneration);
  const tried = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    // 미완성 잡이 있으면 재개 시도 (중복은 resumeGeneration 내부에서 차단)
    // 모바일은 알림/키보드/시스템 다이얼로그로 visibilitychange가 연속 발화할 수 있어
    // 1.5초 디바운스로 중복 호출/미세 race를 차단.
    const tryResume = () => {
      const now = Date.now();
      if (now - lastRun.current < 1500) return;
      const { activeJob, isGenerating } = useMeetingStore.getState();
      // running(정상 미완) 또는 error(일부 실패 미완)면 재개 시도.
      // 실제 재개 가부/횟수 상한은 resumeGeneration 내부에서 판정(여기선 넓게 호출).
      const resumable =
        !!activeJob && (activeJob.status === 'running' || activeJob.status === 'error');
      if (resumable && !isGenerating) {
        lastRun.current = now;
        void resumeGeneration();
      }
    };

    // (1) 마운트 1회 — persist 리하이드레이션 완료 보장 위해 한 박자 뒤
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!tried.current) {
      tried.current = true;
      t = setTimeout(tryResume, 300);
    }

    // (2) 화면 복귀마다 재개 (가드 없이 — 복귀할 때마다 발화해야 함)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tryResume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // BFCache(뒤로가기 캐시)에서 복원될 때
    window.addEventListener('pageshow', tryResume);

    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', tryResume);
    };
  }, [resumeGeneration]);
}
