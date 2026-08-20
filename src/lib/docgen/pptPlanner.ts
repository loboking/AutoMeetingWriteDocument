// SemanticSection[] → SlidePlan[]. PPT 밀도/분할 정책.
// 기존 buildPptxBlob의 라인 직역(헤더마다 슬라이드·#### 손실·밀도 불균형)을 대체.
// 한국어 밀도 = 단일 bullet 글자 상한(=슬라이드 예산) + 불릿 수. chunkBullet이 예산 단위로
// 청킹하고, 누적 예산 초과 시 분할 → 긴 단일 paragraph도 텅빈 과분할 없이 처리.
// LLM patch(요약/메시지 생성)는 후반. v1은 구조적 분할만.
import type { ContentBlock, ListItem, SemanticSection, SlidePlan, SourceRange } from './types';

// 한국어 PPT 가독 한계. 8.6인치 16pt ≈ 26자/줄.
// MAX_BULLET_CHARS(200)은 단일 bullet 상한(≈ 7줄) — 초과 시 청킹(400자 14줄 overflow 방지).
// SLIDE_CHAR_BUDGET(300)은 슬라이드 누적 목표 — 짧은 bullet 여러 개를 한 슬라이드에(과분할 방지).
export const MAX_BULLETS = 7;
export const MAX_BULLET_CHARS = 200;
export const SLIDE_CHAR_BUDGET = 300;
export const MAX_TABLE_ROWS = 12;       // 표 행(헤더 포함) 초과 시 다음 슬라이드로 행 분할
const MAX_CODE_LINES_PER_SLIDE = 28;    // 코드 슬라이드당 줄 — 초과 시 청킹(긴 코드 overflow 방지)

function extendRange(base: SourceRange, other: SourceRange): SourceRange {
  return {
    start: base.start.line === 0 ? other.start : base.start,
    end: other.end.line === 0 ? base.end : other.end,
  };
}

