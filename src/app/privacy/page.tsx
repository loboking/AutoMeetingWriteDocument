// 개인정보처리방침 (베타). 회의 녹취록=민감 업무정보. 국외이전 고지 포함. 법률 검토 필요.
import Link from 'next/link';

export const metadata = { title: '개인정보처리방침 - MeetingAutoDocs' };

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 text-slate-800 dark:text-slate-200">
      <h1 className="text-2xl font-bold mb-2">개인정보처리방침</h1>
      <p className="text-sm text-slate-500 mb-8">
        MeetingAutoDocs(이하 &ldquo;서비스&rdquo;)는 이용자의 개인정보를 중요하게 여기며, 아래와 같이 처리합니다. 본 서비스는 <strong>베타 단계</strong>입니다.
      </p>

      <section className="space-y-5 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-base mb-1">1. 수집하는 항목</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>계정: 이메일 주소, 비밀번호(암호화 저장)</li>
            <li>이용 데이터: 업로드/녹음한 <strong>오디오</strong>, 변환된 <strong>회의 녹취록</strong>, 생성된 기획 문서</li>
          </ul>
          <p className="mt-2 text-amber-700 dark:text-amber-400">
            ⚠️ 회의 녹취록에는 업무상 기밀·제3자 개인정보가 포함될 수 있습니다. 민감한 정보의 입력에 유의하세요.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-base mb-1">2. 이용 목적</h2>
          <p>회의 내용의 텍스트 변환, 요약, 기획 문서 자동 생성 및 사용자별 저장·조회.</p>
        </div>

        <div>
          <h2 className="font-semibold text-base mb-1">3. 제3자 처리 및 국외 이전</h2>
          <p>기능 제공을 위해 입력 데이터가 아래 외부 서비스로 전송·처리됩니다.</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>z.ai / GLM (open.bigmodel.cn, 중국)</strong>: 문서 생성·요약을 위해 녹취록·요약 텍스트 전송. <strong>국외(중국) 이전</strong>에 해당합니다.</li>
            <li><strong>OpenAI Whisper (미국)</strong>: 서버 STT 키가 설정된 경우에 한해 오디오 전송. (기본은 브라우저 내 무료 변환으로 외부 전송 없음.)</li>
            <li><strong>Supabase</strong>: 계정(이메일)과 회의·문서 데이터 저장, 공유 문서 저장.</li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-base mb-1">4. 보유 및 파기</h2>
          <p>데이터는 이용자가 삭제하거나 회원 탈퇴를 요청할 때까지 보관됩니다. 삭제·탈퇴는 아래 연락처로 요청하시면 처리합니다(베타 기간 수동 처리).</p>
        </div>

        <div>
          <h2 className="font-semibold text-base mb-1">5. 이용자의 권리</h2>
          <p>이용자는 본인 데이터의 열람·정정·삭제·처리정지를 요청할 수 있습니다.</p>
        </div>

        <div>
          <h2 className="font-semibold text-base mb-1">6. 문의 및 삭제 요청</h2>
          <p>wisemanroot@gmail.com</p>
        </div>
      </section>

      <p className="mt-10 text-xs text-slate-400">
        본 방침은 베타 운영용 최소 고지이며 정식 출시 전 법률 검토 후 보완됩니다.
      </p>
      <Link href="/" className="inline-block mt-4 text-sm text-blue-600 dark:text-blue-400 underline">← 돌아가기</Link>
    </main>
  );
}
