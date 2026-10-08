import type { MeetingSummary } from '@/types';
import { splitLocalSummaryInput } from './localSummaryContract';

/** No API fallback: only model files are downloaded; meeting text stays in the worker. */
export async function summarizeOnDevice(text: string, onProgress: (message: string) => void, signal?: AbortSignal): Promise<MeetingSummary> {
  splitLocalSummaryInput(text);
  if (signal?.aborted) throw new Error('기기 요약을 취소했습니다.');
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu || !await gpu.requestAdapter()) throw new Error('이 브라우저에서는 기기 요약을 지원하지 않습니다. API 요약을 선택해주세요.');
  if (signal?.aborted) throw new Error('기기 요약을 취소했습니다.');
  if (document.hidden) throw new Error('기기 요약은 화면을 열어 둔 상태에서 시작해주세요.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/localSummary.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, summary?: MeetingSummary) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      document.removeEventListener('visibilitychange', visibility);
      worker.terminate();
      if (error) reject(error); else resolve(summary!);
    };
    const abort = () => finish(new Error('기기 요약을 취소했습니다. 원문으로 다시 시도할 수 있습니다.'));
    const visibility = () => { if (document.hidden) finish(new Error('화면이 백그라운드로 전환되어 기기 요약을 중단했습니다. 원문으로 다시 시도해주세요.')); };
    const timeout = setTimeout(() => finish(new Error('기기 요약이 5분 안에 끝나지 않았습니다. 원문으로 다시 시도하거나 API 요약을 선택해주세요.')), 300_000);
    signal?.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', visibility);
    worker.onerror = () => finish(new Error('기기 AI를 실행하지 못했습니다. 브라우저와 메모리를 확인해주세요.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress(data.message);
      else if (data.type === 'error') finish(new Error(data.message));
      else if (data.type === 'complete') finish(undefined, data.summary);
    };
    onProgress('기기 AI 준비 중… 최초 실행 시 모델을 내려받습니다.');
    worker.postMessage({ text });
  });
}
