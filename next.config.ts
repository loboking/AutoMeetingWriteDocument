import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 내부망 접속 허용 (개발용)
  allowedDevOrigins: ['192.168.0.103', '192.168.0.*'],
  // Vercel 배포: SSR/API Routes 사용 가능
  // GitHub Pages: output: 'export' + basePath 설정 필요
  output: process.env.VERCEL ? undefined : 'export',
  basePath: process.env.VERCEL ? '' : (process.env.NODE_ENV === 'production' ? '/AutoMeetingWriteDocument' : ''),
  assetPrefix: process.env.VERCEL ? '' : (process.env.NODE_ENV === 'production' ? '/AutoMeetingWriteDocument' : ''),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
