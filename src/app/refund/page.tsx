// 환불정책 (초안). Paddle 심사 필수 페이지. 시행 전 운영자 확인·법률 검토 필요.
import Link from 'next/link';
import { PageContainer } from '@/components/layout/PageContainer';

export const metadata = { title: '환불정책 - MeetingAutoDocs' };

export default function RefundPage() {
  return (
    <PageContainer width="narrow" className="py-10 text-foreground">
      <h1 className="text-2xl font-bold mb-2">환불정책</h1>
      <p className="text-sm text-muted-foreground mb-8">
        MeetingAutoDocs(이하 &ldquo;서비스&rdquo;)의 유료 상품 결제·해지·환불 기준입니다.
      </p>

      <section className="space-y-5 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-base mb-1">1. 결제 처리</h2>
          <p>모든 결제는 Merchant of Record인 Paddle을 통해 처리됩니다. 결제 영수증과 청구 내역은 Paddle에서 이메일로 발송되며, 결제 수단·세금·영수증 관련 문의는 Paddle 영수증의 안내를 따라주세요.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">2. 월 구독 (Pro, Team)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>구독은 매월 자동 갱신되며, 언제든 해지할 수 있습니다. 해지하면 다음 결제일부터 청구되지 않고, 이미 결제한 기간 말일까지 이용할 수 있습니다.</li>
            <li>최초 결제일로부터 <strong>7일 이내</strong>이고 해당 결제 기간에 프로젝트를 한 건도 생성하지 않았다면 전액 환불합니다.</li>
            <li>프로젝트를 생성한 이후, 또는 갱신 결제분은 이미 이용한 기간에 대해 환불되지 않습니다.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">3. 단건 상품 (Project Pass, Extra Project)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>결제일로부터 <strong>7일 이내</strong>이고 문서 생성을 시작하기 전이라면 전액 환불합니다.</li>
            <li>문서 생성을 시작한 뒤에는 디지털 콘텐츠 제공이 개시된 것으로 보며 환불되지 않습니다. 이 점은 결제 전에 안내합니다.</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">4. 서비스 오류</h2>
          <p>서비스 장애로 문서 생성이 완료되지 않은 경우, 소진된 한도를 복구하거나 해당 건을 환불합니다. 중복 결제도 확인되는 대로 환불합니다.</p>
        </div>
        <div>
          <h2 className="font-semibold text-base mb-1">5. 환불 요청 방법</h2>
          <p>wisemanroot@gmail.com 으로 가입 이메일과 결제 내역(영수증)을 보내주세요. 확인 후 영업일 기준 5일 이내에 처리하며, 환불은 원래 결제 수단으로 진행됩니다. 카드사에 따라 반영까지 추가 시간이 걸릴 수 있습니다.</p>
        </div>
      </section>

      <p className="mt-10 text-xs text-muted-foreground">
        관련 문서: <Link href="/terms" className="text-primary underline">이용약관</Link> · <Link href="/privacy" className="text-primary underline">개인정보처리방침</Link>
      </p>
      <Link href="/" className="inline-block mt-4 text-sm text-primary underline">← 돌아가기</Link>
    </PageContainer>
  );
}
