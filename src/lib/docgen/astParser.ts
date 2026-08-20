// Markdown → ContentBlock[] (remark mdast 기반).
// 기존 contentToHtml/exportFormatters의 정규식 직역을 대체하는 docgen 파이프 1단계.
// 마크다운을 줄 단위 정규식이 아니라 mdast를 순회해 의미 단위로 파싱 → sourceRange 보존.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, List } from 'mdast';
import type { ContentBlock, ListItem, SourceRange } from './types';

const processor = unified().use(remarkParse).use(remarkGfm);

interface PosPoint {
  line: number;
  column: number;
  offset?: number | null;
}
interface Pos {
  start: PosPoint;
  end: PosPoint;
}

function toRange(pos: Pos): SourceRange {
  return {
    start: { line: pos.start.line, column: pos.start.column, offset: pos.start.offset ?? undefined },
    end: { line: pos.end.line, column: pos.end.column, offset: pos.end.offset ?? undefined },
  };
}

// 인라인 노드를 텍스트로 추출하되 강조 마커(** * ` ~~), 줄바꿈(break), 이미지/링크 URL을 보존.
// 렌더 단(parseInlineRuns)이 마커를 bold/italic/code/strike 서식으로 복원.
interface InlineNode {
  type?: string;
  value?: string;
  children?: InlineNode[];
  url?: string;
  alt?: string;
}
function inlineText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as InlineNode;
  switch (n.type) {
    case 'text':
      return typeof n.value === 'string' ? n.value : '';
    case 'break':
      return '\n'; // 하드 브레이크(줄 끝 2스페이스) — 멀티라인 보존
    case 'strong':
      return '**' + (n.children || []).map(inlineText).join('') + '**';
    case 'emphasis':
      return '*' + (n.children || []).map(inlineText).join('') + '*';
    case 'delete':
      return '~~' + (n.children || []).map(inlineText).join('') + '~~';
    case 'inlineCode':
      return '`' + (typeof n.value === 'string' ? n.value : '') + '`';
    case 'image': {
      const alt = n.alt ?? '';
      const url = n.url ?? '';
      return url ? `![${alt}](${url})` : alt; // 이미지 — 최소 alt/url 보존(silent loss 방지)
    }
    case 'link': {
      const inner = (n.children || []).map(inlineText).join('');
      const url = n.url ?? '';
      return url && url !== inner ? `${inner} (${url})` : inner; // href 보존(외부 참조 소거 방지)
    }
    default:
      if (Array.isArray(n.children)) return n.children.map(inlineText).join('');
      return '';
  }
}

const EMPTY_RANGE: SourceRange = {
  start: { line: 0, column: 0 }, end: { line: 0, column: 0 },
};

// 중첩 리스트를 평탄 배열로. listItem.children = [paragraph, list?] 구조에서
// paragraph는 항목 텍스트, 자식 list는 level+1 재귀. loose list(항목 본문 여러 단락)는
// 공백으로 결합(단락이 \n 없이 붙는 시각 손상 방지).
function flattenListItems(list: List, level: number): ListItem[] {
  const out: ListItem[] = [];
  for (const li of list.children) {
    // GFM task list 체크박스 상태([ ]/[x]) 보존 — 손실 시 완료 여부 사라짐.
    const checkbox = typeof li.checked === 'boolean' ? (li.checked ? '[x] ' : '[ ] ') : '';
    const parts: string[] = [];
    let childList: List | null = null;
    for (const child of li.children) {
      if (child.type === 'list') childList = child;
      else {
        const t = inlineText(child);
        if (t) parts.push(t);
      }
    }
    const text = parts.join(' ').trim();
    if (text) out.push({ text: checkbox + text, level, ordered: !!list.ordered });
    if (childList) out.push(...flattenListItems(childList, level + 1));
  }
  return out;
}

// ragged table(행마다 셀 수 불일치)을 최대 열 수로 정규화 — 빈 셀 패딩으로 열 밀림 방지.
function normalizeTableRows(rawRows: string[][]): string[][] {
  const maxCols = rawRows.reduce((m, r) => Math.max(m, r.length), 0);
  return rawRows.map((r) => {
    const row = [...r];
    while (row.length < maxCols) row.push('');
    return row;
  });
}

// ponytail: mdast position이 없는 노드(드물)는 빈 range로 폴백. 파이프 중단보다 손실 없는 쪽.
export function parseMarkdownToBlocks(md: string): ContentBlock[] {
  const tree = processor.parse(md) as unknown as Root;
  const blocks: ContentBlock[] = [];

  for (const node of tree.children) {
    const range = node.position ? toRange(node.position) : EMPTY_RANGE;

    switch (node.type) {
      case 'heading':
        blocks.push({ type: 'heading', level: node.depth, text: inlineText(node), range });
        break;
      case 'paragraph':
        blocks.push({ type: 'paragraph', text: inlineText(node), range });
        break;
      case 'list':
        blocks.push({
          type: 'list',
          ordered: !!node.ordered,
          items: flattenListItems(node, 0),
          range,
        });
        break;
      case 'table': {
        const rawRows = node.children.map((row) =>
          row.children.map((cell) => inlineText(cell))
        );
        blocks.push({ type: 'table', rows: normalizeTableRows(rawRows), range });
        break;
      }
      case 'code':
        if (node.lang === 'mermaid') {
          blocks.push({ type: 'mermaid', code: node.value, range });
        } else {
          blocks.push({ type: 'code', lang: node.lang || '', code: node.value, range });
        }
        break;
      case 'blockquote': {
        const text = node.children.map((c) => inlineText(c)).join(' ').trim();
        blocks.push({ type: 'quote', text, range });
        break;
      }
      case 'thematicBreak':
        blocks.push({ type: 'thematicBreak', range });
        break;
      default:
        break;
    }
  }
  return blocks;
}
