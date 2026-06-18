import { describe, it, expect } from 'vitest';
import { routeInputFile } from './inputRouter';

describe('routeInputFile', () => {
  it('음성 확장자(.mp3/.wav/.webm/.m4a/.ogg)를 audio로 판정한다', () => {
    for (const ext of ['mp3', 'wav', 'webm', 'm4a', 'ogg']) {
      expect(routeInputFile({ name: `rec.${ext}`, type: '' })).toBe('audio');
    }
  });

  it('MIME이 audio/* 이면 확장자 없어도 audio다', () => {
    expect(routeInputFile({ name: 'blob', type: 'audio/webm' })).toBe('audio');
    expect(routeInputFile({ name: 'x', type: 'audio/mpeg' })).toBe('audio');
  });

  it('.txt/.md를 text로 판정한다', () => {
    expect(routeInputFile({ name: 'note.txt', type: '' })).toBe('text');
    expect(routeInputFile({ name: 'doc.md', type: '' })).toBe('text');
  });

  it('.pdf 및 application/pdf를 text로 판정한다', () => {
    expect(routeInputFile({ name: 'a.pdf', type: '' })).toBe('text');
    expect(routeInputFile({ name: 'noext', type: 'application/pdf' })).toBe('text');
    expect(routeInputFile({ name: 'a.txt', type: 'text/plain' })).toBe('text');
  });

  it('대소문자 무관하게 판정한다', () => {
    expect(routeInputFile({ name: 'REC.MP3', type: '' })).toBe('audio');
    expect(routeInputFile({ name: 'A.WebM', type: '' })).toBe('audio');
    expect(routeInputFile({ name: 'B.TXT', type: '' })).toBe('text');
  });

  it('.docx/.xlsx를 text로 판정한다 (확장자/MIME 모두)', () => {
    expect(routeInputFile({ name: 'spec.docx', type: '' })).toBe('text');
    expect(routeInputFile({ name: 'data.xlsx', type: '' })).toBe('text');
    expect(routeInputFile({
      name: 'noext',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe('text');
    expect(routeInputFile({
      name: 'noext',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toBe('text');
  });

  it('.pptx/.doc/.xls는 unsupported를 반환한다 (서버 미지원)', () => {
    expect(routeInputFile({ name: 'deck.pptx', type: '' })).toBe('unsupported');
    expect(routeInputFile({ name: 'old.doc', type: '' })).toBe('unsupported');
    expect(routeInputFile({ name: 'old.xls', type: '' })).toBe('unsupported');
    expect(routeInputFile({
      name: 'deck',
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })).toBe('unsupported');
  });

  it('미지원 형식(.exe/.zip)은 unsupported를 반환한다', () => {
    expect(routeInputFile({ name: 'x.exe', type: '' })).toBe('unsupported');
    expect(routeInputFile({ name: 'a.zip', type: 'application/zip' })).toBe('unsupported');
  });

  it('MIME(audio)와 텍스트 확장자가 충돌하면 MIME(audio)을 우선한다', () => {
    expect(routeInputFile({ name: 'weird.txt', type: 'audio/webm' })).toBe('audio');
  });

  it('빈 name/빈 type에도 throw하지 않고 unsupported를 반환한다', () => {
    expect(routeInputFile({ name: '', type: '' })).toBe('unsupported');
  });
});
