'use client';

// 백그라운드 진입 감지 → 포그라운드 복귀 시 동적 경고.
// iOS Safari 한계: 백그라운드에서 UI 렌더 불가. "진입 순간 경고"는 보이지 않으므로
// 2단계로 동작한다 — (1) hidden 진입 시 ref에 기록, (2) visible 복귀 시 경고 상태 반환.
// BFCache 복원(pageshow persisted)도 동일 트리거.
//
// 반환: [bgWarning, dismissBgWarning].
//   - bgWarning = isRecording && 내부 경고 플래그. 녹음 종료 시 자동 false(리셋 효과).
//   - dismissBgWarning = 사용자 수동 닫기(X). 내부 플래그를 false로 — 같은 녹음 세션에서 1회성.
//     재진입(또는 BFCache 복원) 시 내부 플래그가 다시 true가 되며 배너 재노출.
//
// effect에서 setBgWarning(false)를 동기 호출하지 않는다(react-hooks/set-state-in-effect 위반).
// 리셋은 (a) 반환값 파생(isRecording && ...), (b) dismissBgWarning 콜백(외부 onClick)으로만.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useRecordingBackgroundWarning(
  isRecording: boolean,
): [boolean, () => void] {
  const [warning, setWarning] = useState(false);
  const bgEnteredRef = useRef(false);

  useEffect(() => {
    if (!isRecording) return; // 녹음 중이 아니면 감지 중지.

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // 1단계: 진입 기록(UI는 못 보여도 상태 기록이 핵심).
        bgEnteredRef.current = true;
      } else if (document.visibilityState === 'visible' && bgEnteredRef.current) {
        // 2단계: 복귀 + 과거 진입 기록 → 경고 발생.
        setWarning(true);
        bgEnteredRef.current = false; // 1회성 알림(재진입 시 재발생).
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      // BFCache 복원 — 백그라운드 다녀온 것과 동일 취급.
      if (event.persisted) setWarning(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [isRecording]);

  const dismiss = useCallback(() => setWarning(false), []);

  // 파생: 녹음 중일 때만 경고 의미 있음. 녹음 종료 시 자동 false(리셋 효과).
  return [isRecording && warning, dismiss];
}
