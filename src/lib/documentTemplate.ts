import { groupSemanticSections } from './docgen/semanticSection';
import { parseInlineRuns } from './docgen/inlineRuns';

/** Download-only presentation. Never modifies the source document. */
export interface DocumentExportOptions {
  title?: string;
  projectTitle?: string;
}
export const DOCUMENT_TEMPLATE = {
  font: 'Apple SD Gothic Neo', ink: '202A35', heading: '000000',
  accent: '263F59', muted: '657386', border: 'D9D9D9', stripe: 'F4F7FA',
  pageWidth: 11906, pageHeight: 16838, margin: 1134, // A4, 20 mm
} as const;
export const escapeDocumentHtml = (text: string) => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function documentOutline(content: string, options: DocumentExportOptions = {}) {
  const headings = groupSemanticSections(content).flatMap(section => section.heading ? [section.heading] : []);
  const plain = (text: string) => parseInlineRuns(text).map(run => run.text).join('');
  return {
    title: options.title || plain(headings[0]?.text || '문서'),
    projectTitle: options.projectTitle,
    entries: headings.filter(h => h.level <= 2).map(h => ({ text: plain(h.text), level: h.level })),
  };
}

export const DOCUMENT_TEMPLATE_CSS = `
  .document-export { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'NanumGothic', sans-serif;
    font-size: 10.5pt; line-height: 1.7; color: #202A35; overflow-wrap: anywhere; }
  .document-export * { box-sizing: border-box; }
  .document-export h1, .document-export h2, .document-export h3,
  .document-export h4, .document-export h5, .document-export h6 { color: #000; break-after: avoid; line-height: 1.35; }
  .document-export h1 { font-size: 22pt; margin: 28pt 0 12pt; }
  .document-export h2 { font-size: 16pt; margin: 24pt 0 10pt; }
  .document-export h3 { font-size: 12.5pt; margin: 18pt 0 8pt; }
  .document-export h4, .document-export h5, .document-export h6 { font-size: 11pt; margin: 14pt 0 6pt; }
  .document-export p { margin: 0 0 8pt; orphans: 3; widows: 3; white-space: pre-line; }
  .document-export ul, .document-export ol { margin: 6pt 0 10pt; padding-left: 20pt; }
  .document-export li { margin: 3pt 0; }
  .document-export table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 12pt 0 16pt; font-size: 9pt; }
  .document-export th, .document-export td { border: 1px solid #D9D9D9; padding: 7pt 8pt; text-align: left; vertical-align: middle; white-space: pre-line; }
  .document-export th { background: #263F59; color: white; font-weight: 600; }
  .document-export tbody tr:nth-child(even) { background: #F4F7FA; }
  .document-export thead { display: table-header-group; }
  .document-export tr { break-inside: avoid; }
  .document-export pre { background: #F4F7FA; border: 1px solid #D9D9D9; padding: 10pt; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9pt; }
  .document-export code { font-family: Consolas, Menlo, monospace; background: #F4F7FA; }
  .document-export blockquote { margin: 10pt 0; padding: 6pt 12pt; border-left: 3px solid #263F59; }
  .document-export hr { border: 0; border-top: 1px solid #D9D9D9; margin: 16pt 0; }
  .document-export .diagram { text-align: center; margin: 14pt 0; break-inside: avoid; }
  .document-export .diagram img { max-width: 100%; max-height: 220mm; object-fit: contain; }
  .document-export .document-cover { padding-top: 48mm; break-after: page; page-break-after: always; }
  .document-export .document-cover h1 { font-size: 32pt; margin: 0 0 18pt; line-height: 1.3; }
  .document-export .document-project { font-size: 15pt; color: #657386; }
  .document-export .document-toc { break-after: page; page-break-after: always; }
  .document-export .document-toc p { padding: 5pt 0; border-bottom: 1px solid #D9D9D9; }
  @page { size: A4; margin: 20mm; @bottom-center { content: counter(page); font-family: sans-serif; font-size: 9pt; color: #657386; } }
  @media print { body { margin: 0; } .document-export { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
`;

/** Give narrative columns more room without starving short identifiers. */
export function tableColumnWidths(rows: string[][]): number[] {
  const count = Math.max(0, ...rows.map(row => row.length));
  const weights = Array.from({ length: count }, (_, column) =>
    Math.max(6, Math.min(36, Math.max(...rows.map(row => (row[column] || '').length)))));
  const total = weights.reduce((sum, width) => sum + width, 0);
  return weights.map(width => width / total * 100);
}
