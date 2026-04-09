import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // 내부망 접속 허용
  allowedDevOrigins: ['192.168.0.103', '192.168.0.*'],
};

export default nextConfig;
