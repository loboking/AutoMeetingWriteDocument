// 서버 전용 Paddle Billing 헬퍼. 클라 import 금지(PADDLE_API_KEY 등 서버 비밀 사용).
// 같은 Paddle 계정을 다른 서비스(사주살롱)와 공유 → Price ID로 우리 상품만 필터한다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanId } from '@/lib/plans';

export type PaddleKind = PlanId | 'pass' | 'extra';

export const PADDLE_ENV = process.env.PADDLE_ENV === 'production' ? 'production' : 'sandbox';
const API_BASE = PADDLE_ENV === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';

// Price ID → 상품 종류. 값이 비어있으면(env 미설정) 매핑에서 빠진다.
function priceMap(): Record<string, PaddleKind> {
  const entries: [string | undefined, PaddleKind][] = [
    [process.env.PADDLE_PRICE_PRO, 'pro'],
    [process.env.PADDLE_PRICE_TEAM, 'team'],
    [process.env.PADDLE_PRICE_PASS, 'pass'],
    [process.env.PADDLE_PRICE_EXTRA, 'extra'],
  ];
  return Object.fromEntries(entries.filter(([id]) => id).map(([id, kind]) => [id as string, kind]));
}

export function kindForPrice(priceId: string | undefined): PaddleKind | null {
  return (priceId && priceMap()[priceId]) || null;
}

// 구독 플랜 → Price ID (checkout이 서버에서 결정).
export function priceIdForPlan(plan: PlanId): string | null {
  if (plan === 'pro') return process.env.PADDLE_PRICE_PRO ?? null;
  if (plan === 'team') return process.env.PADDLE_PRICE_TEAM ?? null;
  return null;
}

export function isPaddleConfigured(): boolean {
  return !!process.env.PADDLE_API_KEY && !!process.env.PADDLE_WEBHOOK_SECRET;
}

// Paddle-Signature: "ts=1671552777;h1=<hex>" — HMAC-SHA256(`${ts}:${rawBody}`, secret).
// secret 회전 중에는 h1이 여러 개 오므로 하나라도 맞으면 통과. 재전송 방지로 ts 허용오차 5분.
export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const pairs = header.split(';').map((p) => p.trim().split('='));
  const ts = pairs.find(([k]) => k === 'ts')?.[1];
  const hashes = pairs.filter(([k]) => k === 'h1').map(([, v]) => v);
  if (!ts || hashes.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex'));
  return hashes.some((h) => {
    const b = Buffer.from(h ?? '');
    return b.length === expected.length && timingSafeEqual(expected, b);
  });
}

// custom_data.userId는 체크아웃을 여는 브라우저가 정하는 값 → 남의 userId를 붙여 결제하는 걸 막기 위해
// 서버가 userId에 서명(sig)해 내려주고, 웹훅이 서명이 맞을 때만 그 userId를 신뢰한다.
export function signUserId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`uid:${userId}`).digest('hex');
}

export function verifyUserSig(userId: string, sig: unknown, secret: string): boolean {
  if (typeof sig !== 'string') return false;
  const a = Buffer.from(signUserId(userId, secret));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 구독 해지. 기본은 다음 결제일에 종료(기간 끝까지 이용), 'immediately'는 즉시 종료(중복 구독 정리·결제 재시도 중 해지).
export async function cancelPaddleSubscription(
  subscriptionId: string,
  effectiveFrom: 'next_billing_period' | 'immediately' = 'next_billing_period'
): Promise<void> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error('Paddle 미설정(PADDLE_API_KEY)');
  const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ effective_from: effectiveFrom }),
  });
  if (!res.ok) throw new Error(`Paddle cancel ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
