// R2 presign 발급 라우트. Supabase 무료 50MB 한계 → R2(~5GB presigned PUT) 전환의 서버측 절반.
// 클라이언트는 이 라우트에서 받은 presigned URL로 R2에 직접 PUT/GET — 파일이 Vercel을 통과하지 않는다.
//
// 유저 격리: Supabase RLS({auth.uid}/ 프리픽스)가 하던 역할을 여기서 key 검증/생성으로 대체.
//   - PUT presign: key를 서버에서 생성({userId}/{uuid}.{ext}) — 클라가 경로를 정하지 못함.
//   - GET/DELETE: 요청 key 프리픽스가 본인 userId인지 검증(타인 파일 접근 차단).
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { AwsClient } from 'aws4fetch';

export const runtime = 'nodejs';

// ── R2 설정(env) ──
// R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY : 버킷 API 토큰(S3 호환 자격증명)
// R2_ENDPOINT : 계정별 엔드포인트 (예: https://<account>.r2.cloudflarestorage.com)
// R2_BUCKET   : 버킷명
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;

function getR2Client(): AwsClient {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!R2_ENDPOINT || !R2_BUCKET || !accessKeyId || !secretAccessKey) {
    throw new Error('NO_RECORDING_STORAGE');
  }
  return new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
}

// 확장자 화이트리스트 — 경로 조작/임의 키 차단.
function safeExt(ext: string): string {
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin';
}

// presigned URL 생성(aws4fetch). TTL은 URL에 X-Amz-Expires를 "사인 전에" 심는다 —
// aws4fetch는 이미 있는 X-Amz-Expires를 서명에 포함한다(라이브러리 내부 확인).
// 사인 후 파라미터를 추가/변경하면 서명 불일치로 403.
async function presign(
  client: AwsClient,
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  ttlSec: number
): Promise<string> {
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(Math.max(60, Math.min(ttlSec, 86400))));
  const signed = await client.sign(new Request(url, { method }), {
    aws: { signQuery: true },
  } as never);
  return signed.url;
}

export async function POST(request: NextRequest) {
  // PUT presign — 업로드용. key는 서버가 생성(유저 격리).
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const client = getR2Client();
    const body = (await request.json().catch(() => ({}))) as {
      contentType?: string;
      ext?: string;
    };
    const ext = safeExt((body.ext || '').toLowerCase());
    const key = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;

    const uploadUrl = await presign(client, 'PUT', key, 600);
    return NextResponse.json({ key, uploadUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NO_RECORDING_STORAGE') {
      return NextResponse.json({ error: 'NO_RECORDING_STORAGE', message: '저장소가 설정되지 않았습니다.' }, { status: 503 });
    }
    console.error('[storage/sign] PUT presign 오류:', error);
    return NextResponse.json({ error: 'presign 실패' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  // GET presign — STT 서버가 fetch할 읽기 URL.
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const client = getR2Client();
    const body = (await request.json().catch(() => ({}))) as { key?: string; ttlSec?: number };
    const key = body.key || '';
    // 유저 격리: 본인 프리픽스만.
    if (!key.startsWith(`${auth.user.id}/`)) {
      return NextResponse.json({ error: '유효하지 않은 키입니다.' }, { status: 403 });
    }
    const url = await presign(client, 'GET', key, body.ttlSec || 300);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NO_RECORDING_STORAGE') {
      return NextResponse.json({ error: 'NO_RECORDING_STORAGE', message: '저장소가 설정되지 않았습니다.' }, { status: 503 });
    }
    console.error('[storage/sign] GET presign 오류:', error);
    return NextResponse.json({ error: 'presign 실패' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  // 객체 삭제(성공한 변환의 임시 사본 정리). 유저 격리 동일.
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const client = getR2Client();
    const body = (await request.json().catch(() => ({}))) as { key?: string };
    const key = body.key || '';
    if (!key.startsWith(`${auth.user.id}/`)) {
      return NextResponse.json({ error: '유효하지 않은 키입니다.' }, { status: 403 });
    }
    const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`);
    const res = await client.fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      console.warn('[storage/sign] R2 DELETE 실패:', res.status);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[storage/sign] DELETE 오류:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
