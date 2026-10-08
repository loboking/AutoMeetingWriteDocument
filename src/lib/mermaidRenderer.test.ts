import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: api }));
import { renderMermaid } from './mermaidRenderer';
describe('화면과 다운로드의 Mermaid 설정 충돌 방지', () => {
 it('화면 렌더가 끝날 때까지 다운로드 초기화를 기다린다', async () => {
  let complete!: (value: { svg: string }) => void;
  api.initialize.mockClear();
  api.render.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValueOnce({ svg: '<svg />' });
  const screen = renderMermaid('flowchart TB\nA-->B');
  const download = renderMermaid('flowchart LR\nA-->B', 'export');
  await Promise.resolve();
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(api.initialize.mock.lastCall?.[0].flowchart.useMaxWidth).toBe(true);
  complete({ svg: '<svg />' });
  await screen;
  await download;
  expect(api.initialize).toHaveBeenCalledTimes(2);
  expect(api.initialize.mock.lastCall?.[0].flowchart.useMaxWidth).toBe(false);
 });
 it('하나의 문법 오류가 다음 다이어그램을 막지 않는다', async () => {
  api.render.mockRejectedValueOnce(new Error('문법 오류')).mockResolvedValueOnce({ svg: '<svg>정상</svg>' });
  await expect(renderMermaid('broken')).rejects.toThrow('문법 오류');
  await expect(renderMermaid('flowchart TB\nA-->B')).resolves.toMatchObject({ svg: '<svg>정상</svg>' });
 });
});
