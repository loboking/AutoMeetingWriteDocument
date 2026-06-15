import { describe, it, expect } from 'vitest';
import {
  normalizeTranscript,
  segmentsToText,
  formatSegmentsForPrompt,
} from './transcriptUtils';
import type { TranscriptSegment, TranscriptionResult } from '@/lib/stt/types';

describe('normalizeTranscript', () => {
  it('string 입력은 단일 Unknown 세그먼트(start=0)로 변환한다', () => {
    const result = normalizeTranscript('안녕하세요 회의를 시작합니다');
    expect(result).toEqual([
      { speaker: 'Unknown', text: '안녕하세요 회의를 시작합니다', start: 0, end: 0 },
    ]);
  });

  it('string 양끝 공백을 trim하여 text에 담는다', () => {
    const result = normalizeTranscript('  회의 내용  ');
    expect(result).toEqual([
      { speaker: 'Unknown', text: '회의 내용', start: 0, end: 0 },
    ]);
  });

  it("빈 문자열('')은 빈 배열을 반환하고 throw하지 않는다", () => {
    expect(() => normalizeTranscript('')).not.toThrow();
    expect(normalizeTranscript('')).toEqual([]);
  });

  it("공백뿐인 문자열('  \\n ')은 빈 배열을 반환한다", () => {
    expect(normalizeTranscript('  \n ')).toEqual([]);
  });

  it('TranscriptSegment[]는 그대로 통과한다', () => {
    const segments: TranscriptSegment[] = [
      { speaker: '화자A', text: '첫 발화', start: 0, end: 1 },
      { speaker: '화자B', text: '두번째 발화', start: 1, end: 2 },
    ];
    expect(normalizeTranscript(segments)).toBe(segments);
  });

  it('빈 TranscriptSegment[]도 그대로 통과한다', () => {
    const segments: TranscriptSegment[] = [];
    expect(normalizeTranscript(segments)).toEqual([]);
  });

  it('TranscriptionResult는 segments를 추출한다', () => {
    const segments: TranscriptSegment[] = [
      { speaker: 'Unknown', text: '발화1', start: 0, end: 1 },
    ];
    const result: TranscriptionResult = {
      segments,
      text: '발화1',
      duration: 1,
      language: 'ko',
      provider: 'whisper-api',
      hasSpeakerDiarization: false,
    };
    expect(normalizeTranscript(result)).toBe(segments);
  });
});

describe('segmentsToText', () => {
  it('빈 배열은 빈 문자열을 반환한다', () => {
    expect(segmentsToText([])).toBe('');
  });

  it('모두 Unknown이면 화자 라벨 없이 text를 줄바꿈으로 연결한다', () => {
    const segments: TranscriptSegment[] = [
      { speaker: 'Unknown', text: '첫 줄', start: 0, end: 1 },
      { speaker: 'Unknown', text: '둘째 줄', start: 1, end: 2 },
    ];
    expect(segmentsToText(segments)).toBe('첫 줄\n둘째 줄');
  });

  it('화자가 다양하면 "화자: text" 형식으로 연결한다', () => {
    const segments: TranscriptSegment[] = [
      { speaker: '김기획', text: '안건을 시작합니다', start: 0, end: 1 },
      { speaker: '박개발', text: '동의합니다', start: 1, end: 2 },
    ];
    expect(segmentsToText(segments)).toBe(
      '김기획: 안건을 시작합니다\n박개발: 동의합니다'
    );
  });
});

describe('formatSegmentsForPrompt', () => {
  it('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(formatSegmentsForPrompt([])).toBe('');
  });

  it('화자가 있으면 "화자: ...", Unknown이면 text만 출력한다', () => {
    const segments: TranscriptSegment[] = [
      { speaker: '김기획', text: '안건1', start: 0, end: 1 },
      { speaker: 'Unknown', text: '잡음 섞인 발화', start: 1, end: 2 },
    ];
    expect(formatSegmentsForPrompt(segments)).toBe(
      '김기획: 안건1\n잡음 섞인 발화'
    );
  });
});
