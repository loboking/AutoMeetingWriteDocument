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
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!mermaidInitialized) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          // 최소한의 설정만 사용
          flowchart: {
            useMaxWidth: true,
          },
        });
        mermaidInitialized = true;
      } catch (e) {
        console.warn('Mermaid init warning:', e);
      }
    }
  }, []);

  useEffect(() => {
    setError(null);
    setShowRaw(false);

    if (!ref.current || !chart.trim()) {
      return;
    }

    // 빈 텍스트 체크
    const trimmedChart = chart.trim();
    if (!trimmedChart) {
      if (ref.current) {
        ref.current.innerHTML = '<span class="text-slate-400">빈 다이어그램</span>';
      }
      return;
    }

    // mermaid 키워드 확인
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
    ];

    const hasValidMermaid = mermaidPatterns.some(p => p.test(trimmedChart));

    if (!hasValidMermaid) {
      if (ref.current) {
        ref.current.innerHTML = `
          <div class="text-center p-4">
            <p class="text-amber-600 dark:text-amber-400 text-sm mb-2">유효한 Mermaid 다이어그램이 아닙니다</p>
            <button
              onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'"
              class="text-xs text-blue-600 dark:text-blue-400 underline"
            >
              원본 텍스트 보기
            </button>
            <pre class="hidden mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs overflow-x-auto"><code>${trimmedChart.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
          </div>
        `;
      }
      return;
    }

    // 유효한 mermaid 코드만 추출 (이미 블록 제외된 코드라고 가정)
    const codeToRender = trimmedChart;

    // 고유 ID 생성
    const uniqueId = `mermaid-${id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    mermaid
      .render(uniqueId, codeToRender)
      .then((result) => {
        if (ref.current) {
          ref.current.innerHTML = `
            <div class="mermaid-container flex justify-center">
              ${result.svg}
            </div>
          `;
        }
      })
      .catch((err: any) => {
        console.error('Mermaid render error:', err);
        const errorMsg = err?.message || err?.str || '알 수 없는 오류';
        setError(errorMsg);

        if (ref.current) {
          ref.current.innerHTML = `
            <div class="text-center p-4">
              <p class="text-red-600 dark:text-red-400 text-sm mb-2">다이어그램 렌더링 실패</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 mb-2">${errorMsg}</p>
              <button
                onclick="this.nextElementSibling.classList.toggle('hidden')"
                class="text-xs text-blue-600 dark:text-blue-400 underline"
              >
                원본 코드 보기
              </button>
              <pre class="hidden mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded text-xs overflow-x-auto max-h-40"><code>${codeToRender.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
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