// 단일 bullet이 예산 초과 시 문장(. ! ? 。！？) → 어절(공백) → 글자 단위로 청킹.
// 불릿/번호/들여쓰기 접두('· '/'1. '/'  ')는 첫 청크에 보존 — 접두가 떨어져 첫 슬라이드가 비는 것 방지.
function chunkBullet(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const prefixMatch = s.match(/^(\s*(?:·|\d+\.)\s+)/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const body = prefix ? s.slice(prefix.length) : s;
  const bodyMax = Math.max(20, max - prefix.length);
  const out: string[] = [];
  for (const c of splitBy(body, /(?<=[.!?。！？])\s+/, bodyMax)) {
    out.push(...(c.length <= bodyMax ? [c] : splitBy(c, /\s+/, bodyMax)));
  }
  const final: string[] = [];
  for (const c of out) {
    if (c.length <= bodyMax) final.push(c);
    else for (let i = 0; i < c.length; i += bodyMax) final.push(c.slice(i, i + bodyMax));
  }
  const result = final.length ? final : [body];
  return result.map((c, i) => (i === 0 && prefix ? prefix + c : c));
}

// sep 기준 분할 후 max 단위로 병합(각 조각 ≤ max).
function splitBy(s: string, sep: RegExp, max: number): string[] {
  const tokens = s.split(sep).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const t of tokens) {
    if (cur && (cur + ' ' + t).length > max) {
      chunks.push(cur);
      cur = t;
    } else {
      cur = cur ? cur + ' ' + t : t;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ListItem[] → bullet 문자열[]. indent(들여쓰기) + ordered(번호)/unordered(·) + level별 번호 카운터.
// 상위 level로 돌아오면 하위 counter 리셋(형제 부모 사이 자식 ordered 번호 누적 방지).
export function itemsToLines(items: ListItem[] = []): string[] {
  const counters: Record<number, number> = {};
  const lines: string[] = [];
  for (const it of items) {
    if (!it.text.trim()) continue;
    const lv = it.level || 0;
    for (const k of Object.keys(counters)) {
      if (Number(k) > lv) delete counters[Number(k)];
    }
    const indent = '  '.repeat(lv);
    if (it.ordered) {
      counters[lv] = (counters[lv] || 0) + 1;
      lines.push(`${indent}${counters[lv]}. ${it.text}`);
    } else {
      counters[lv] = 0;
      lines.push(`${indent}· ${it.text}`);
    }
  }
  return lines;
}

// ContentBlock(텍스트계) → bullet 문자열 후보(청킹 전).
function blockToBullets(block: ContentBlock): string[] {
  if (block.type === 'list') return itemsToLines(block.items);
  if (block.type === 'thematicBreak') return ['———']; // 구분선 — PPT/Word에 시각 단절
  const text = (block.text ?? '').trim();
  if (!text) return [];
  if (block.type === 'quote') return [`"${text}"`];
  return [text];
}

export function planSlides(sections: SemanticSection[]): SlidePlan[] {
  const plans: SlidePlan[] = [];

  for (const section of sections) {
    const headingText = section.heading?.text.trim() ?? '';
    const isTitleCandidate =
      plans.length === 0 && !!section.heading && section.heading.level <= 2 && headingText;

    if (isTitleCandidate) {
      // 표지. 본문은 같은 headingText(문맥 보존 — 빈 ' ' title보다 나음).
      plans.push({
        kind: 'title',
        title: headingText,
        sourceRange: section.heading!.range,
        layoutHint: 'text',
      });
      plans.push(...planSectionBlocks(section, headingText, plans.length));
    } else {
      const title = headingText || (section.blocks.length > 0 ? '개요' : ' ');
      plans.push(...planSectionBlocks(section, title, plans.length));
    }
  }

  if (plans.length === 0) plans.push({ kind: 'title', title: '문서', layoutHint: 'text' });
  return plans;
}

function planSectionBlocks(
  section: SemanticSection,
  headingText: string,
  baseIndex: number
): SlidePlan[] {
  const out: SlidePlan[] = [];
  let textBuf: string[] = [];
  let textChars = 0;
  let textRange: SourceRange | null = null;
  let firstTextIdx = -1;
  let partSeq = 0;

  const flushText = () => {
    if (textBuf.length === 0) return;
    const isContinuation = firstTextIdx >= 0;
    out.push({
      kind: 'section',
      title: headingText || ' ',
      bullets: [...textBuf],
      continuationOf: isContinuation ? firstTextIdx : undefined,
      partIndex: partSeq,
      layoutHint: 'text',
      sourceRange: textRange ?? section.range,
    });
    if (firstTextIdx < 0) firstTextIdx = baseIndex + out.length - 1;
    partSeq++;
    textBuf = [];
    textChars = 0;
    textRange = null;
  };

  for (const block of section.blocks) {
    if (block.type === 'table' && block.rows && block.rows.length > 0) {
      flushText();
      out.push(...planTable(block, headingText, baseIndex + out.length));
      firstTextIdx = -1;
      partSeq = 0;
      continue;
    }
    if (block.type === 'code' || block.type === 'mermaid') {
      flushText();
      out.push(...planCode(block, headingText, baseIndex + out.length));
      firstTextIdx = -1;
      partSeq = 0;
      continue;
    }
    for (const raw of blockToBullets(block)) {
      for (const bullet of chunkBullet(raw, MAX_BULLET_CHARS)) {
        if (textBuf.length >= MAX_BULLETS || textChars + bullet.length > SLIDE_CHAR_BUDGET) {
          flushText();
        }
        textBuf.push(bullet);
        textChars += bullet.length;
        textRange = textRange ? extendRange(textRange, block.range) : block.range;
      }
    }
  }
  flushText();

  // heading-only section(blocks 없음): 제목만 슬라이드(level 3~6 손실 잔류 방지).
  if (out.length === 0 && (headingText.trim() || section.heading)) {
    out.push({
      kind: 'section',
      title: headingText || ' ',
      layoutHint: 'text',
      sourceRange: section.heading?.range ?? section.range,
    });
  }

  // text section 분할 체인에 partCount 채우기(렌더가 (i/N) 표시 가능). table/code와 대칭.
  fillPartCounts(out, baseIndex);
  return out;
}

// continuationOf 체인(같은 first 인덱스)을 묶어 partCount 부여.
function fillPartCounts(out: SlidePlan[], baseIndex: number): void {
  const chains = new Map<number, number[]>();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.kind !== 'section' || s.continuationOf === undefined) continue;
    const head = s.continuationOf;
    if (!chains.has(head)) chains.set(head, []);
    chains.get(head)!.push(i);
  }
  // 첫 section(continuationOf undefined)에 이어지는 체인만 partCount. head 인덱스 찾아 연속 수.
  // 단순 구현: continuationOf가 같은 그룹의 크기 = partCount, 그룹원 + 첫(head) 포함.
  const headsWithFirst = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.kind === 'section' && s.continuationOf !== undefined) headsWithFirst.add(s.continuationOf);
  }
  for (const head of headsWithFirst) {
    const headLocal = head - baseIndex;
    const members: number[] = [];
    if (headLocal >= 0 && headLocal < out.length && out[headLocal].kind === 'section') {
      members.push(headLocal);
    }
    const chain = chains.get(head) || [];
    members.push(...chain.filter((idx) => !members.includes(idx)));
    if (members.length > 1) {
      members.forEach((idx, ord) => {
        if (out[idx]?.kind === 'section') {
          out[idx].partCount = members.length;
          out[idx].partIndex = ord;
        }
      });
    }
  }
}

