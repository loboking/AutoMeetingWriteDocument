'use client';

import { useEffect, useState } from 'react';
import PortOne from '@portone/browser-sdk/v2';
import { PLANS, PAID_PLAN_IDS, type PlanId } from '@/lib/plans';
import { authedFetch } from '@/lib/authFetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Check } from 'lucide-react';

interface Status {
  plan: PlanId;
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

const STORE_ID = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
const CHANNEL_KEY = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

export default function PricingPlans() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const res = await authedFetch('/api/billing/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      // 비로그인 등 — free로 둠
    }
  };
  useEffect(() => {
    loadStatus();
  }, []);

  const subscribe = async (plan: PlanId) => {
    setError(null);
    if (!STORE_ID || !CHANNEL_KEY) {
      setError('결제가 아직 설정되지 않았습니다.');
      return;
    }
    setBusy(plan);
    try {
      // 1) 빌링키 발급(카드 등록) — 카드정보는 PortOne 결제창에서만 입력(서버 미경유).
      const issue = await PortOne.requestIssueBillingKey({
        storeId: STORE_ID,
        channelKey: CHANNEL_KEY,
        billingKeyMethod: 'CARD',
      });
      if (!issue || issue.code !== undefined) {
        setError(issue?.message || '카드 등록이 취소되었습니다.');
        return;
      }
      // 2) 서버에 빌링키 전달 → 첫 결제 + 구독 활성화(금액은 서버가 결정).
      const res = await authedFetch('/api/billing/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingKey: issue.billingKey, plan }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error || '결제에 실패했습니다.');
        return;
      }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setError(null);
    if (!confirm('구독을 취소할까요? 이번 결제 기간 끝까지는 계속 이용할 수 있습니다.')) return;
    const res = await authedFetch('/api/billing/cancel', { method: 'POST' });
    if (res.ok) await loadStatus();
    else setError('취소에 실패했습니다.');
  };

  const currentPlan = status?.plan ?? 'free';

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {(Object.values(PLANS)).map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const isPaid = PAID_PLAN_IDS.includes(plan.id);
          return (
            <Card key={plan.id} className={isCurrent ? 'border-primary ring-1 ring-primary' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {isCurrent && (
                    <span className="text-xs font-normal text-primary">현재 플랜</span>
                  )}
                </CardTitle>
                <CardDescription>
                  {plan.priceKRW === 0 ? '무료' : `월 ${plan.priceKRW.toLocaleString()}원`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> 월 회의 {plan.monthlyMeetings}건
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> 문서 14종 전부
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> Word/Excel/PPT 내보내기
                  </li>
                  {plan.seats > 1 && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" /> 좌석 {plan.seats}석·팀 공유
                    </li>
                  )}
                </ul>
                {isPaid && !isCurrent && (
                  <Button className="w-full" disabled={busy !== null} onClick={() => subscribe(plan.id)}>
                    {busy === plan.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '구독하기'}
                  </Button>
                )}
                {isCurrent && isPaid && (
                  <div className="space-y-1">
                    {status?.cancelAtPeriodEnd ? (
                      <p className="text-xs text-muted-foreground">
                        {status.currentPeriodEnd
                          ? `${new Date(status.currentPeriodEnd).toLocaleDateString('ko-KR')}에 종료 예정`
                          : '취소 예약됨'}
                      </p>
                    ) : (
                      <Button variant="outline" className="w-full" onClick={cancel}>
                        구독 취소
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
