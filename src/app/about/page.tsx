import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  Mic, FileText, Sparkles, ArrowRight, Check, Clock, Layers,
  Download, ShieldCheck, Workflow, Zap,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'MeetingAutoDocs — 회의 한 번으로 기획 문서 14종 자동 생성',
  description:
    '회의 녹음을 올리면 AI가 회의록을 만들고, PRD·기능목록·화면설계·DB설계·API명세 등 14종 기획 문서를 자동으로 작성합니다. 기획자 없이 며칠 걸리던 산출물을 몇 분 만에.',
  openGraph: {
    title: 'MeetingAutoDocs — 회의 한 번으로 기획 문서 14종 자동 생성',
    description:
      '회의 녹음 → AI 회의록 → 기획 문서 14종 자동 생성. 며칠 걸리던 기획 산출물을 몇 분 만에.',
    images: ['/landing/01-main.png'],
  },
};

// 14종 문서 (documentUtils.ts DOCUMENTS와 동일)
const DOCS = [
  { icon: '📋', name: 'PRD', desc: '제품 요구사항 문서' },
  { icon: '👤', name: '시나리오 정의서', desc: '사용자 시나리오' },
  { icon: '📝', name: '기능목록', desc: '기능 목록 정의서' },
  { icon: '📱', name: '화면목록', desc: '화면 목록 정의서' },
  { icon: '🗂️', name: 'IA', desc: '정보구조도' },
  { icon: '🗄️', name: 'DB설계', desc: '스키마 및 ERD' },
  { icon: '🔌', name: 'API명세', desc: 'API 인터페이스 설계' },
  { icon: '🧪', name: '테스트계획', desc: '테스트 시나리오' },
  { icon: '🔄', name: '플로우차트', desc: '프로세스 흐름' },
  { icon: '🎬', name: '스토리보드', desc: '사용자 시나리오 흐름' },
  { icon: '🎨', name: '와이어프레임', desc: '화면 설계' },
  { icon: '📊', name: 'WBS', desc: '작업 분류 구조' },
  { icon: '✅', name: '테스트케이스', desc: '상세 테스트 케이스' },
  { icon: '🚀', name: '배포가이드', desc: '릴리스 및 배포 절차' },
];

const STEPS = [
  { icon: Mic, title: '녹음 또는 업로드', desc: '브라우저에서 회의를 녹음하거나, 녹음 파일을 업로드합니다.' },
  { icon: FileText, title: 'AI 회의록', desc: 'STT로 음성을 텍스트로 변환하고, AI가 핵심을 구조화해 요약합니다.' },
  { icon: Sparkles, title: '문서 14종 생성', desc: '요약을 바탕으로 PRD부터 배포가이드까지 기획 산출물을 자동 작성합니다.' },
  { icon: Download, title: '편집·내보내기', desc: 'Markdown·Word·Excel·PowerPoint로 내보내 바로 활용합니다.' },
];

const FEATURES = [
  { icon: Clock, title: '며칠 → 몇 분', desc: '외주 기획자가 며칠 걸려 만들던 산출물을 회의 한 번으로 즉시 확보합니다.' },
  { icon: Layers, title: '문서 14종 일괄', desc: 'PRD·화면·DB·API·WBS까지, 흩어진 기획 문서를 한 흐름으로 채웁니다.' },
  { icon: Workflow, title: '의존성 자동 연결', desc: '상위 문서를 고치면 하위 문서에 변경을 전파해 일관성을 유지합니다.' },
  { icon: Download, title: '4종 포맷 내보내기', desc: 'Word(DOCX)·Excel(XLSX)·PowerPoint(PPTX)·Markdown으로 바로 공유합니다.' },
  { icon: ShieldCheck, title: '내 계정에만 저장', desc: '문서는 사용자 계정 단위로 분리 저장되어 다른 사용자와 섞이지 않습니다.' },
  { icon: Zap, title: '시각화 내장', desc: 'Mermaid 플로우차트·ERD·화면 다이어그램을 문서 안에서 바로 렌더링합니다.' },
];