// 표 블록 → table 슬라이드(행 수 초과 시 다중 슬라이드 분할).
function planTable(block: ContentBlock, headingText: string, baseIndex: number): SlidePlan[] {
  const rows = block.rows ?? [];
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const chunkSize = Math.max(1, MAX_TABLE_ROWS - 1);
  if (body.length <= chunkSize) {
    return [
      {
        kind: 'table',
        title: headingText || ' ',
        table: { headers, rows: body },
        layoutHint: 'table',
        sourceRange: block.range,
      },
    ];
  }
  const totalParts = Math.ceil(body.length / chunkSize);
  const parts: SlidePlan[] = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    const partIdx = Math.floor(i / chunkSize);
    parts.push({
      kind: 'table',
      title: headingText || ' ',
      table: { headers, rows: body.slice(i, i + chunkSize) },
      continuationOf: partIdx > 0 ? baseIndex : undefined,
      partIndex: partIdx,
      partCount: totalParts,
      layoutHint: 'table',
      sourceRange: block.range,
      omissions:
        partIdx < totalParts - 1 ? [`표 ${body.length}행 분할 — ${partIdx + 1}/${totalParts}`] : undefined,
    });
  }
  return parts;
}

// 코드/mermaid 블록 → 슬라이드. mermaid는 1장(전체 다이어그램). 일반 코드는 줄 수로 청킹 분할.
function planCode(block: ContentBlock, headingText: string, baseIndex: number): SlidePlan[] {
  const code = block.code ?? '';
  if (!code.trim()) return [];
  const lang = block.type === 'mermaid' ? 'mermaid' : block.lang ?? 'text';

  if (block.type === 'mermaid') {
    return [
      {
        kind: 'image',
        title: headingText || ' ',
        codeBlock: { lang, code },
        layoutHint: 'image',
        sourceRange: block.range,
      },
    ];
  }
  const lines = code.split('\n');
  const note = ['코드 블록 — 발표자 노트 보강 예정'];
  if (lines.length <= MAX_CODE_LINES_PER_SLIDE) {
    return [
      {
        kind: 'image',
        title: headingText || ' ',
        codeBlock: { lang, code },
        layoutHint: 'image',
        sourceRange: block.range,
        omissions: note,
      },
    ];
  }
  const totalParts = Math.ceil(lines.length / MAX_CODE_LINES_PER_SLIDE);
  const parts: SlidePlan[] = [];
  for (let i = 0; i < lines.length; i += MAX_CODE_LINES_PER_SLIDE) {
    const partIdx = Math.floor(i / MAX_CODE_LINES_PER_SLIDE);
    parts.push({
      kind: 'image',
      title: headingText || ' ',
      codeBlock: { lang, code: lines.slice(i, i + MAX_CODE_LINES_PER_SLIDE).join('\n') },
      continuationOf: partIdx > 0 ? baseIndex : undefined,
      partIndex: partIdx,
      partCount: totalParts,
      layoutHint: 'image',
      sourceRange: block.range,
      omissions: note,
    });
  }
  return parts;
}
