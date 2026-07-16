// 수동 Service Worker — 앱 셸 precache + 런트임 캐시만 (YAGNI).
// next-pwa는 next.config.ts의 withSentryConfig 중첩 래핑 + Next 16 Turbopack 충돌 위험으로 거절.
// 풀 오프라인 동기화/백그라운드 싱크/푸시 = cutScope.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `mw-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `mw-runtime-${CACHE_VERSION}`;

// 앱 셸 precache — start_url + root + manifest.
const PRECACHE_URLS = ['/', '/manifest.webmanifest'];

// 정적 자산 빌드 해시 패턴 — Next.js _next/static/* (이미지/폰트/JS/CSS 번들).
const STATIC_ASSET_RE = /\/_next\/static\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // 개별 URL 실패(오프라인/일시 오류)가 설치를 막지 않도록 ignore.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* ignore — precache는 best-effort */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 구 버전 캐시 정리(STATIC_CACHE 이름이 바뀌면 이전 버전 제거).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // GET이 아니면 통과(변이 요청/인증 헤더 등 캐시 금지).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 동일 오리진만 취급 — 외부 CDN/Supabase/인증 도메인은 SW가 건드리지 않는다.
  if (url.origin !== self.location.origin) return;

  // API는 캐시 절대 금지(NetworkOnly) — 기존 에러 처리 유지.
  if (url.pathname.startsWith('/api/')) return;

  // 정적 자산 — CacheFirst(stale-while-revalidate). 해시 기반이라 영구 캐시 안전.
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML 내비게이션 — NetworkFirst, 실패 시 precache '/' 폴백(오프라인 셸).
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 그 외 동일 오리진 GET(폰트/이미지 등) — 런타임 캐시 SWR.
  event.respondWith(runtimeSWR(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch {
    // 폭백할 자원이 없으면 그대로 throw → 브라우저 기본 에러.
    throw new Error('offline static asset');
  }
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // 최후의 보루 — 앱 셸 루트.
    const shell = await cache.match('/');
    if (shell) return shell;
    throw new Error('offline and no shell cached');
  }
}

async function runtimeSWR(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
