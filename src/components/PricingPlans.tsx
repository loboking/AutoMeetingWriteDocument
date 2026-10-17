'use client';

import { useEffect, useState } from 'react';
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

// Paddle.js를 필요할 때 한 번만 로드(결제 버튼 클릭 시).
/* eslint-disable @typescript-eslint/no-explicit-any */
// Paddle.Initialize는 페이지당 1회만 허용(두 번 호출하면 throw). 콜백은 컴포넌트가 바꿔 끼운다.
let paddleReady = false;
let onPaddleEvent: (name: string) => void = () => {};

function loadPaddle(): Promise<any> {
  const w = window as any;
  if (w.Paddle) return Promise.resolve(w.Paddle);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = () => resolve(w.Paddle);
    s.onerror = () => reject(new Error('결제 모듈을 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
}

export default function PricingPlans() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 결제창 완료 후 웹훅 반영을 기다리는 중(이중 결제 방지 안내).
  const [confirming, setConfirming] = useState<'waiting' | 'slow' | null>(null);

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

  // 결제 완료 후 유료 플랜으로 바뀔 때까지 3초마다 확인(최대 60초). 웹훅이 늦어도 사용자가 다시 결제하지 않게 안내.
  useEffect(() => {
    if (!confirming) return;
    if (status && status.plan !== 'free') {
      setConfirming(null);
      return;
    }
    const poll = setInterval(loadStatus, 3000);
    const slow = setTimeout(() => setConfirming('slow'), 60000);
    return () => {
      clearInterval(poll);
      clearTimeout(slow);
    };
  }, [confirming, status]);

  const subscribe = async (plan: PlanId) => {
    setError(null);
    setBusy(plan);
    try {
      // 서버가 Price ID·userId를 결정해 내려준다(클라 신뢰 금지).
      const res = await authedFetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const cfg = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(cfg.error || '결제를 시작하지 못했습니다.');
        return;
      }
      const Paddle = await loadPaddle();
      onPaddleEvent = (name) => {
        // 권한 지급은 웹훅이 처리 — 완료 후 상태가 바뀔 때까지 폴링한다.
        if (name === 'checkout.completed') setConfirming('waiting');
      };
      if (!paddleReady) {
        if (cfg.env === 'sandbox') Paddle.Environment.set('sandbox');
        Paddle.Initialize({ token: cfg.token, eventCallback: (ev: { name: string }) => onPaddleEvent(ev.name) });
        paddleReady = true;
      }
      Paddle.Checkout.open({
        items: [{ priceId: cfg.priceId, quantity: 1 }],
        customData: cfg.customData,
        ...(cfg.email ? { customer: { email: cfg.email } } : {}),
      });
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
      {confirming && (
        <p className="mb-4 rounded-md bg-blue-50 px-4 py-2 text-sm text-blue-700">
          {confirming === 'waiting'
            ? '결제를 확인하고 있습니다. 잠시만 기다려 주세요. 다시 결제하지 마세요.'
            : '결제는 접수되었지만 반영이 늦어지고 있습니다. 다시 결제하지 마시고, 몇 분 뒤에도 그대로면 wisemanroot@gmail.com 으로 문의해 주세요.'}
        </p>
      )}
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
                    <Check className="h-4 w-4 text-primary" /> 월 프로젝트 {plan.monthlyMeetings}건
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
                {isPaid && !isCurrent && currentPlan === 'free' && (
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
