'use client';

import { useMemo } from 'react';

interface ScreenNode {
  id: string;
  name: string;
  children?: ScreenNode[];
  description?: string;
  type?: 'screen' | 'group' | 'feature';
}

interface ScreenDiagramProps {
  content: string;
  type?: 'ia' | 'wireframe' | 'storyboard';
}

// 마크다운에서 화면 정보 파싱
function parseScreenInfo(content: string, type: string): { nodes: ScreenNode[], title: string } {
  const lines = content.split('\n');
  const nodes: ScreenNode[] = [];
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : (type === 'ia' ? '정보구조도' : type === 'wireframe' ? '화면 구성도' : '스토리보드');

  // 화면 목록 테이블 파싱
  const tableMatch = content.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|[^|]*\|[\s\S]+?\n\n/);
  if (tableMatch) {
    const tableLines = tableMatch[0].split('\n').slice(2); // 헤더와 구분선 스킵
    for (const line of tableLines) {
      const cells = line.split('|').filter(c => c.trim());
      if (cells.length >= 2) {
        const id = cells[0].trim();
        const name = cells[1].trim();
        if (id && name && id.match(/^S-\d+$/)) {
          nodes.push({ id, name, type: 'screen' });
        }
      }
    }
  }

  // 화면별 상세 기획 파싱 (S-001: 화면명 형식)
  const sectionRegex = /####\s+(S-\d+):\s+(.+?)\n([\s\S]+?)(?=####\s+S-\d+:|\n\n###|$)/g;
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const [, id, name, detail] = match;
    const existingNode = nodes.find(n => n.id === id);
    if (existingNode) {
      existingNode.description = detail.substring(0, 200);
    } else {
      nodes.push({ id, name, type: 'screen', description: detail.substring(0, 200) });
    }
  }

  // fallback: 텍스트에서 화면명 추출
  if (nodes.length === 0) {
    const screenMatches = content.matchAll(/(?:화면|페이지|screen)[:\s]+([^\n]+)/gi);
    const seenNames = new Set();
    for (const m of screenMatches) {
      const name = m[1].trim();
      if (name && !seenNames.has(name) && name.length < 50) {
        seenNames.add(name);
        nodes.push({ id: `S-${String(nodes.length + 1).padStart(3, '0')}`, name, type: 'screen' });
      }
    }
  }

  return { nodes, title };
}

export function ScreenDiagram({ content, type = 'ia' }: ScreenDiagramProps) {
  const { nodes, title } = useMemo(() => parseScreenInfo(content, type), [content, type]);

  if (nodes.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500 dark:text-slate-400">
        <p>화면 정보를 파싱할 수 없습니다.</p>
        <p className="text-sm mt-2">마크다운 형식을 확인해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg">
      <h3 className="text-xl font-bold mb-6 text-slate-900 dark:text-white flex items-center gap-2">
        <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
        {title}
      </h3>

      {/* 계층 구조 다이어그램 */}
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-950 rounded-lg p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <div className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-4">화면 구조도</div>
          <div className="flex flex-col gap-3">
            {/* 루트/홈 */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">H</div>
              <span className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium">홈</span>
            </div>

            {/* 연결선 */}
            <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 ml-4"></div>

            {/* 화면 그리드 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 ml-4">
              {nodes.map((node, idx) => (
                <div
                  key={node.id}
                  className="group relative p-3 bg-white dark:bg-slate-800 rounded-lg border-2 border-slate-200 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 transition-all cursor-pointer hover:shadow-md"
                  title={node.description}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{node.id}</span>
                    <div className="w-2 h-2 rounded-full bg-green-500" title="완료"></div>
                  </div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{node.name}</div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {idx + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 화면 목록 테이블 */}
        <div className="bg-white dark:bg-slate-950 rounded-lg overflow-hidden shadow-lg border border-slate-200 dark:border-slate-700">
          <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">화면 목록 ({nodes.length}개)</span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {nodes.map((node) => (
              <div key={node.id} className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="w-16 text-xs font-mono text-slate-500 dark:text-slate-400">{node.id}</div>
                <div className="flex-1">
                  <div className="font-medium text-slate-900 dark:text-white">{node.name}</div>
                  {node.description && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{node.description}</div>
                  )}
                </div>
                <div className="flex gap-1">
                  <span className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs" title="PC">🖥️</span>
                  <span className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs" title="Mobile">📱</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 스토리보드 시각화
interface StoryboardFrame {
  step: number;
  screen: string;
  description: string;
  action?: string;
  response?: string;
}

export function StoryboardViewer({ content }: { content: string }) {
  const frames = useMemo(() => {
    const lines = content.split('\n');
    const frames: StoryboardFrame[] = [];
    let currentFrame: Partial<StoryboardFrame> | null = null;

    for (const line of lines) {
      const stepMatch = line.match(/^\|\s*(\d+)\s*\|/);
      if (stepMatch) {
        if (currentFrame && currentFrame.screen) {
          frames.push(currentFrame as StoryboardFrame);
        }
        currentFrame = { step: parseInt(stepMatch[1]) };
      }

      if (currentFrame && line.includes('|')) {
        const cells = line.split('|').map(c => c.trim());
        if (cells.length >= 3 && currentFrame.screen === undefined) {
          currentFrame.screen = cells[2] || '';
          currentFrame.description = cells[3] || '';
          currentFrame.action = cells[4] || '';
          currentFrame.response = cells[5] || '';
        }
      }
    }

    if (currentFrame && currentFrame.screen) {
      frames.push(currentFrame as StoryboardFrame);
    }

    return frames;
  }, [content]);

  if (frames.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500 dark:text-slate-400">
        <p>스토리보드 정보를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg">
      <h3 className="text-xl font-bold mb-6 text-slate-900 dark:text-white flex items-center gap-2">
        <span className="w-3 h-3 bg-purple-500 rounded-full"></span>
        사용자 흐름 시각화
      </h3>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {frames.map((frame, idx) => (
          <div key={`frame-${frame.step}-${idx}`} className="flex-shrink-0 w-64">
            {/* 프레임 카드 */}
            <div className="bg-white dark:bg-slate-950 rounded-xl shadow-lg overflow-hidden border-2 border-slate-200 dark:border-slate-700">
              {/* 화면 영역 */}
              <div className="relative h-40 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center p-4">
                <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300">
                  {frame.step}
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-2 rounded-lg bg-white dark:bg-slate-900 shadow-md flex items-center justify-center text-2xl">
                    📱
                  </div>
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{frame.screen}</div>
                </div>
              </div>

              {/* 설명 영역 */}
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">설명</div>
                  <div className="text-sm text-slate-800 dark:text-slate-200">{frame.description}</div>
                </div>
                {frame.action && (
                  <div>
                    <div className="text-xs font-semibold text-blue-500 dark:text-blue-400 mb-1">사용자 행동</div>
                    <div className="text-sm text-slate-800 dark:text-slate-200">{frame.action}</div>
                  </div>
                )}
                {frame.response && (
                  <div>
                    <div className="text-xs font-semibold text-green-500 dark:text-green-400 mb-1">시스템 응답</div>
                    <div className="text-sm text-slate-800 dark:text-slate-200">{frame.response}</div>
                  </div>
                )}
              </div>

              {/* 연결 화살표 */}
              {idx < frames.length - 1 && (
                <div className="absolute -right-6 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600">
                  →
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
