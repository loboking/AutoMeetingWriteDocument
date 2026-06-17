// 이용약관 (베타). 실제 서비스 출시 전 법률 검토 필요.
import Link from 'next/link';

export const metadata = { title: '이용약관 - MeetingAutoDocs' };

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 text-slate-800 dark:text-slate-200">
      <h1 className="text-2xl font-bold mb-2">이용약관</h1>
      <p className="text-sm text-slate-500 mb-8">
        본 서비스는 현재 <strong>베타 테스트</strong> 단계입니다. 안정성·가용성을 보장하지 않으며 예고 없이 변경·중단될 수 있습니다.
      </p>

      <section className="space-y-5 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-base mb-1">제1조 (목적)</h2>
          <p>본 약관은 MeetingAutoDocs(이하 &ldquo;서비스&rdquo;)가 제공하는 회의록 기반 문서 자동 생성 기능의 이용 조건을 정합니다.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">제2조 (서비스 내용)</h2>
          <p>서비스는 사용자가 입력·녹음한 회의 내용을 AI로 변환·요약하여 기획 문서를 생성합니다. 생성 결과의 정확성·완전성은 보장되지 않으며, 사용자는 결과물을 검토 후 사용해야 합니다.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">제3조 (이용자의 의무)</h2>
          <p>이용자는 타인의 권리를 침해하거나 법령에 위반되는 내용을 입력해서는 안 됩니다. 회의 참석자의 동의 없이 녹음한 내용의 업로드에 대한 책임은 이용자에게 있습니다.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">제4조 (제3자 처리 및 데이터 전송)</h2>
          <p>서비스는 기능 제공을 위해 입력 데이터를 외부 AI/저장 서비스로 전송합니다. 상세는 <Link href="/privacy" className="text-blue-600 dark:text-blue-400 underline">개인정보처리방침</Link>을 참고하세요.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">제5조 (면책)</h2>
          <p>베타 기간 중 데이터 손실·오류·서비스 중단으로 인한 손해에 대해 운영자는 책임을 지지 않습니다. 중요한 데이터는 별도 백업을 권장합니다.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">제6조 (문의)</h2>
          <p>문의: wisemanroot@gmail.com</p>
        </div>
      </section>

      <p className="mt-10 text-xs text-slate-400">시행일: 베타 운영 기간 · 본 약관은 정식 출시 전 변경될 수 있습니다.</p>
      <Link href="/" className="inline-block mt-4 text-sm text-blue-600 dark:text-blue-400 underline">← 돌아가기</Link>
    </main>
  );
}
