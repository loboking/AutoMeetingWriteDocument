import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { kindForPrice, signUserId, verifyPaddleSignature, verifyUserSig } from './paddle';

const sign = (body: string, secret: string, ts: number) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;

describe('verifyPaddleSignature', () => {
  const now = Math.floor(Date.now() / 1000);
  const body = '{"event_type":"transaction.completed"}';

  it('올바른 서명 통과', () => {
    expect(verifyPaddleSignature(body, sign(body, 's3cret', now), 's3cret')).toBe(true);
  });
  it('본문 변조·다른 secret·헤더 누락 거부', () => {
    expect(verifyPaddleSignature(body + ' ', sign(body, 's3cret', now), 's3cret')).toBe(false);
    expect(verifyPaddleSignature(body, sign(body, 'other', now), 's3cret')).toBe(false);
    expect(verifyPaddleSignature(body, null, 's3cret')).toBe(false);
  });
  it('secret 회전 중 h1이 여러 개여도 하나만 맞으면 통과', () => {
    const good = sign(body, 's3cret', now);
    const withOld = good.replace(`;h1=`, `;h1=deadbeef;h1=`).replace(/;h1=deadbeef;h1=([0-9a-f]+)/, ';h1=deadbeef;h1=$1');
    expect(verifyPaddleSignature(body, `${good.split(';h1=')[0]};h1=${'0'.repeat(64)};h1=${good.split('h1=')[1]}`, 's3cret')).toBe(true);
    expect(withOld.includes('deadbeef')).toBe(true);
  });
  it('5분 넘은 타임스탬프 거부(재전송 방지)', () => {
    expect(verifyPaddleSignature(body, sign(body, 's3cret', now - 400), 's3cret')).toBe(false);
  });
});

describe('kindForPrice', () => {
  it('우리 Price ID만 매핑, 그 외(다른 서비스)는 null', () => {
    vi.stubEnv('PADDLE_PRICE_PRO', 'pri_pro');
    vi.stubEnv('PADDLE_PRICE_PASS', 'pri_pass');
    expect(kindForPrice('pri_pro')).toBe('pro');
    expect(kindForPrice('pri_pass')).toBe('pass');
    expect(kindForPrice('pri_saju')).toBeNull();
    expect(kindForPrice(undefined)).toBeNull();
  });
});

describe('userId 서명', () => {
  it('자기 userId의 서명만 통과, 타인 userId에 붙이면 거부', () => {
    const sig = signUserId('user-a', 'k');
    expect(verifyUserSig('user-a', sig, 'k')).toBe(true);
    expect(verifyUserSig('user-b', sig, 'k')).toBe(false);
    expect(verifyUserSig('user-a', undefined, 'k')).toBe(false);
    expect(verifyUserSig('user-a', sig, 'other')).toBe(false);
  });
});
