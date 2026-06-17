import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // 내부망 접속 허용 (개발용)
  allowedDevOrigins: ['192.168.0.103', '192.168.0.*'],
  // Vercel/Render 등 서버리스 환경: SSR/API Routes 사용 가능
  // GitHub Pages: output: 'export' + basePath 설정 필요
  output: undefined,
  basePath: '',
  assetPrefix: '',
  images: {
    unoptimized: true,
  },
};

// Sentry: 소스맵 업로드/트레이싱/Replay 없이 에러 캡처만 (베타 최소).
// DSN 미설정 시 런타임 init이 no-op이라 앱은 정상 동작.
export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  // 소스맵 업로드는 SENTRY_AUTH_TOKEN 필요 — 베타엔 생략
  sourcemaps: { disable: true },
});
