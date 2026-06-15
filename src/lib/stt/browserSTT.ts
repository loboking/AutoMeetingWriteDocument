// 브라우저 무료 STT 결정 로직 (순수 함수 — 테스트 가능).
// 실제 transformers.js/Web Speech 호출은 useBrowserSTT 훅에서. 여기선 "무엇을 쓸지"만 결정.

export type BrowserSttStrategy = 'transformers' | 'web-speech' | 'unavailable';

// 서버 transcribe가 키 없어서 503 NO_STT_PROVIDER를 줬는지 판별 → 브라우저 STT로 폴백 신호
export function isNoSttProviderResponse(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  return (body as { error?: string }).error === 'NO_STT_PROVIDER';
}

export interface SttStrategyInput {
  source: 'mic' | 'file'; // 실시간 녹음 vs 녹음 파일
  transformersSupported: boolean; // transformers.js 로딩 가능(브라우저 WASM/WebGPU)
  webSpeechSupported: boolean; // window.SpeechRecognition 존재
}

export function decideBrowserSttStrategy(input: SttStrategyInput): BrowserSttStrategy {
  // 파일 변환은 Web Speech 불가(마이크 실시간 전용) → transformers만 가능
  if (input.source === 'file') {
    return input.transformersSupported ? 'transformers' : 'unavailable';
  }
  // 실시간 녹음: 가벼운 Web Speech 우선, 없으면 transformers
  if (input.webSpeechSupported) return 'web-speech';
  if (input.transformersSupported) return 'transformers';
  return 'unavailable';
}

// transformers.js용 Whisper 모델 선택. 검증된 Xenova 저장소 사용(q8 양자화 안정).
// 한국어는 정확도 위해 small(multilingual), 영어는 base.en.
export function pickWhisperModel(language: string): string {
  if (language === 'en') return 'Xenova/whisper-base.en';
  return 'Xenova/whisper-small'; // multilingual (한국어 포함)
}
