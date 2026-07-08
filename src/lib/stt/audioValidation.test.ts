import { describe, it, expect } from 'vitest';
import { validateAudio, MAX_AUDIO_SIZE } from './audioValidation';

describe('validateAudio', () => {
  it('허용 형식 + 정상 크기는 ok:true', () => {
    expect(validateAudio({ name: 'a.mp3', type: 'audio/mpeg', size: 1_000_000 }).ok).toBe(true);
  });

  it('미지원 형식은 ok:false + error', () => {
    const r = validateAudio({ name: 'a.exe', type: '', size: 1000 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('0바이트(빈 파일)는 ok:false', () => {
    const r = validateAudio({ name: 'a.mp3', type: 'audio/mpeg', size: 0 });
    expect(r.ok).toBe(false);
  });

  it('50MB 초과는 ok:false이고 error에 크기 안내 포함', () => {
    const r = validateAudio({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_AUDIO_SIZE + 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MB/);
  });

});
