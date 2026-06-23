import type { MetadataRoute } from 'next';

// PWA 웹앱 매니페스트 (Next 16 내장). 홈 화면 설치/standalone 표시용.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MeetingAutoDocs — 회의 녹음 자동 기획서',
    short_name: 'MeetingDocs',
    description: '회의 녹음을 텍스트로 변환하고 AI가 요약과 기획 문서 14종을 자동 생성합니다.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#1a1a1a',
    lang: 'ko',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
