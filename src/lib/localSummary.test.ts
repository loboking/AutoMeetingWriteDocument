import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { summarizeOnDevice } from './localSummary';
let hidden = false;
let doc: EventTarget;
class TestWorker {
  static latest: TestWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { TestWorker.latest = this; }
}
beforeEach(() => {
  hidden = false;
  doc = new EventTarget();
  Object.defineProperty(doc, 'hidden', { get: () => hidden });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('unsupported browsers never fall back to paid API', async () => {
  vi.stubGlobal('navigator', {});
  await expect(summarizeOnDevice('회의', vi.fn())).rejects.toThrow('지원하지');
  expect(fetch).not.toHaveBeenCalled();
});
it('cancellation stops the worker without a paid fallback', async () => {
  const controller = new AbortController();
  const promise = summarizeOnDevice('보존할 원문', vi.fn(), controller.signal);
  await Promise.resolve();
  expect(TestWorker.latest.postMessage).toHaveBeenCalledWith({ text: '보존할 원문' });
  controller.abort();
  await expect(promise).rejects.toThrow('취소');
  expect(TestWorker.latest.terminate).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
it('backgrounding stops the worker and returns a retryable error', async () => {
  const promise = summarizeOnDevice('회의', vi.fn());
  await Promise.resolve();
  hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  await expect(promise).rejects.toThrow('백그라운드');
  expect(TestWorker.latest.terminate).toHaveBeenCalledTimes(1);
});
it('completion releases the worker and preserves the full structured result', async () => {
  const progress = vi.fn();
  const summary = { overview: '요약', keyPoints: ['논의'], decisions: [], actionItems: [{ task: '수정', assignee: '민수', deadline: '금요일' }] };
  const promise = summarizeOnDevice('회의', progress);
  await Promise.resolve();
  TestWorker.latest.onmessage?.({ data: { type: 'complete', summary } });
  await expect(promise).resolves.toEqual(summary);
  expect(TestWorker.latest.terminate).toHaveBeenCalledTimes(1);
});
