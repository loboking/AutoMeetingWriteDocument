import { describe, it, expect } from 'vitest';
import {
  isNoSttProviderResponse,
  decideBrowserSttStrategy,
  pickWhisperModel,
} from './browserSTT';

describe('isNoSttProviderResponse', () => {
  it('서버 503 NO_STT_PROVIDER 응답을 식별한다', () => {
    expect(isNoSttProviderResponse({ error: 'NO_STT_PROVIDER', fallbackOptions: ['browser-stt'] })).toBe(true);
  });
  it('일반 에러 응답은 false', () => {
    expect(isNoSttProviderResponse({ error: '음성 변환에 실패했습니다.' })).toBe(false);
  });
  it('null/undefined/빈 객체에도 throw하지 않고 false', () => {
    expect(isNoSttProviderResponse(null)).toBe(false);
    expect(isNoSttProviderResponse(undefined)).toBe(false);
    expect(isNoSttProviderResponse({})).toBe(false);
  });
});

describe('decideBrowserSttStrategy', () => {
  it('파일 입력 + transformers 지원이면 transformers를 쓴다 (Web Speech는 파일 불가)', () => {
    const s = decideBrowserSttStrategy({ source: 'file', transformersSupported: true, webSpeechSupported: true });
    expect(s).toBe('transformers');
  });
  it('파일 입력인데 transformers 미지원이면 unavailable (Web Speech는 파일 변환 불가)', () => {
    const s = decideBrowserSttStrategy({ source: 'file', transformersSupported: false, webSpeechSupported: true });
    expect(s).toBe('unavailable');
  });
  it('실시간 녹음이면 가벼운 Web Speech 우선', () => {
    const s = decideBrowserSttStrategy({ source: 'mic', transformersSupported: true, webSpeechSupported: true });
    expect(s).toBe('web-speech');
  });
  it('실시간 녹음 + Web Speech 미지원이면 transformers로', () => {
    const s = decideBrowserSttStrategy({ source: 'mic', transformersSupported: true, webSpeechSupported: false });
    expect(s).toBe('transformers');
  });
  it('둘 다 미지원이면 unavailable', () => {
    const s = decideBrowserSttStrategy({ source: 'mic', transformersSupported: false, webSpeechSupported: false });
    expect(s).toBe('unavailable');
  });
});

describe('pickWhisperModel', () => {
  it('기본은 한국어 정확도 우선 small 모델', () => {
    expect(pickWhisperModel('ko')).toContain('small');
  });
  it('영어는 더 가벼운 base 허용', () => {
    expect(pickWhisperModel('en')).toMatch(/base|small/);
  });
});
