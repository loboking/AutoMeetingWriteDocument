'use client';

import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
  id?: string;
  onRenderError?: (msg: string) => void; // 렌더 실패 시 호출 (재생성 유도용)
  onRenderSuccess?: () => void;
}

// mermaid 초기화 (전역 한 번)
let mermaidInitialized = false;

export function MermaidDiagram({ chart, id = 'mermaid', onRenderError, onRenderSuccess }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  // 콜백을 ref로 안정화 → render effect의 deps에 넣지 않아도 최신 함수 사용(무한 렌더 방지).
  // ref 수정은 render 중이 아니라 effect에서(React 규칙 준수).
  const onErrorRef = useRef(onRenderError);
  const onSuccessRef = useRef(onRenderSuccess);
  useEffect(() => {
    onErrorRef.current = onRenderError;
    onSuccessRef.current = onRenderSuccess;
  }, [onRenderError, onRenderSuccess]);

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
    if (!ref.current || !chart?.trim()) {
      return;
    }

    const trimmedChart = chart.trim();
    if (!trimmedChart) {
      return; // 빈 차트는 조용히 무시
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
      // 유효하지 않은 mermaid 코드는 조용히 무시 (에러 메시지 제거)
      return;
    }

    // 코드 정제 (불노이즈 제거, 빈 줄 제거)
    let cleanCode = trimmedChart.split('\n').filter(line => line.trim()).join('\n').trim();

    // HTML 엔티티를 원래 기호로 변환 (안전장치)
    cleanCode = cleanCode.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/--&gt;/g, '-->');

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
        onSuccessRef.current?.();
      })
      .catch((err: Error | { message?: string; str?: string }) => {
        console.error('Mermaid render error:', err);
        const errorMsg = err?.message || (err as { str?: string })?.str || '렌더링 오류';
        onErrorRef.current?.(errorMsg);

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
