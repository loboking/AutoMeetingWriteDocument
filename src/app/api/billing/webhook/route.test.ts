import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  applyPaddleSubscription: vi.fn(),
  getUserIdByCustomer: vi.fn(),
  getSubscription: vi.fn(),
  logWebhookEvent: vi.fn(),
  revokeByTransaction: vi.fn(),
  recordPayment: vi.fn(),
}));
vi.mock('@/lib/subscriptionStore', () => store);

import { POST } from './route';
import { signUserId } from '@/lib/paddle';

const SECRET = 'whsec_test';
const USER = '11111111-1111-1111-1111-111111111111';
const SIGNED = { userId: USER, sig: signUserId(USER, SECRET) };

function call(event: object, opts: { badSig?: boolean } = {}) {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', opts.badSig ? 'wrong' : SECRET).update(`${ts}:${body}`).digest('hex');
  return POST(
    new Request('http://x/api/billing/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': `ts=${ts};h1=${h1}` },
      body,
    }) as never
  );
}

const periodEvent = (type: string, extra: object = {}) => ({
  event_type: type,
  data: {
    id: 'sub_1',
    status: 'active',
    customer_id: 'ctm_1',
    items: [{ price: { id: 'pri_pro' } }],
    custom_data: SIGNED,
    current_billing_period: { starts_at: '2026-10-08T00:00:00Z', ends_at: '2026-11-08T00:00:00Z' },
    scheduled_change: null,
    ...extra,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PADDLE_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('PADDLE_PRICE_PRO', 'pri_pro');
  vi.stubEnv('PADDLE_PRICE_TEAM', 'pri_team');
  vi.stubEnv('PADDLE_PRICE_PASS', 'pri_pass');
  store.getSubscription.mockResolvedValue(null);
  store.getUserIdByCustomer.mockResolvedValue(null);
});

describe('Paddle webhook', () => {
  it('잘못된 서명은 400, 아무것도 안 씀', async () => {
    const res = await call(periodEvent('subscription.created'), { badSig: true });
    expect(res.status).toBe(400);
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
  });

  it('다른 서비스(사주살롱) Price ID는 무시', async () => {
    const ev = periodEvent('subscription.created', { items: [{ price: { id: 'pri_saju' } }] });
    const res = await call(ev);
    expect(res.status).toBe(200);
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
    expect(store.recordPayment).not.toHaveBeenCalled();
  });

  it('subscription.created → pro 활성화', async () => {
    await call(periodEvent('subscription.created'));
    expect(store.applyPaddleSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, plan: 'pro', status: 'active', subscriptionId: 'sub_1', cancelAtPeriodEnd: false })
    );
  });

  it('해지 예약(scheduled_change=cancel)이면 cancelAtPeriodEnd=true', async () => {
    await call(periodEvent('subscription.updated', { scheduled_change: { action: 'cancel' } }));
    expect(store.applyPaddleSubscription).toHaveBeenCalledWith(expect.objectContaining({ cancelAtPeriodEnd: true }));
  });

  it('subscription.canceled → status canceled 전달', async () => {
    await call(periodEvent('subscription.canceled', { status: 'canceled' }));
    expect(store.applyPaddleSubscription).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }));
  });

  it('transaction.completed(구독) → 결제 기록 + 기간 갱신', async () => {
    await call({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_1',
        subscription_id: 'sub_1',
        customer_id: 'ctm_1',
        currency_code: 'KRW',
        items: [{ price: { id: 'pri_pro' } }],
        custom_data: SIGNED,
        details: { totals: { total: '9900' } },
        billing_period: { starts_at: '2026-10-08T00:00:00Z', ends_at: '2026-11-08T00:00:00Z' },
      },
    });
    expect(store.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'txn_1', plan: 'pro', amount: 9900, status: 'paid' })
    );
    expect(store.applyPaddleSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ periodEnd: '2026-11-08T00:00:00Z', status: 'active' })
    );
  });

  it('단건(pass)은 결제 기록만, 구독 변경 없음', async () => {
    await call({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_2',
        items: [{ price: { id: 'pri_pass' } }],
        custom_data: SIGNED,
        details: { totals: { total: '4900' } },
      },
    });
    expect(store.recordPayment).toHaveBeenCalledTimes(1);
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
  });

  it('전액 환불 승인 → 권한 회수 호출', async () => {
    await call({ event_type: 'adjustment.updated', data: { transaction_id: 'txn_1', action: 'refund', type: 'full', status: 'approved' } });
    expect(store.revokeByTransaction).toHaveBeenCalledWith('txn_1');
  });

  it('부분환불·승인대기·거절은 회수하지 않음', async () => {
    for (const d of [
      { type: 'partial', status: 'approved', action: 'refund' },
      { type: 'full', status: 'pending_approval', action: 'refund' },
      { type: 'full', status: 'rejected', action: 'refund' },
    ]) await call({ event_type: 'adjustment.created', data: { transaction_id: 'txn_1', ...d } });
    expect(store.revokeByTransaction).not.toHaveBeenCalled();
  });

  it('custom_data.userId 없고 customer도 모르면 아무것도 안 쓰고 200', async () => {
    store.getUserIdByCustomer.mockResolvedValue(null);
    const res = await call(periodEvent('subscription.created', { custom_data: {} }));
    expect(res.status).toBe(200);
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
  });

  it('userId 없어도 알려진 customer면 복구해서 반영', async () => {
    store.getUserIdByCustomer.mockResolvedValue(USER);
    await call(periodEvent('subscription.updated', { custom_data: {} }));
    expect(store.applyPaddleSubscription).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }));
  });

  it('UUID 형식이 아닌 userId(조작)는 거부', async () => {
    await call(periodEvent('subscription.created', { custom_data: { userId: "x' or 1=1", sig: 'x' } }));
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
  });

  it('서명 없는/틀린 userId로 타인 구독 덮어쓰기 시도는 거부', async () => {
    await call(periodEvent('subscription.created', { custom_data: { userId: USER } }));
    await call(periodEvent('subscription.created', { custom_data: { userId: USER, sig: signUserId('someone-else', SECRET) } }));
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
  });

  it('이미 다른 구독으로 이용 중이면 새(중복) 구독을 즉시 해지하고 반영하지 않음', async () => {
    store.getSubscription.mockResolvedValue({ plan: 'pro', status: 'active', paddle_subscription_id: 'sub_existing' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PADDLE_API_KEY', 'k');
    const res = await call(periodEvent('subscription.created', { id: 'sub_dup' }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/subscriptions/sub_dup/cancel'), expect.objectContaining({ body: expect.stringContaining('immediately') }));
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('중복 구독 결제도 이력은 남김(환불 근거)', async () => {
    store.getSubscription.mockResolvedValue({ plan: 'pro', status: 'active', paddle_subscription_id: 'sub_existing' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv('PADDLE_API_KEY', 'k');
    await call({
      event_type: 'transaction.completed',
      data: {
        id: 'txn_dup', subscription_id: 'sub_dup', items: [{ price: { id: 'pri_pro' } }], custom_data: SIGNED,
        details: { totals: { total: '9900' } }, billing_period: { starts_at: 'a', ends_at: 'b' },
      },
    });
    expect(store.recordPayment).toHaveBeenCalledTimes(1);
    expect(store.applyPaddleSubscription).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('같은 구독의 갱신 결제는 중복이 아님', async () => {
    store.getSubscription.mockResolvedValue({ plan: 'pro', status: 'active', paddle_subscription_id: 'sub_1' });
    await call(periodEvent('subscription.updated'));
    expect(store.applyPaddleSubscription).toHaveBeenCalledTimes(1);
  });

  it('DB 오류 → 500(Paddle 재시도 유도)', async () => {
    store.applyPaddleSubscription.mockRejectedValue(new Error('db down'));
    const res = await call(periodEvent('subscription.created'));
    expect(res.status).toBe(500);
  });

  it('FK 위반(없는 유저)은 재시도 무의미 → 200 폐기', async () => {
    store.applyPaddleSubscription.mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));
    const res = await call(periodEvent('subscription.created'));
    expect(res.status).toBe(200);
  });
});
