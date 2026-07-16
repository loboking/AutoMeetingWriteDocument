// Firebase Cloud Functions (2nd gen) — Gemini STT 프록시 진입.
// 클라이언트(브라우저) → Firebase Function 직접 호출. Vercel 300s 한계 회피.
//
// 핵심: region="us-central1" 강제 → US egress IP로 Gemini API 호출 → geo-block 회피.
//   - Cloudflare Workers는 colo 강제 불가(3차 시도 전부 HKG 유지 → Gemini 400 geo-block).
//   - Firebase Functions는 region 명시 = US 리전 고정 배포. 결정적 차이.
//
// 흐름 (workers/stt-proxy/src/index.ts 와 동일):
//   1. POST / — Authorization: Bearer <Supabase JWT> 검증 → 본문 { signedUrl, language }
//   2. signedUrl에서 오디오 fetch → ArrayBuffer (Supabase Storage만 허용, SSRF 방지)
//   3. transcribeWithGemini() → File API 업로드 + 폴링(3s×15=45s 캡) + generateContent
//   4. 클라에 { text, segments, duration, language, provider, hasSpeakerDiarization } 반환
//
// Vercel /api/transcribe 는 폴백으로 유지됨 — Function 장애/작은 파일/Whisper 선호 시.

// Node 20 폴리필 — supabase-js v2 createClient가 무조건 RealtimeClient(WebSocket)를 초기화.
// Node 20엔 native WebSocket이 없음(Node 22+ 필요). STT 프록시는 Realtime 불필요하지만
// 생성자가 강제 초기화(직검: _initRealtimeClient → new RealtimeClient)하므로 ws 폴리필로 회피.
// supabase-js import보다 먼저 실행되어야 함.
import { WebSocket as WS } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WS as unknown as typeof globalThis.WebSocket;
}

import { onRequest } from 'firebase-functions/v2/https';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadGeminiEnv, transcribeWithGemini } from './gemini';
import type { Request, Response } from 'express';

// Supabase Storage 도메인만 허용 — 임의 URL fetch(SSRF) 차단.
// 메인 앱 NEXT_PUBLIC_SUPABASE_URL 과 동일한 호스트인지 검증.
function isAllowedSignedUrl(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.host === new URL(supabaseUrl).host;
  } catch {
    return false;
  }
}

// Authorization: Bearer <jwt> → Supabase getUser 로 검증.
// 원본 패턴(src/lib/apiAuth.ts:requireUser)과 동일 — 클라 토큰 그대로 Function으로.
async function requireUser(
  req: Request,
  supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; status: number; body: unknown }> {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return { ok: false, status: 401, body: { error: '로그인이 필요합니다.' } };
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { ok: false, status: 401, body: { error: '인증에 실패했습니다.' } };
  }
  return { ok: true, userId: user.id };
}

interface TranscribeBody {
  signedUrl?: string;
  language?: string;
}

// CORS — 메인 앱 도메인에서만 호출. PROD_ORIGINS 환경변수(운영 도메인) + dev localhost 허용.
// 보안(P0): Function이 공개 프록시면 남용 위험 → 운영/Vercel 도메인만.
// onRequest의 cors:true 대신 명시적으로 잠금(Workers 원본 동작 보존).
function getAllowedOrigins(): string[] {
  return (process.env.PROD_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return true;
  // dev(localhost:*)는 항상 허용, 운영은 PROD_ORIGINS에서.
  return /^http:\/\/localhost:\d+$/.test(origin);
}

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin ?? '';
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Vary', 'Origin');
}

