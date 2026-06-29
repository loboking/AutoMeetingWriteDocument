import type { Metadata } from 'next';
import { PageContainer } from '@/components/layout/PageContainer';
import PricingPlans from '@/components/PricingPlans';

export const metadata: Metadata = {
  title: '요금제 — MeetingAutoDocs',
  description: '회의 건수에 맞춰 고르는 요금제. 무료로 시작해 필요할 때 업그레이드하세요.',
};

export default function PricingPage() {
  return (
    <PageContainer className="py-10">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold">요금제</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          무료로 시작하고, 회의가 늘면 업그레이드하세요. 언제든 취소할 수 있습니다.
        </p>
      </div>
      <PricingPlans />
    </PageContainer>
  );
}
