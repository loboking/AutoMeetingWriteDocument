'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

// mermaid 초기화 (전역 한 번)
let mermaidInitialized = false;

export function MermaidDiagram({ chart, id = 'mermaid' }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mermaidInitialized) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          // 더 관대적인 설정
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
          },
          logLevel: 'fatal', // 에러만 표시
        });
        mermaidInitialized = true;
      } catch (e) {
        console.warn('Mermaid init warning:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (!ref.current || !chart.trim()) {
      return;
    }

    const trimmedChart = chart.trim();
    if (!trimmedChart) {
      if (ref.current) {
        ref.current.innerHTML = '<span class="text-slate-400 text-sm">빈 다이어그램</span>';
      }
      return;
    }

    // mermaid 키워드 확인 (더 관대하게)
    const mermaidPatterns = [
      /\bgraph\s+(?:TD|LR|RL)/i,
      /\bflowchart\s+(?:TD|LR|RL)/i,
      /\bsequenceDiagram\b/i,
      /\bclassDiagram\b/i,
      /\bstateDiagram\b/i,
      /\berDiagram\b/i,
      /\bgantt\b/i,
      /\bpie\b/i,
      /\bmindmap\b/i,
      /\bjourney\b/i,
      /\berDiagram\b/i,
      /\bc4model\b/i,
    ];

    const hasValidMermaid = mermaidPatterns.some(p => p.test(trimmedChart));

    if (!hasValidMermaid) {
      if (ref.current) {
        ref.current.innerHTML = `
          <div class="text-center p-4">
            <p class="text-amber-600 dark:text-amber-400 text-sm mb-2">유효한 Mermaid 다이어그램이 아닙니다</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">flowchart TD, sequenceDiagram 등 키워드가 필요합니다</p>
          </div>
        `;
      }
      return;
    }

    // 코드 정제 (불노이즈 제거, 빈 줄 제거)
    const lines = trimmedChart.split('\n').filter(line => line.trim());
    const cleanCode = lines.join('\n').trim();

    if (!cleanCode) {
      if (ref.current) {
        ref.current.innerHTML = '<span class="text-slate-400 text-sm">비어있음</span>';
      }
      return;
    }

    // 고유 ID 생성
    const uniqueId = `mermaid-${id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    mermaid
      .render(uniqueId, cleanCode)
      .then((result) => {
        if (ref.current) {
          ref.current.innerHTML = result.svg;
        }
      })
      .catch((err: Error | { message?: string; str?: string }) => {
        console.error('Mermaid render error:', err);
        const errorMsg = err?.message || (err as { str?: string })?.str || '렌더링 오류';
        setError(errorMsg);

        if (ref.current) {
          // 첫 200자만 표시
          const previewCode = cleanCode.length > 200
            ? cleanCode.substring(0, 200) + '...'
            : cleanCode;

          ref.current.innerHTML = `
            <div class="text-center p-4">
              <p class="text-red-600 dark:text-red-400 text-sm mb-2">⚠️ 다이어그램 렌더링 실패</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 mb-2">${errorMsg}</p>
              <details class="text-left">
                <summary class="cursor-pointer text-xs text-blue-600 dark:text-blue-400 hover:underline">원본 코드 보기</summary>
                <pre class="mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto"><code>${previewCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
              </details>
            </div>
          `;
        }
      });
  }, [chart, id]);

  return (
    <div className="mermaid-wrapper">
      <div
        ref={ref}
        className="flex items-center justify-center p-4 bg-white dark:bg-slate-800 rounded-lg overflow-auto"
        style={{ minHeight: '120px' }}
      />
    </div>
  );
}