export const sttProxy = onRequest(
  {
    region: 'us-central1', // ★ geo-block 회피 핵심 — US egress 강제. 빠지면 안 됨.
    timeoutSeconds: 540, // Blaze 플랜 한계. 301s 처리 OK.
    memory: '1GiB', // 35MB 오디오 처리용.
    // cors: true 대신 명시적 CORS 헤더로 PROD_ORIGINS 잠금(Workers 원본 패턴 보존).
    // 2nd gen secrets binding — functions:secrets:set으로 저장한 값이 process.env로 주입되려면
    // 명시적 binding 필수(binding 없으면 geminiKey:false/supabase:false probe로 나타남).
    secrets: [
      'GEMINI_API_KEY',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'PROD_ORIGINS',
    ],
  },
  async (req: Request, res: Response) => {
    setCorsHeaders(req, res);

    // /health — 오너 배포 후 점검용. ?probe=1 추가 시 실제 Gemini API 접근성(geo-block) 검사.
    if (req.method === 'GET' && req.path === '/health') {
      const env = loadGeminiEnv();
      const base = {
        ok: true,
        service: 'stt-proxy-firebase',
        region: 'us-central1',
        geminiKey: !!env.GEMINI_API_KEY,
        supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY,
      };
      if (!env.GEMINI_API_KEY || req.query.probe !== '1') {
        res.status(200).json(base);
        return;
      }
      // Gemini File API resumable 시작 경로로 geo-block 검사(us-central1 회피 검증).
      // 400 "User location is not supported" = Function egress가 Gemini에서 차단.
      try {
        const probeRes = await fetch(
          `${'https://generativelanguage.googleapis.com/upload/v1beta/files'}?uploadType=resumable&key=${env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: { displayName: 'health-probe' } }),
          }
        );
        const detail = await probeRes.text().catch(() => '');
        res.status(200).json({
          ...base,
          geminiProbe: {
            status: probeRes.status,
            geoBlocked: probeRes.status === 400 && detail.includes('User location is not supported'),
            ok: probeRes.ok,
          },
        });
      } catch (e) {
        res.status(200).json({
          ...base,
          geminiProbe: { error: e instanceof Error ? e.message : 'unknown', ok: false },
        });
      }
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // 필수 환경변수 확인
    if (!process.env.GEMINI_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      res.status(500).json({
        error: 'Functions 환경변수 미설정 (GEMINI_API_KEY/SUPABASE_URL/SUPABASE_ANON_KEY)',
      });
      return;
    }

    // Supabase 클라이언트 — getUser는 stateless. 요청마다 생성해도 안전.
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 인증
    const auth = await requireUser(req, supabase);
    if (!auth.ok) {
      res.status(auth.status).json(auth.body);
      return;
    }

    // 본문 파싱 — Firebase Functions는 JSON content-type이면 req.body를 자동 파싱.
    const body = (req.body ?? {}) as TranscribeBody;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: '잘못된 요청입니다.' });
      return;
    }

    const { signedUrl, language } = body;
    if (!signedUrl || !isAllowedSignedUrl(signedUrl, process.env.SUPABASE_URL)) {
      res.status(400).json({ error: '유효하지 않은 오디오 URL입니다.' });
      return;
    }

    try {
      // [DEBUG 35MB] POST 진입 — 단계별 로그. 원인 확정 후 제거.
      console.log('[sttProxy] POST 진입', { signedUrlPrefix: signedUrl.slice(0, 60), language });

      // 오디오 fetch — Supabase Storage 서명 URL에서만.
      console.log('[sttProxy] fetch(signedUrl) 시작');
      const audioRes = await fetch(signedUrl);
      console.log('[sttProxy] fetch(signedUrl) 응답', { status: audioRes.status, ok: audioRes.ok });
      if (!audioRes.ok) {
        console.error('[sttProxy] 오디오 fetch 실패', { status: audioRes.status });
        res.status(502).json({ error: '오디오를 가져오지 못했습니다.' });
        return;
      }
      console.log('[sttProxy] arrayBuffer() 시작');
      const audio = await audioRes.arrayBuffer();
      const contentType = audioRes.headers.get('content-type') || undefined;
      console.log('[sttProxy] arrayBuffer 완료', { byteLength: audio.byteLength, contentType });

      // Gemini STT. 폴링 3s×15=45s 캡 내부적으로 적용됨.
      const env = loadGeminiEnv();
      console.log('[sttProxy] transcribeWithGemini 시작', { model: env.GEMINI_STT_MODEL || env.GEMINI_MODEL || '(default)' });
      const result = await transcribeWithGemini(audio, env, { language, contentType });
      console.log('[sttProxy] transcribeWithGemini 완료', { textLength: result.text.length, segmentCount: result.segments.length });

      res.status(200).json({
        text: result.text,
        segments: result.segments,
        duration: result.duration,
        language: result.language,
        provider: result.provider,
        hasSpeakerDiarization: result.hasSpeakerDiarization,
      });
    } catch (error) {
      // [DEBUG] catch에서 error.message 로그 — 원인 가려짐 해소.
      const message = error instanceof Error ? error.message : String(error);
      console.error('[sttProxy] POST 처리 에러', { message, stack: error instanceof Error ? error.stack : undefined });
      const isTimeout = message.includes('ACTIVE 대기 시간 초과');
      // GEMINI_GEO_BLOCKED: Function egress IP가 Gemini API에서 geo-block 당함(us-central1 배포 시 발생 안 함).
      //   발생 시 Vercel /api/transcribe 폴백으로 가야 함 — 503 + 명시적 reason.
      const isGeoBlocked = message.startsWith('GEMINI_GEO_BLOCKED');
      const status = isGeoBlocked
        ? 503
        : message === 'NO_STT_PROVIDER'
          ? 503
          : isTimeout
            ? 504
            : 502;

      // message만 노출 — 스택/키/환경변수 절대 포함 금지 (원본 transcribe/route.ts와 동일 원칙).
      const reason = isGeoBlocked
        ? 'GEMINI_GEO_BLOCKED'
        : message === 'NO_STT_PROVIDER'
          ? 'NO_STT_PROVIDER'
          : undefined;
      res.status(status).json({
        error: '음성 변환에 실패했습니다.',
        detail: message,
        ...(reason ? { reason } : {}),
      });
    }
  }
);
