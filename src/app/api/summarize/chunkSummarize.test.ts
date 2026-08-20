import { describe, it, expect } from 'vitest';
import {
  splitTranscript,
  mergeSummaries,
  needsChunking,
  CHUNK_CHAR_THRESHOLD,
} from './chunkSummarize';
import type { MeetingSummary } from '@/types';

describe('splitTranscript', () => {
  it('빈 입력은 빈 배열', () => {
    expect(splitTranscript('')).toEqual([]);
    expect(splitTranscript('   \n  ')).toEqual([]);
  });

  it('target 이하면 원본 1개(분할 없음)', () => {
    const text = '짧은 회의록입니다.';
    expect(splitTranscript(text)).toEqual([text]);
  });

  it('target 초과 시 문단(빈 줄) 기준으로 분할', () => {
    const para = 'x'.repeat(40);
    const text = [para, para, para, para].join('\n\n'); // 160자+, target=50
    const chunks = splitTranscript(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // 모든 청크가 target을 크게 넘지 않음(한 문단이 target 이하이므로).
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    // 내용 손실 없음: 합치면 원본과 동일(공백 정규화 제외).
    expect(chunks.join('\n\n').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('단일 문단이 target보다 길면 줄 단위로 쪼갠다', () => {
    const line = 'y'.repeat(20) + '\n';
    const text = line.repeat(10); // 한 문단, 200자, target=50
    const chunks = splitTranscript(text, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    expect(chunks.join('\n').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('분할해도 1개 청크밖에 안 나오면 원본 통째 반환', () => {
    const text = 'z'.repeat(60);
    expect(splitTranscript(text, 50)).toEqual([text]);
  });
});

describe('needsChunking', () => {
  it('임계치 초과 시 true', () => {
    expect(needsChunking('a'.repeat(CHUNK_CHAR_THRESHOLD + 1))).toBe(true);
  });
  it('임계치 이하 시 false', () => {
    expect(needsChunking('a'.repeat(100))).toBe(false);
  });
});

describe('mergeSummaries', () => {
  const base = (o: Partial<MeetingSummary>): MeetingSummary => ({
    overview: '',
    keyPoints: [],
    decisions: [],
    actionItems: [],
    ...o,
  });

  it('overview는 문단 구분자로 이어붙임', () => {
    const merged = mergeSummaries([
      base({ overview: '첫 구간 요약' }),
      base({ overview: '둘째 구간 요약' }),
    ]);
    expect(merged.overview).toBe('첫 구간 요약\n\n둘째 구간 요약');
  });

  it('keyPoints/decisions 중복(정규화) 제거, 순서 보존', () => {
    const merged = mergeSummaries([
      base({ keyPoints: ['안건 A', '안건  B'], decisions: ['결정1'] }),
      base({ keyPoints: ['안건 A', '안건 C'], decisions: ['결정 1'] }),
    ]);
    // '안건 A'/'안건  B'(공백) 중복 제거. '안건 C'는 유지.
    expect(merged.keyPoints).toEqual(['안건 A', '안건  B', '안건 C']);
    // '결정1'/'결정 1' 정규화 동일 → 1개.
    expect(merged.decisions).toEqual(['결정1']);
  });

  it('actionItems는 task 기준 중복 제거', () => {
    const merged = mergeSummaries([
      base({ actionItems: [{ task: '와이어프레임 작성' }, { task: 'DB 설계' }] }),
      base({ actionItems: [{ task: '와이어프레임  작성' }, { task: 'API 명세' }] }),
    ]);
    expect(merged.actionItems.map((a) => a.task)).toEqual([
      '와이어프레임 작성',
      'DB 설계',
      'API 명세',
    ]);
  });

  it('빈 청크 요약은 무시', () => {
    const merged = mergeSummaries([base({ overview: '정상' }), null as unknown as MeetingSummary]);
    expect(merged.overview).toBe('정상');
  });
});
