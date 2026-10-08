'use client';
import { useEffect, useRef, useState } from 'react';
import { renderMermaid } from '@/lib/mermaidRenderer';
import { decodeMermaid } from '@/lib/mermaidSource';
interface MermaidDiagramProps {
  chart: string;
  id?: string;
  onRenderError?: (msg: string) => void;
  onRenderSuccess?: () => void;
}
export function MermaidDiagram({ chart, id = 'mermaid', onRenderError, onRenderSuccess }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onRenderError, onRenderSuccess });
  useEffect(() => { callbacks.current = { onRenderError, onRenderSuccess }; }, [onRenderError, onRenderSuccess]);
  useEffect(() => {
    let cancelled = false;
    if (ref.current) ref.current.replaceChildren();
    const code = decodeMermaid(chart.trim());
    const render = async () => {
      try {
        if (!code) throw new Error('표시할 다이어그램 코드가 없습니다. 문서 원문을 확인해주세요.');
        const result = await renderMermaid(code);
        if (cancelled) return;
        setError(null);
        if (ref.current) ref.current.innerHTML = result.svg;
        callbacks.current.onRenderSuccess?.();
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : '다이어그램 렌더링 오류';
        setError(message);
        callbacks.current.onRenderError?.(message);
      }
    };
    void render();
    return () => { cancelled = true; };
  }, [chart, id]);
  return <div className="mermaid-wrapper">
    <div ref={ref} className="flex items-center justify-center p-4 bg-white dark:bg-slate-800 rounded-lg overflow-auto" style={{ minHeight: error ? 0 : 120 }} />
    {error && <div role="alert" className="p-4 text-sm text-red-600">
      <p>다이어그램을 표시하지 못했습니다.</p>
      <details><summary>오류와 원본 코드 보기</summary><p>{error}</p><pre className="overflow-auto whitespace-pre-wrap">{chart}</pre></details>
    </div>}
  </div>;
}
