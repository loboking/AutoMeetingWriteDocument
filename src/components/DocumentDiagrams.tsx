'use client';
import { useMemo, useRef } from 'react';
import { extractAllMermaid } from '@/lib/mermaidSource';
import { extractMermaidCode } from '@/lib/documentUtils';
import { MermaidDiagram } from './MermaidDiagram';
interface Props {
  content: string;
  onZoom?: (title: string, code: string) => void;
  onError?: () => void;
  onSuccess?: () => void;
}
export function DocumentDiagrams(props: Props) {
  // A new source gets a fresh result set so an old response cannot hide a failed diagram.
  return <DiagramList key={props.content} {...props} />;
}
function DiagramList({ content, onZoom, onError, onSuccess }: Props) {
  const charts = useMemo(() => {
    const blocks = extractAllMermaid(content);
    return blocks.length ? blocks.map(block => block.code) : [extractMermaidCode(content)];
  }, [content]);
  const outcomes = useRef(new Map<number, boolean>());
  const done = (index: number, ok: boolean) => {
    outcomes.current.set(index, ok);
    if (!ok) onError?.();
    else if (outcomes.current.size === charts.length && [...outcomes.current.values()].every(Boolean)) onSuccess?.();
  };
  return <div className="space-y-6">{charts.map((chart, index) => <section key={index}>
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-sm font-medium">다이어그램 {index + 1}</h3>
      {onZoom && chart && <button type="button" className="text-sm text-blue-600" onClick={() => onZoom(`다이어그램 ${index + 1}`, chart)}>확대 보기</button>}
    </div>
    <MermaidDiagram chart={chart} onRenderError={() => done(index, false)} onRenderSuccess={() => done(index, true)} />
  </section>)}</div>;
}
