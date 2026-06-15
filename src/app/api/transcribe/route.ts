import { NextRequest, NextResponse } from 'next/server';
import { getServerProvider } from '@/lib/stt/factory';
import { NO_STT_PROVIDER } from '@/lib/stt/types';

export const runtime = 'nodejs';

// 50MB 초과 업로드 거부
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // formData 파싱 실패(빈 body 등)도 400으로 처리 — 500 방지
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: '오디오 파일이 필요합니다.' }, { status: 400 });
    }
    const audioFile = formData.get('audioFile') as File | null;
    const language = (formData.get('language') as string) || 'ko';

    if (!audioFile) {
      return NextResponse.json({ error: '오디오 파일이 필요합니다.' }, { status: 400 });
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'FILE_TOO_LARGE', message: '오디오 파일이 너무 큽니다. (최대 50MB)' },
        { status: 413 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Provider DI: OPENAI_API_KEY 있으면 Whisper, 없으면 Dummy(NO_STT_PROVIDER throw)
    const provider = getServerProvider();
    const result = await provider.transcribe(buffer, { language });

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
