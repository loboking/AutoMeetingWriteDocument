// Cloudflare Workers — Gemini STT 프록시 진입.
// 클라이언트(브라우저) → Workers 직접 호출. Vercel 300s 한계 회피.
//
// 흐름:
//   1. POST / — Authorization: Bearer <Supabase JWT> 검증 → 본문 { signedUrl, language }
//   2. signedUrl에서 오디오 fetch → ArrayBuffer (Supabase Storage만 허용, SSRF 방지)
//   3. transcribeWithGemini() → File API 업로드 + 폴링(3s×15=45s 캡) + generateContent
//   4. 클라에 { text, segments, duration, language, provider, hasSpeakerDiarization } 반환
//
// Vercel /api/transcribe 는 폴백으로 유지됨 — Workers 장애/작은 파일/Whisper 선호 시.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { transcribeWithGemini } from './gemini';

export interface Env {
  GEMINI_API_KEY: string;
  GEMINI_STT_MODEL?: string;
  GEMINI_MODEL?: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

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
// 원본 패턴(src/lib/apiAuth.ts:requireUser)과 동일 — 클라 토큰 그대로 Workers로.
async function requireUser(
  request: Request,
  supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return {
      ok: false,
      response: Response.json({ error: '로그인이 필요합니다.' }, { status: 401 }),
    };
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return {
      ok: false,
      response: Response.json({ error: '인증에 실패했습니다.' }, { status: 401 }),
    };
  }
  return { ok: true, userId: user.id };
}

interface TranscribeBody {
  signedUrl?: string;
  language?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /health — 오너 배포 후 점검용
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'stt-proxy',
        gemini: !!env.GEMINI_API_KEY,
        supabase: !!env.SUPABASE_URL && !!env.SUPABASE_ANON_KEY,
      });
    }

    // CORS — 메인 앱 도메인에서만 호출. 실제 도메인은 배포 후 env로 제한(P1).
    // 일단 * (개발/배포 직후). TODO: PROD_ORIGIN 환경변수로 잠글 것.
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    // 필수 환경변수 확인
    if (!env.GEMINI_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return Response.json(
        { error: 'Workers 환경변수 미설정 (GEMINI_API_KEY/SUPABASE_URL/SUPABASE_ANON_KEY)' },
        { status: 500, headers: corsHeaders }
      );
    }

    // Supabase 클라이언트 — getUser는 stateless. 요청마다 생성해도 안전.
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 인증
    const auth = await requireUser(request, supabase);
    if (!auth.ok) {
      return auth.response;
    }

    // 본문 파싱
    let body: TranscribeBody;
    try {
      body = (await request.json()) as TranscribeBody;
    } catch {
      return Response.json(
        { error: '잘못된 요청입니다.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { signedUrl, language } = body;
    if (!signedUrl || !isAllowedSignedUrl(signedUrl, env.SUPABASE_URL)) {
      return Response.json(
        { error: '유효하지 않은 오디오 URL입니다.' },
        { status: 400, headers: corsHeaders }
      );
    }

    try {
      // 오디오 fetch — Supabase Storage 서명 URL에서만.
      const audioRes = await fetch(signedUrl);
      if (!audioRes.ok) {
        return Response.json(
          { error: '오디오를 가져오지 못했습니다.' },
          { status: 502, headers: corsHeaders }
        );
      }
      const audio = await audioRes.arrayBuffer();
      const contentType = audioRes.headers.get('content-type') || undefined;

      // Gemini STT. 폴링 3s×15=45s 캡 내부적으로 적용됨.
      const result = await transcribeWithGemini(audio, env, { language, contentType });

      return Response.json(
        {
          text: result.text,
          segments: result.segments,
          duration: result.duration,
          language: result.language,
          provider: result.provider,
          hasSpeakerDiarization: result.hasSpeakerDiarization,
        },
        { headers: corsHeaders }
      );
    } catch (error) {
      // Gemini File API ACTIVE 대기 시간 초과 (Workers 폴링 45s 캡)
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.includes('ACTIVE 대기 시간 초과');
      const status = message === 'NO_STT_PROVIDER' ? 503 : isTimeout ? 504 : 502;

      // message만 노출 — 스택/키/환경변수 절대 포함 금지 (원본 transcribe/route.ts와 동일 원칙).
      return Response.json(
        { error: '음성 변환에 실패했습니다.', detail: message },
        { status, headers: corsHeaders }
      );
    }
  },
};
