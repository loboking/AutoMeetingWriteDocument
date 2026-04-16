import { useEffect } from 'react';

/**
 * 페이지 이탈 방지 훅
 * @param shouldPrevent - 이탈 방지 조건
 * @param message - 표시할 메시지
 */
export function useBeforeUnload(
  shouldPrevent: boolean,
  message: string = '작업 중입니다. 페이지를 나가시면 진행 중인 작업이 취소됩니다.'
): void {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldPrevent) {
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldPrevent, message]);
}
