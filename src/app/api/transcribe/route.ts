import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { getServerProvider } from '@/lib/stt/factory';
import { canChunk, needsChunking, transcribeChunked } from '@/lib/stt/chunkTranscribe';
import { NO_STT_PROVIDER } from '@/lib/stt/types';

export const runtime = 'nodejs';
export const maxDuration = 300; // 키 있을 때 서버 Whisper가 긴 오디오에 일찍 끊기지 않도록

// 단일 Whisper 호출 상한(25MB 직전). 분할 가능 포맷(mp3)은 청크로 우회 → 크기 무관.
const SINGLE_CALL_MAX_BYTES = 24 * 1024 * 1024;
const SINGLE_CALL_MAX_MB = 24;
const TOO_LARGE_MESSAGE = `오디오 파일이 너무 큽니다. (mp3는 무제한, 그 외 포맷은 최대 ${SINGLE_CALL_MAX_MB}MB) 긴 녹음은 mp3로 변환하거나 파일을 나눠 올려주세요.`;

// 큰 파일 거부 여부: 분할 가능 포맷이면 통과(청크 처리), 아니면 단일 호출 상한 적용.
function isTooLarge(byteLength: number, contentType?: string): boolean {
  if (canChunk(contentType)) return false; // mp3 등 → 청크로 처리하므로 크기 무관
  return byteLength > SINGLE_CALL_MAX_BYTES;
}

// signedUrl은 신뢰 도메인(Supabase Storage)만 허용 — 임의 URL fetch(SSRF) 차단.
function isAllowedSignedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!base) return false;
    return u.host === new URL(base).host;
  } catch {
    return false;
  }
}

// JSON { signedUrl } 또는 multipart(audioFile) 양쪽에서 오디오 Buffer를 얻는다.
// 반환: { buffer, language } 또는 { errorResponse }(검증 실패 시 즉시 응답).
async function resolveAudio(
  request: NextRequest
): Promise<{ buffer: Buffer; language: string; contentType?: string } | { errorResponse: NextResponse }> {
  const contentType = request.headers.get('content-type') || '';

  // 경로 A: 클라가 저장소에 직접 업로드 후 서명 URL 전달 (Vercel 4.5MB 바디 한계 우회)
  if (contentType.includes('application/json')) {
    let body: { signedUrl?: string; language?: string };
    try {
      body = await request.json();
    } catch {
      return { errorResponse: NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 }) };
    }
    const signedUrl = body.signedUrl;
    const language = body.language || 'ko';
    if (!signedUrl || !isAllowedSignedUrl(signedUrl)) {
      return { errorResponse: NextResponse.json({ error: '유효하지 않은 오디오 URL입니다.' }, { status: 400 }) };
    }

    const res = await fetch(signedUrl);
    if (!res.ok) {
      return { errorResponse: NextResponse.json({ error: '오디오를 가져오지 못했습니다.' }, { status: 502 }) };
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // 저장소가 보존한 원본 MIME → Whisper 포맷 판단 + 분할 가능 여부 판정용
    const audioContentType = res.headers.get('content-type') || undefined;
    if (isTooLarge(buffer.byteLength, audioContentType)) {
      return {
        errorResponse: NextResponse.json(
          { error: 'FILE_TOO_LARGE', message: TOO_LARGE_MESSAGE },
          { status: 413 }
        ),
      };
    }
    return { buffer, language, contentType: audioContentType };
  }

  // 경로 B: 기존 multipart 직접 업로드 (하위호환 — 소형 파일/폴백)
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { errorResponse: NextResponse.json({ error: '오디오 파일이 필요합니다.' }, { status: 400 }) };
  }
  const audioFile = formData.get('audioFile') as File | null;
  const language = (formData.get('language') as string) || 'ko';

  if (!audioFile) {
    return { errorResponse: NextResponse.json({ error: '오디오 파일이 필요합니다.' }, { status: 400 }) };
  }
  if (isTooLarge(audioFile.size, audioFile.type || undefined)) {
    return {
      errorResponse: NextResponse.json(
        { error: 'FILE_TOO_LARGE', message: TOO_LARGE_MESSAGE },
        { status: 413 }
      ),
    };
  }
  const arrayBuffer = await audioFile.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), language, contentType: audioFile.type || undefined };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const resolved = await resolveAudio(request);
    if ('errorResponse' in resolved) return resolved.errorResponse;
    const { buffer, language, contentType } = resolved;

    // Provider DI: OPENAI_API_KEY 있으면 Whisper, 없으면 Dummy(NO_STT_PROVIDER throw)
    const provider = getServerProvider();
    // 큰 분할 가능 포맷(mp3)은 청크 병렬 처리, 그 외는 단일 호출.
    const result =
      needsChunking(buffer.byteLength) && canChunk(contentType)
        ? await transcribeChunked(buffer, { language, contentType })
        : await provider.transcribe(buffer, { language, contentType });

    // TranscribeResponseSchema 형태로 반환
    return NextResponse.json({
      text: result.text,
      segments: result.segments,
      duration: result.duration,
      language: result.language,
      provider: result.provider,
      hasSpeakerDiarization: result.hasSpeakerDiarization,
    });
  } catch (error) {
    // 서버 STT 수단 부재 → 클라가 브라우저 STT / 수동 입력으로 폴백하도록 유도
    if (error instanceof Error && error.message === NO_STT_PROVIDER) {
      return NextResponse.json(
        {
          error: NO_STT_PROVIDER,
          message: '서버 STT 수단이 없습니다. 브라우저 STT를 사용하거나 텍스트를 직접 입력하세요.',
          fallbackOptions: ['browser-stt', 'manual-text'],
        },
        { status: 503 }
      );
    }

    console.error('Transcribe API 오류:', error);
    return NextResponse.json({ error: '음성 변환에 실패했습니다.' }, { status: 500 });
  }
}
