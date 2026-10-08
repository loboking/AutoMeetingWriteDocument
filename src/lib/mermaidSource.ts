import { unified } from 'unified';
import remarkParse from 'remark-parse';
const parser = unified().use(remarkParse);
export function decodeMermaid(code: string): string {
  return code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** CommonMark fences: LF/CRLF, spaces, tildes and longer fences are supported. */
export function extractAllMermaid(content: string): { raw: string; code: string }[] {
  const tree = parser.parse(content);
  const blocks: { raw: string; code: string }[] = [];
  const visit = (node: typeof tree | (typeof tree.children)[number]): void => {
    if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid') {
      blocks.push({ raw: content.slice(node.position?.start.offset, node.position?.end.offset), code: decodeMermaid(node.value.trim()) });
    } else if ('children' in node) {
      for (const child of node.children) visit(child as (typeof tree.children)[number]);
    }
  };
  visit(tree);
  return blocks;
}
