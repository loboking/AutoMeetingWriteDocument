import { beforeEach, describe, expect, it, vi } from 'vitest';

// supabase 체인 페이크: 모든 체인 메서드는 자기 자신, 끝(maybeSingle/await)에서 res를 돌려준다.
function chain(res: unknown) {
  const o: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'upsert']) o[m] = vi.fn(() => o);
  o.maybeSingle = vi.fn(async () => res);
  o.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r);
  return o as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}
const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: db }));

import { applyPaddleSubscription, getUserPlan, revokeByTransaction } from './subscriptionStore';

const base = {
  userId: 'u1', plan: 'pro' as const, status: 'active' as const, subscriptionId: 'sub_new',
  customerId: 'ctm_1', periodStart: '2026-10-08T00:00:00Z', periodEnd: '2026-11-08T00:00:00Z',
  cancelAtPeriodEnd: false, eventAt: '2026-10-08T10:00:00Z',
};
const DAY = 86400000;
beforeEach(() => db.from.mockReset());

describe('applyPaddleSubscription', () => {
  it('정상 이벤트는 upsert', async () => {
    const read = chain({ data: null, error: null }); const write = chain({ error: null });
    db.from.mockReturnValueOnce(read).mockReturnValueOnce(write);
    await applyPaddleSubscription(base);
    expect(write.upsert).toHaveBeenCalledWith(expect.objectContaining({ plan: 'pro', paddle_subscription_id: 'sub_new' }), expect.anything());
  });

  it('저장된 것보다 오래된 이벤트는 무시(순서 뒤바뀜)', async () => {
    db.from.mockReturnValueOnce(chain({ data: { paddle_subscription_id: 'sub_new', paddle_event_at: '2026-10-08T12:00:00Z' }, error: null }));
    await applyPaddleSubscription(base);
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('옛 구독의 canceled 이벤트는 새 구독을 내리지 않음', async () => {
    db.from.mockReturnValueOnce(chain({ data: { paddle_subscription_id: 'sub_new', paddle_event_at: null }, error: null }));
    await applyPaddleSubscription({ ...base, subscriptionId: 'sub_old', status: 'canceled' });
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('현재 구독의 canceled는 free로 내림', async () => {
    const write = chain({ error: null });
    db.from.mockReturnValueOnce(chain({ data: { paddle_subscription_id: 'sub_new', paddle_event_at: null }, error: null })).mockReturnValueOnce(write);
    await applyPaddleSubscription({ ...base, status: 'canceled' });
    expect(write.upsert).toHaveBeenCalledWith(expect.objectContaining({ plan: 'free', status: 'canceled' }), expect.anything());
  });

  it('DB 오류는 삼키지 않고 throw(code 보존)', async () => {
    db.from.mockReturnValueOnce(chain({ data: null, error: { message: 'boom', code: '57P01' } }));
    await expect(applyPaddleSubscription(base)).rejects.toMatchObject({ code: '57P01' });
  });
});

describe('getUserPlan 유예', () => {
  const plan = (row: object) => { db.from.mockReturnValueOnce(chain({ data: { plan: 'pro', granted: false, ...row }, error: null })); return getUserPlan('u1'); };
  it('기간 만료 1일 후(갱신 웹훅 지연)에도 유지', async () => {
    expect(await plan({ status: 'active', current_period_end: new Date(Date.now() - DAY).toISOString() })).toBe('pro');
  });
  it('past_due도 유예 안에서는 유지', async () => {
    expect(await plan({ status: 'past_due', current_period_end: new Date(Date.now() - DAY).toISOString() })).toBe('pro');
  });
  it('유예(3일) 지나면 free', async () => {
    expect(await plan({ status: 'active', current_period_end: new Date(Date.now() - 4 * DAY).toISOString() })).toBe('free');
  });
  it('canceled는 즉시 free', async () => {
    expect(await plan({ status: 'canceled', current_period_end: new Date(Date.now() + 10 * DAY).toISOString() })).toBe('free');
  });
});

describe('revokeByTransaction', () => {
  it('최신 유료 결제의 환불이면 구독 회수', async () => {
    const sub = chain({ error: null });
    db.from
      .mockReturnValueOnce(chain({ data: { user_id: 'u1', plan: 'pro' }, error: null }))
      .mockReturnValueOnce(chain({ data: { payment_id: 'txn_9' }, error: null }))
      .mockReturnValueOnce(sub);
    await revokeByTransaction('txn_9');
    expect(sub.update).toHaveBeenCalledWith({ plan: 'free', status: 'canceled' });
  });
  it('과거 달 결제 환불은 현재 구독을 건드리지 않음', async () => {
    db.from
      .mockReturnValueOnce(chain({ data: { user_id: 'u1', plan: 'pro' }, error: null }))
      .mockReturnValueOnce(chain({ data: { payment_id: 'txn_new' }, error: null }));
    await revokeByTransaction('txn_old');
    expect(db.from).toHaveBeenCalledTimes(2);
  });
  it('단건(free 기록) 환불은 구독 무관', async () => {
    db.from.mockReturnValueOnce(chain({ data: { user_id: 'u1', plan: 'free' }, error: null }));
    await revokeByTransaction('txn_pass');
    expect(db.from).toHaveBeenCalledTimes(1);
  });
});
