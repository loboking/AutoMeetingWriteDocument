// STT(음성→텍스트) 추상화 타입.
// 입력 3종(실시간 녹음/녹음파일/텍스트)을 단일 TranscriptSegment[]로 수렴시키고,
// provider(Whisper API / transformers.js / Web Speech)를 갈아끼울 수 있게 한다.
// 화자분리는 MVP에서 OFF(speaker='Unknown') — 스키마만 미리 도입.

export type STTProviderName = 'whisper-api' | 'transformers' | 'web-speech' | 'dummy';

// 발화 한 토막. 화자분리 미지원 시 speaker='Unknown'.
export interface TranscriptSegment {
  speaker: string; // 화자 라벨. 미분리 시 'Unknown'. 빈 문자열 금지
  text: string; // 발화 내용
  start: number; // 시작(초), >= 0
  end: number; // 종료(초), > start (정보 없으면 start와 동일 허용)
  confidence?: number; // 0~1
  isEstimated?: boolean; // GLM 화자 추정(P1) 결과면 true
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  text: string; // segments를 평탄화한 전체 텍스트 (기존 코드 호환용)
  duration: number; // 전체 길이(초)
  language: string;
  provider: STTProviderName;
  hasSpeakerDiarization: boolean; // MVP=false
}

export interface STTTranscribeOptions {
  language?: string; // 'ko' 등
  detectSpeaker?: boolean; // MVP=무시(항상 false 동작)
}

// 서버측 STT provider 인터페이스 (Buffer 입력 — Whisper API, dummy).
// 브라우저 전용(transformers.js / Web Speech)은 별도 훅으로 분리.
export interface STTProvider {
  name: STTProviderName;
  isAvailable(): boolean; // env 기반 동기 판정
  transcribe(audio: Buffer, opts?: STTTranscribeOptions): Promise<TranscriptionResult>;
}

// STT provider 부재 시 던지는 에러 코드
export const NO_STT_PROVIDER = 'NO_STT_PROVIDER';
