'use client';

// 화면 꺼짐 방지(Screen Wake Lock). 문서 생성 중 화면이 자동으로 꺼지면
// (= 백그라운드 진입) iOS/Android 모두 JS가 동결돼 생성이 멈춘다. active=true인 동안
// 화면을 켜둬 "사용자가 그냥 두면 완주"되게 한다.
//
// 한계: Wake Lock은 문서가 hidden되면(다른 앱 전환) 자동 해제된다. 즉 "앱 전환"은
// 못 막고 "화면 자동 꺼짐"만 막는다. visible 복귀 시 재요청한다(자동 해제 대응).
// 미지원 브라우저는 graceful no-op.
import { useEffect, useRef } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; released: boolean };
type WakeLockNavigator = {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined') return; // SSR 가드
    const wl = (navigator as WakeLockNavigator).wakeLock;
    if (!wl?.request) return; // 미지원 → no-op

    let cancelled = false;

    const acquire = async () => {
      if (!active || cancelled) return;
      if (sentinelRef.current && !sentinelRef.current.released) return; // 이미 보유
      try {
        sentinelRef.current = await wl.request('screen');
      } catch {
        // 사용자 제스처 부재/배터리 절약 등으로 거부될 수 있음 — 무시(생성은 계속됨)
      }
    };

    const release = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) {
        try { await s.release(); } catch { /* noop */ }
      }
    };

    // 화면 복귀 시 재획득(hidden되며 자동 해제됐을 수 있음)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    if (active) {
      void acquire();
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [active]);
}
