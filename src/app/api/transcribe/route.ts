import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Whisper API를 사용한 STT
async function transcribeWithWhisper(audioBuffer: Buffer): Promise<{ text: string; duration: number }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY_MISSING');
  }

  try {
    const formData = new FormData();
    const uint8Array = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8Array], { type: 'audio/webm' });
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'ko');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Whisper API 오류');
    }

    const data = await response.json();
    return {
      text: data.text,
      duration: data.duration || 0,
    };
  } catch (error) {
    console.error('STT 오류:', error);
    throw new Error('음성 변환에 실패했습니다.');
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audioFile') as File;
    const language = (formData.get('language') as string) || 'ko';

    if (!audioFile) {
      return NextResponse.json({ error: '오디오 파일이 필요합니다.' }, { status: 400 });
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await transcribeWithWhisper(buffer);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Transcribe API 오류:', error);

    // API 키 누락 특별 처리
    if (error instanceof Error && error.message === 'OPENAI_API_KEY_MISSING') {
      return NextResponse.json(
        {
          error: 'OPENAI_API_KEY_MISSING',
          message: 'OPENAI_API_KEY가 설정되지 않았습니다. .env.local 파일에 API 키를 설정해주세요.'
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: '음성 변환에 실패했습니다.' },
      { status: 500 }
    );
  }
}
