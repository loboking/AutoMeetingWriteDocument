import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GenerationGuard from "@/components/GenerationGuard";
import AuthGate from "@/components/AuthGate";
import InstallPrompt from "@/components/InstallPrompt";
import RegisterSW from "@/components/RegisterSW";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MeetingAutoDocs - 회의 녹음 및 자동 기획서 생성",
  description: "회의 녹음을 텍스트로 변환하고 AI가 요약과 기획서를 자동 생성합니다.",
  // PWA: 홈 화면 설치 시 앱처럼 보이도록 (iOS는 manifest를 일부만 따르므로 명시 필요)
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MeetingDocs",
  },
  applicationName: "MeetingAutoDocs",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1a1a1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthGate>{children}</AuthGate>
        <GenerationGuard />
        <InstallPrompt />
        <RegisterSW />
      </body>
    </html>
  );
}
