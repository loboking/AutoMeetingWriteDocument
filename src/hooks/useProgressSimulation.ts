import { useState, useCallback, useRef } from 'react';

/**
 * 진행률 시뮬레이션 훅
 * @param intervalMs - 업데이트 간격 (밀리초), 기본값 200ms
 * @param increment - 각 단계 증가량, 기본값 10
 * @param maxProgress - 최대 진행률, 기본값 90
 */
export function useProgressSimulation(
  intervalMs: number = 200,
  increment: number = 10,
  maxProgress: number = 90
) {
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startSimulation = useCallback(() => {
    setProgress(0);

    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= maxProgress) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return maxProgress;
        }
        return prev + increment;
      });
    }, intervalMs);
  }, [intervalMs, increment, maxProgress]);

  const stopSimulation = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const completeSimulation = useCallback(() => {
    stopSimulation();
    setProgress(100);
  }, [stopSimulation]);

  const resetSimulation = useCallback(() => {
    stopSimulation();
    setProgress(0);
  }, [stopSimulation]);

  return {
    progress,
    startSimulation,
    stopSimulation,
    completeSimulation,
    resetSimulation,
  };
}
