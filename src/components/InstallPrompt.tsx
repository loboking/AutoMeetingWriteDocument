'use client';

import { useState, useEffect } from 'react';
import { Download, X, Share } from 'lucide-react';

// PWA 설치 안내 배너.
// - Android/데스크톱 Chrome: beforeinstallprompt 잡아 "설치" 버튼 제공
// - iOS Safari: 자동 프롬프트 불가 → "공유 → 홈 화면에 추가" 안내만 노출
// - 이미 설치(standalone)됐거나 사용자가 닫으면 표시 안 함
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

// 이 브라우저에서 설치 안내를 띄울지 + iOS 여부를 동기 계산(렌더 중 1회).
// effect 안에서 setState를 동기 호출하면 cascading render가 되므로, 초기 상태를 lazy로 계산한다.
// 이미 설치(standalone)됐는지
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  // beforeinstallprompt 수신(비iOS) 또는 iOS 감지 시 true. dismiss/설치 시 false.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === '1') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // 기본 미니 배너 막고 우리 UI로
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // iOS는 beforeinstallprompt가 없으므로 다음 프레임에 직접 안내 노출
    // (effect 동기 setState 연쇄렌더 회피 — rAF로 분리)
    let raf = 0;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      raf = requestAnimationFrame(() => {
        setIos(true);
        setShow(true);
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  if (!show) return null;
  const isIOS = ios;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        aria-label="설치 안내 닫기"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">앱으로 설치하기</p>

          {isIOS ? (
            <p className="mt-1 flex items-center gap-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              공유 버튼 <Share className="inline h-3.5 w-3.5" /> 을 누르고
              <span className="font-medium text-slate-700 dark:text-slate-300">&ldquo;홈 화면에 추가&rdquo;</span>
              를 선택하세요.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                홈 화면에 설치하면 앱처럼 빠르게 열 수 있어요.
              </p>
              <button
                onClick={handleInstall}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                <Download className="h-3.5 w-3.5" /> 설치
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
