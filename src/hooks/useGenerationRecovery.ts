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

  useEffect(() => {
    // 미완성 잡이 있으면 재개 시도 (중복은 resumeGeneration 내부에서 차단)
    const tryResume = () => {
      const { activeJob, isGenerating } = useMeetingStore.getState();
      if (activeJob && activeJob.status === 'running' && !isGenerating) {
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