export default function AboutPage() {
  return (
    <main className="flex-1 bg-white text-slate-900">
      {/* 상단 네비 */}
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">MeetingAutoDocs</span>
          <nav className="flex items-center gap-6 text-sm text-slate-600">
            <a href="#features" className="hidden hover:text-slate-900 sm:inline">기능</a>
            <a href="#docs" className="hidden hover:text-slate-900 sm:inline">문서 14종</a>
            <a href="#how" className="hidden hover:text-slate-900 sm:inline">작동 방식</a>
            <Link
              href="/"
              className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-700"
            >
              앱 시작하기
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-20 text-center sm:pt-28">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-600">
            <Sparkles className="h-3.5 w-3.5" />
            회의 → AI 회의록 → 기획 문서 자동 생성
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            회의 한 번으로,<br />
            기획 문서 <span className="text-blue-600">14종</span>이 완성됩니다
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            녹음을 올리면 AI가 회의록을 만들고 PRD·화면설계·DB설계·API명세까지 작성합니다.
            기획자가 며칠 걸려 만들던 산출물을 몇 분 만에 확보하세요.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
              무료로 시작하기 <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-7 py-3.5 font-semibold text-slate-700 transition hover:border-slate-300"
            >
              작동 방식 보기
            </a>
          </div>

          {/* Hero 스크린샷 */}
          <div className="relative mx-auto mt-16 max-w-5xl">
            <div className="absolute inset-x-8 -bottom-4 -top-4 -z-10 rounded-3xl bg-gradient-to-b from-blue-100/40 to-transparent blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-2xl shadow-slate-300/30">
              <Image
                src="/landing/01-main.png"
                alt="MeetingAutoDocs 메인 화면 — 녹음/업로드로 회의를 시작하고 단계별로 진행"
                width={1440}
                height={900}
                priority
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 신뢰 지표 */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-10 sm:grid-cols-4">
          {[
            { k: '14종', v: '자동 생성 문서' },
            { k: '4종', v: '내보내기 포맷' },
            { k: '몇 분', v: '문서화 소요 시간' },
            { k: '0명', v: '필요한 기획 인력' },
          ].map((s) => (
            <div key={s.v} className="text-center">
              <div className="text-3xl font-bold text-slate-900">{s.k}</div>
              <div className="mt-1 text-sm text-slate-500">{s.v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 작동 방식 */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">4단계, 그게 전부입니다</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-600">
            회의를 올리는 순간부터 내보내기까지, 사람이 손댈 일은 검토와 편집뿐입니다.
          </p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="relative rounded-2xl border border-slate-200 bg-white p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
                <step.icon className="h-5 w-5" />
              </div>
              <div className="text-xs font-semibold text-slate-400">STEP {i + 1}</div>
              <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 제품 시연 — 요약 & 문서 */}
      <section className="mx-auto max-w-6xl space-y-24 px-6 py-24">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="text-sm font-semibold text-blue-600">STEP 2 · AI 회의록</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              회의 내용을 구조화된 요약으로
            </h2>
            <p className="mt-4 text-slate-600">
              녹취록을 그대로 두지 않습니다. 회의 개요·핵심 논의·결정 사항·할 일(담당자/기한)까지
              실무에 바로 쓰는 형태로 정리합니다.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50">
            <Image
              src="/landing/03-summary.png"
              alt="AI가 생성한 회의 요약 — 개요와 핵심 논의 사항"
              width={1440}
              height={900}
              className="w-full"
            />
          </div>
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50 lg:order-1">
            <Image
              src="/landing/04-documents.png"
              alt="문서 14종 생성 현황 — PRD 등 문서가 순서대로 완성됨"
              width={1440}
              height={900}
              className="w-full"
            />
          </div>
          <div className="lg:order-2">
            <span className="text-sm font-semibold text-blue-600">STEP 3 · 문서 14종</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              버튼 하나로 14종이 채워집니다
            </h2>
            <p className="mt-4 text-slate-600">
              PRD부터 화면설계·DB설계·API명세까지. 문서 간 의존성을 따라 순서대로 생성되고,
              생성 현황을 한눈에 추적할 수 있습니다.
            </p>
          </div>
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="text-sm font-semibold text-blue-600">바로 쓰는 결과물</span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">
              완성된 문서, 그대로 편집·내보내기
            </h2>
            <p className="mt-4 text-slate-600">
              생성된 문서는 Markdown으로 편집하거나 Word·Excel·PowerPoint로 내보내
              팀과 즉시 공유할 수 있습니다.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-xl shadow-slate-200/50">
            <Image
              src="/landing/05-doc-content.png"
              alt="생성된 PRD 문서 본문"
              width={1440}
              height={900}
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* 기능 */}
      <section id="features" className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">기획 실무를 그대로 자동화</h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-600">
              단순 요약을 넘어, 실제 개발에 쓰는 산출물을 의존성까지 맞춰 생성합니다.
            </p>
          </div>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 14종 문서 */}
      <section id="docs" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">한 번의 회의, 14종의 문서</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-600">
            기획부터 설계·테스트·배포까지. 문서 간 의존성을 따라 순서대로 채워집니다.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {DOCS.map((d) => (
            <div
              key={d.name}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm"
            >
              <span className="text-2xl leading-none">{d.icon}</span>
              <div>
                <div className="font-semibold text-slate-900">{d.name}</div>
                <div className="text-xs text-slate-500">{d.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 모바일 시연 */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">언제 어디서나, 브라우저 하나로</h2>
            <p className="mt-4 text-slate-600">
              설치 없이 웹에서 바로. 데스크톱에서 회의를 녹음하고, 이동 중에는 모바일로 문서를 확인하세요.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                '브라우저 마이크로 실시간 녹음',
                '녹음 파일 업로드 지원',
                '문서는 내 계정에만 안전하게 저장',
                'Word·Excel·PowerPoint로 즉시 내보내기',
              ].map((t) => (
                <li key={t} className="flex items-center gap-3 text-slate-700">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center">
            <div className="overflow-hidden rounded-3xl border border-slate-200 shadow-xl shadow-slate-300/40">
              <Image
                src="/landing/02-mobile.png"
                alt="MeetingAutoDocs 모바일 화면"
                width={390}
                height={844}
                className="w-[260px]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="rounded-3xl bg-slate-900 px-8 py-16 text-center text-white">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            다음 회의부터, 문서는 자동으로
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-300">
            지금 가입하고 회의 녹음 하나로 기획 문서 14종을 받아보세요.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            무료로 시작하기 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* 푸터 */}
      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row">
          <span className="font-semibold text-slate-700">MeetingAutoDocs</span>
          <nav className="flex gap-6">
            <Link href="/terms" className="hover:text-slate-700">이용약관</Link>
            <Link href="/privacy" className="hover:text-slate-700">개인정보처리방침</Link>
            <Link href="/" className="hover:text-slate-700">앱 시작하기</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
