'use client';

// 새로고침/재방문 후 미완성 문서 생성 잡을 자동 재개한다.
// activeJob(persist)이 'running'이고 아직 생성 중이 아니면 resumeGeneration() 1회 호출.
import { useEffect, useRef } from 'react';
import { useMeetingStore } from '@/store/meetingStore';

export function useGenerationRecovery() {
  const resumeGeneration = useMeetingStore((s) => s.resumeGeneration);
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    // persist 리하이드레이션 직후 한 박자 뒤 확인 (rehydrate 완료 보장)
    const t = setTimeout(() => {
      const { activeJob, isGenerating } = useMeetingStore.getState();
      if (activeJob && activeJob.status === 'running' && !isGenerating) {
        void resumeGeneration();
      }
    }, 300);
    return () => clearTimeout(t);
  }, [resumeGeneration]);
}
