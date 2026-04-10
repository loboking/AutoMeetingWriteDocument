import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // 내부망 접속 허용
  allowedDevOrigins: ['192.168.0.103', '192.168.0.*'],
  // GitHub Pages 설정
  output: 'export',
  basePath: process.env.NODE_ENV === 'production' ? '/AutoMeetingWriteDocument' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/AutoMeetingWriteDocument' : '',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
