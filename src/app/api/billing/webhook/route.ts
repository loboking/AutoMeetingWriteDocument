// PortOne 웹훅 수신. requireUser 없음 — PortOne이 호출하며, 서명검증(verifyWebhook)이 인증 역할.
// 멱등: payment_id unique로 중복 흡수. 서명검증 실패 시 400.
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '@/lib/portone';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  // verify는 표준 웹훅 헤더(webhook-id/timestamp/signature)를 본다.
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let payload;
  try {
    payload = await verifyWebhook(rawBody, headers);
  } catch (error) {
    console.error('[billing/webhook] 검증 실패:', error);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // 검증된 이벤트 로깅. 주 상태전이는 issue 라우트/cron이 동기로 처리하므로
  // 웹훅은 보조 관측·재확인용(베타). 향후 비동기 결제수단(가상계좌 등) 추가 시 여기서 처리.
  console.log('[billing/webhook] 수신:', payload.type);

  return NextResponse.json({ ok: true });
}
