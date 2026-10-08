import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}
const parser = unified().use(remarkParse).use(remarkGfm);
interface InlineNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: InlineNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Nested emphasis, links and escapes use the same grammar as the document. */
export function parseInlineRuns(input: string): Run[] {
  if (!input) return [];
  const runs: Run[] = [];
  const visit = (node: InlineNode, style: Omit<Run, 'text'> = {}) => {
    const add = (text: string) => { if (text) runs.push({ text, ...style }); };
    switch (node.type) {
      case 'text': {
        const value = node.value ?? '';
        const raw = (prefix + input).slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
        const pattern = /\\[\s\S]|\*\*([^*\n]+)\*\*/g;
        const matches = [...raw.matchAll(pattern)].filter(match => match[1] !== undefined);
        if (matches.length) {
          const appendRaw = (part: string) => {
            // A suffix prevents the parser trimming meaningful spaces next to emphasis.
            const suffix = 'EXPORT_END';
            const parsed = parseInlineRuns(part + suffix);
            const last = parsed[parsed.length - 1];
            if (last?.text.endsWith(suffix)) last.text = last.text.slice(0, -suffix.length);
            runs.push(...parsed.filter(run => run.text).map(run => ({ ...style, ...run })));
          };
          let offset = 0;
          for (const match of matches) {
            if (match.index > offset) appendRaw(raw.slice(offset, match.index));
            runs.push({ text: match[1], ...style, bold: true });
            offset = match.index + match[0].length;
          }
          if (offset < raw.length) appendRaw(raw.slice(offset));
        } else add(value);
        return;
      }
      case 'inlineCode': runs.push({ text: node.value ?? '', ...style, code: true }); return;
      case 'break': add('\n'); return;
      case 'html': add(/^<br\s*\/?\s*>$/i.test(node.value ?? '') ? '\n' : node.value ?? ''); return;
      case 'strong': style = { ...style, bold: true }; break;
      case 'emphasis': style = { ...style, italic: true }; break;
      case 'delete': style = { ...style, strike: true }; break;
      case 'image': add(`${node.alt || '이미지'}${node.url ? ` (${node.url})` : ''}`); return;
      case 'link': {
        const start = runs.length;
        node.children?.forEach(child => visit(child, style));
        if (node.url && runs.slice(start).map(run => run.text).join('') !== node.url) add(` (${node.url})`);
        return;
      }
    }
    node.children?.forEach(child => visit(child, style));
  };
  // Prefix prevents leading numbering / # / > from becoming block syntax.
  const prefix = 'EXPORT_INLINE ';
  const tree = parser.parse(prefix + input) as unknown as InlineNode;
  tree.children?.forEach((node, index) => {
    if (index) runs.push({ text: '\n' });
    visit(node);
  });
  if (runs[0]?.text.startsWith(prefix)) runs[0].text = runs[0].text.slice(prefix.length);
  return runs.filter(run => run.text !== '');
}
export const plainInlineText = (text: string) => parseInlineRuns(text).map(run => run.text).join('');
