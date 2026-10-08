'use client';
import mermaid from 'mermaid';
// Mermaid has global configuration; serialize initialize + render for screen and exports.
let pending: Promise<unknown> = Promise.resolve();
let sequence = 0;
export function renderMermaid(code: string, mode: 'screen' | 'export' = 'screen') {
  const task = pending.then(async () => {
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict',
      logLevel: 'fatal', htmlLabels: false,
      flowchart: { useMaxWidth: mode === 'screen', htmlLabels: false },
      themeVariables: { fontFamily: 'Apple SD Gothic Neo, Malgun Gothic, Arial, sans-serif' } });
    return mermaid.render(`document-diagram-${++sequence}`, code);
  });
  pending = task.catch(() => undefined);
  return task;
}
