'use client';

// 수동 Service Worker 등록. 앱 셸 precache + 정적 자산 캐시.
// 개발 모드에서는 no-op — Turbopack dev HMR과 SW 캐시 충돌 회피.
// 프로덕션 빌드에서만 /sw.js 등록.
import { useEffect } from 'react';

export default function RegisterSW(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return; // dev: no-op
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {
          // 등록 실패는 앱 동작에 영향 없음 — 콘솔 로그만 남기지 않음(조용히 no-op).
        });
    };

    // 첫 paint 이후로 미뤄 등록 — 페이지 로딩 차단 방지.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
