import { describe, it, expect, vi, afterEach } from 'vitest';
import { RequestMemo } from './requestMemo';
import { withSharedTranscript, compactReferenceDocument } from './generationPrompt';
import { splitLocalSummaryInput, parseLocalSummary, validateLocalSummarySource } from './localSummaryContract';
const options = { valid: (x: string) => x !== 'partial', size: (x: string) => x.length };
afterEach(() => vi.useRealTimers());
describe('generation reuse', () => {
  it('reuses successes, separates keys and honors regeneration', async () => {
    const memo = new RequestMemo<string>();
    const task = vi.fn().mockResolvedValue('complete');
    await memo.run('user1', task, options);
    await memo.run('user1', task, options);
    expect(task).toHaveBeenCalledTimes(1);
    await memo.run('user2', task, options);
    await memo.run('user1', task, { ...options, force: true });
    expect(task).toHaveBeenCalledTimes(3);
  });
  it('does not retain partial responses or failures', async () => {
    const memo = new RequestMemo<string>();
    const task = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('partial').mockResolvedValue('complete');
    await expect(memo.run('x', task, options)).rejects.toThrow('network');
    expect(await memo.run('x', task, options)).toBe('partial');
    expect(await memo.run('x', task, options)).toBe('complete');
    expect(task).toHaveBeenCalledTimes(3);
  });
  it('joins pending calls and expires old results', async () => {
    vi.useFakeTimers();
    const memo = new RequestMemo<string>(100, 1000);
    const task = vi.fn(async () => 'result');
    await Promise.all([memo.run('x', task, options), memo.run('x', task, options)]);
    expect(task).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1001);
    await memo.run('x', task, options);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('does not reuse an older in-flight call on explicit regeneration', async () => {
    const memo = new RequestMemo<string>();
    let deliver!: (value: string) => void;
    const older = memo.run('x', () => new Promise(resolve => { deliver = resolve; }), options);
    expect(await memo.run('x', async () => 'new', { ...options, force: true })).toBe('new');
    deliver('old');
    await older;
    expect(await memo.run('x', async () => 'unexpected', options)).toBe('new');
  });
  it('bounds memory and isolates cancellable pending calls', async () => {
    const memo = new RequestMemo<string>(6);
    const task = vi.fn(async () => '1234');
    await memo.run('a', task, options);
    await memo.run('b', task, options);
    await memo.run('a', task, options);
    expect(task).toHaveBeenCalledTimes(3);
    await Promise.all([memo.run('c', task, { ...options, sharePending: false }), memo.run('c', task, { ...options, sharePending: false })]);
    expect(task).toHaveBeenCalledTimes(5);
  });
});
describe('lossless prompt preparation', () => {
  it('retains the complete original in a stable prefix across document types', () => {
    const source = '회의 원문\n담당 김철수 / 기한 10월 9일\n결정 번복: 보류';
    const a = withSharedTranscript(`기획서\n${source}\n작성`, source);
    const b = withSharedTranscript(`테스트 계획\n${source}`, source);
    expect(a.sharedContext).toBe(b.sharedContext);
    expect(a.sharedContext).toContain(source);
    expect(a.prompt).not.toContain(source);
    expect(withSharedTranscript('원문 미포함', source)).toEqual({ prompt: '원문 미포함' });
  });
  it('preserves code fences, hard breaks, tables and every nonblank line', () => {
    const original = '# 제목\n\n\n본문  \n| 열 |\n\n```mermaid\nA-->B\n\n\nB-->C\n```\n\n\n끝';
    const result = compactReferenceDocument(original);
    expect(result.split('\n').filter(s => s.trim())).toEqual(original.split('\n').filter(s => s.trim()));
    expect(result).toContain('A-->B\n\n\nB-->C');
    expect(result).toContain('본문  \n');
    expect(result.length).toBeLessThan(original.length);
  });
});
describe('local summary validation', () => {
  it('splits long paragraphs without losing any source characters', () => {
    const source = '가🙂'.repeat(2500);
    expect(splitLocalSummaryInput(source).join('')).toBe(source);
    expect(() => splitLocalSummaryInput('가'.repeat(10001))).toThrow('10,000');
  });
  it('retains owner, due date, and priority', () => {
    const value = { overview: '결정 요약', keyPoints: ['논의'], decisions: ['승인'], actionItems: [{ task: '출시', assignee: '김철수', deadline: '10월 9일', priority: 'high' }] };
    expect(parseLocalSummary('```json\n' + JSON.stringify(value) + '\n```')).toEqual(value);
  });
  it.each(['{"overview":', '{}', '{"overview":"요약","keyPoints":[],"decisions":[],"actionItems":[{"task":""}]}'])('rejects incomplete or malformed output %s', raw => {
    expect(() => parseLocalSummary(raw)).toThrow();
  });
});

it('rejects invented owners or deadlines from prompt examples', () => {
  const source = '유나: 디자인 개편은 보류합니다.';
  const summary = { overview: '보류', keyPoints: [], decisions: [], actionItems: [{ task: '디자인 개편', assignee: '유나', deadline: '11월 3일' }] };
  expect(() => validateLocalSummarySource(summary, source)).toThrow('원문에서 확인');
  expect(() => validateLocalSummarySource({ ...summary, actionItems: [{ task: '수정', assignee: '민수', deadline: '10월 16일' }] }, '민수: 10월16일까지 수정합니다.')).not.toThrow();
});
