import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GenerationGuard from "@/components/GenerationGuard";
import AuthGate from "@/components/AuthGate";

// 나눔고딕 폰트
const nanumGothic = {
  variable: "--font-nanum-gothic",
};

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthGate>{children}</AuthGate>
        <GenerationGuard />
      </body>
    </html>
  );
}
