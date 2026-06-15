'use client';

// 브라우저 무료 STT 훅. 서버 STT(Whisper API)가 없을 때(키 없음) 폴백.
// - 파일/녹음 변환: transformers.js Whisper(WASM/WebGPU, 무료, 모델 1회 다운로드 후 캐시)
// - 실시간 녹음 받아쓰기: Web Speech API(가벼움, Chrome/Edge)
// 결정 로직은 src/lib/stt/browserSTT.ts(순수, 테스트됨)에서 가져옴.
import { useState, useRef, useCallback } from 'react';
import { decideBrowserSttStrategy, pickWhisperModel, type BrowserSttStrategy } from '@/lib/stt/browserSTT';
import type { TranscriptionResult, TranscriptSegment } from '@/lib/stt/types';

// transformers.js pipeline 캐시 (모델 재로딩 방지)
let asrPipelinePromise: Promise<unknown> | null = null;
let asrPipelineModel: string | null = null;

function isWebSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  );
}

// transformers.js는 WASM 폴백이 있어 대부분 브라우저에서 동작 가능 (SSR만 가드)
function isTransformersSupported(): boolean {
  return typeof window !== 'undefined';
}

export function getBrowserSttStrategy(source: 'mic' | 'file'): BrowserSttStrategy {
  return decideBrowserSttStrategy({
    source,
    transformersSupported: isTransformersSupported(),
    webSpeechSupported: isWebSpeechSupported(),
  });
}

interface UseBrowserSTTReturn {
  isTranscribing: boolean;
  progress: number; // 0~100 (모델 다운로드/추론 진행)
  error: string | null;
  // 파일/Blob을 transformers.js로 변환
  transcribeBlob: (blob: Blob, language?: string) => Promise<TranscriptionResult | null>;
}

export function useBrowserSTT(): UseBrowserSTTReturn {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const transcribeBlob = useCallback(async (blob: Blob, language = 'ko'): Promise<TranscriptionResult | null> => {
    if (typeof window === 'undefined') return null;
    setError(null);
    setIsTranscribing(true);
    setProgress(0);
    cancelRef.current = false;

    try {
      const model = pickWhisperModel(language);
      // transformers.js 동적 import (번들 분리 — 초기 로딩 영향 최소화)
      const { pipeline } = await import('@huggingface/transformers');

      // 파이프라인 캐시 (같은 모델이면 재사용)
      if (!asrPipelinePromise || asrPipelineModel !== model) {
        asrPipelineModel = model;
        asrPipelinePromise = pipeline('automatic-speech-recognition', model, {
          // q8: WASM 기본 양자화(안정). q4는 일부 Whisper 모델에서 로딩 에러 발생
          dtype: 'q8',
          progress_callback: (p: { status?: string; progress?: number }) => {
            if (p?.status === 'progress' && typeof p.progress === 'number') {
              setProgress(Math.min(95, Math.round(p.progress)));
            }
          },
        } as Record<string, unknown>);
      }
      const asr = (await asrPipelinePromise) as (
        audio: Float32Array,
        opts: Record<string, unknown>
      ) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number, number] }> }>;

      if (cancelRef.current) return null;
      setProgress(96);

      // Blob → Float32Array (16kHz mono). transformers.js는 디코딩된 PCM을 받음.
      const audioData = await blobToFloat32(blob);
      if (cancelRef.current) return null;

      const out = await asr(audioData, {
        language,
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      setProgress(100);

      const text = (out.text || '').trim();
      const segments: TranscriptSegment[] = (out.chunks || [])
        .filter((c) => c.text && c.text.trim())
        .map((c) => ({
          speaker: 'Unknown',
          text: c.text.trim(),
          start: c.timestamp?.[0] ?? 0,
          end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
        }));

      const result: TranscriptionResult = {
        segments: segments.length > 0 ? segments : text ? [{ speaker: 'Unknown', text, start: 0, end: 0 }] : [],
        text,
        duration: segments.length > 0 ? segments[segments.length - 1].end : 0,
        language,
        provider: 'transformers',
        hasSpeakerDiarization: false,
      };
      return result;
    } catch (e) {
      console.error('[useBrowserSTT] 변환 실패:', e);
      setError(e instanceof Error ? e.message : '브라우저 음성 변환에 실패했습니다.');
      return null;
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  return { isTranscribing, progress, error, transcribeBlob };
}

// Blob(오디오 파일/녹음) → 16kHz mono Float32Array
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('AudioContext를 지원하지 않는 브라우저입니다.');
  const ctx = new AudioCtx({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    // mono 변환 (채널 평균)
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.getChannelData(1);
    const mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
    return mono;
  } finally {
    await ctx.close();
  }
}
