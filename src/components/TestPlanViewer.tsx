'use client';

import { useMemo } from 'react';

interface TestCase {
  id: string;
  name: string;
  type: string;
  priority: string;
  status: 'pending' | 'in-progress' | 'passed' | 'failed';
  description?: string;
}

interface TestPlanViewerProps {
  content: string;
}

function parseTestPlan(content: string): { testCases: TestCase[], summary: { total: number; passed: number; failed: number; pending: number } } {
  const lines = content.split('\n');
  const testCases: TestCase[] = [];
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
  };

  // 테이블에서 테스트 케이스 파싱
  const tableRegex = /\|[^|]+TC-[0-9]+[^|]*\|[\s\S]+?\n\n/g;
  let match;

  while ((match = tableRegex.exec(content)) !== null) {
    const tableContent = match[0];
    const tableLines = tableContent.split('\n').slice(2); // 헤더 스킵

    for (const line of tableLines) {
      if (line.includes('|')) {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length >= 2) {
          const idMatch = cells[0].match(/(TC-\d+)/);
          if (idMatch) {
            const testCase: TestCase = {
              id: idMatch[1],
              name: cells[1] || '',
              type: cells[2] || '기능',
              priority: cells[3] || 'P1',
              status: 'pending',
            };
            testCases.push(testCase);
            summary.total++;
          }
        }
      }
    }
  }

  // 텍스트에서 테스트 시나리오 추출 (fallback)
  if (testCases.length === 0) {
    const scenarioMatches = content.matchAll(/(?:테스트|Test)[:\s]+(.+?)(?:\n|시나리오|시나리오)/gi);
    let idx = 1;
    for (const m of scenarioMatches) {
      const name = m[1].trim();
      if (name && name.length > 2 && name.length < 100) {
        testCases.push({
          id: `TC-${String(idx++).padStart(3, '0')}`,
          name,
          type: '기능',
          priority: 'P1',
          status: 'pending',
        });
      }
    }
  }

  return { testCases, summary };
}

const statusColors = {
  'pending': 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'passed': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'failed': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const priorityColors = {
  'P0': 'bg-red-500',
  'P1': 'bg-orange-500',
  'P2': 'bg-yellow-500',
  'P3': 'bg-green-500',
};

export function TestPlanViewer({ content }: TestPlanViewerProps) {
  const { testCases, summary } = useMemo(() => parseTestPlan(content), [content]);

  if (testCases.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500 dark:text-slate-400">
        <p>테스트 케이스를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-lg space-y-6">
      {/* 헤더 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{summary.total}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">전체 케이스</div>
        </div>
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.passed}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">통과</div>
        </div>
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{summary.failed}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">실패</div>
        </div>
        <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">{summary.pending}</div>
          <div className="text-sm text-slate-600 dark:text-slate-400">대기</div>
        </div>
      </div>

      {/* 진행 상태 바 */}
      <div className="bg-white dark:bg-slate-950 rounded-lg p-4 shadow-md border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">테스트 진행률</span>
          <span className="text-sm text-slate-600 dark:text-slate-400">0%</span>
        </div>
        <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500" style={{ width: '0%' }}></div>
        </div>
      </div>

      {/* 테스트 케이스 리스트 */}
      <div className="bg-white dark:bg-slate-950 rounded-lg overflow-hidden shadow-lg border border-slate-200 dark:border-slate-700">
        <div className="px-4 py-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">테스트 케이스 목록</span>
        </div>
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {testCases.map((tc) => (
            <div key={tc.id} className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="flex-1 grid grid-cols-12 gap-4 items-center">
                <div className="col-span-2">
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{tc.id}</span>
                </div>
                <div className="col-span-5">
                  <div className="font-medium text-slate-900 dark:text-white">{tc.name}</div>
                </div>
                <div className="col-span-2">
                  <span className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">{tc.type}</span>
                </div>
                <div className="col-span-1">
                  <div className={`w-3 h-3 rounded-full ${priorityColors[tc.priority as keyof typeof priorityColors] || priorityColors.P1}`} title={tc.priority}></div>
                </div>
                <div className="col-span-2">
                  <span className={`text-xs px-2 py-1 rounded ${statusColors[tc.status]}`}>
                    {tc.status === 'pending' ? '대기' : tc.status === 'in-progress' ? '진행중' : tc.status === 'passed' ? '통과' : '실패'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
