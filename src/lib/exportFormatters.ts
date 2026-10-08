// 문서 내보내기 순수 변환 함수 모음.
// content: string만 받고 컴포넌트 state/props/hook을 읽지 않는 순수함수.
// handleDownload(state 읽음)는 PrdViewer에 남기고 build* 함수만 import해서 호출.

export { buildXlsxBlob } from './xlsxExport';
import { parseMarkdownToBlocks } from './docgen/astParser';
import PptxGenJS from 'pptxgenjs';
import {
  Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel,
  Table as DocxTable, TableRow, TableCell, WidthType, ShadingType,
  Footer, Header, PageNumber, AlignmentType, BorderStyle, ImageRun, VerticalAlign,
} from 'docx';
import { prerenderMermaid, lookupDiagram, type PrerenderResult } from './mermaidExport';
import { groupSemanticSections, dropEmptySections } from './docgen/semanticSection';
import { planSlides, itemsToLines } from './docgen/pptPlanner';
import { parseInlineRuns, plainInlineText } from './docgen/inlineRuns';
import { DOCUMENT_TEMPLATE as THEME, DOCUMENT_TEMPLATE_CSS, documentOutline, escapeDocumentHtml, tableColumnWidths, type DocumentExportOptions } from './documentTemplate';
import type { SlidePlan } from './docgen/types';

// PDF 내보내기(html2pdf)용 스타일. 인쇄(handlePrint)와 동일 톤의 컬러 헤더/표 디자인.
export const PDF_EXPORT_CSS = DOCUMENT_TEMPLATE_CSS;

// 마크다운 → HTML (인쇄/PDF용). fence·표·리스트를 상태머신으로 묶어 깨짐 방지.
// diagrams: 사전 래스터화된 mermaid PNG 맵. mermaid 블록은 <img>로, 실패 시 코드로 폴백.
export function contentToHtml(content: string, diagrams?: PrerenderResult): string {
  const esc = escapeDocumentHtml;
  const inline = (text: string) => parseInlineRuns(text).map(run => {
    let html = esc(run.text).replace(/\n/g, '<br>');
    if (run.code) html = `<code>${html}</code>`;
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.italic) html = `<em>${html}</em>`;
    if (run.strike) html = `<del>${html}</del>`;
    return html;
  }).join('');
  return parseMarkdownToBlocks(content).map(block => {
    switch (block.type) {
      case 'heading': return `<h${block.level}>${inline(block.text ?? '')}</h${block.level}>`;
      case 'paragraph': return `<p>${inline(block.text ?? '')}</p>`;
      case 'quote': return `<blockquote>${inline(block.text ?? '')}</blockquote>`;
      case 'thematicBreak': return '<hr>';
      case 'list': {
        const items = block.items ?? [];
        let index = 0;
        const renderList = (level: number): string => {
          let html = '';
          while (index < items.length && items[index].level === level) {
            const ordered = !!items[index].ordered;
            const tag = ordered ? 'ol' : 'ul';
            html += ordered ? `<ol start="${items[index].ordinal ?? 1}">` : '<ul>';
            while (index < items.length && items[index].level === level && !!items[index].ordered === ordered) {
              const item = items[index++];
              const task = item.text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
              const text = task ? `${task[1].toLowerCase() === 'x' ? '☑' : '☐'} ${task[2]}` : item.text;
              html += task ? `<li style="list-style:none">${inline(text)}` : `<li>${inline(text)}`;
              if (index < items.length && items[index].level > level) html += renderList(items[index].level);
              html += '</li>';
            }
            html += `</${tag}>`;
          }
          return html;
        };
        return items.length ? renderList(items[0].level) : '';
      }
      case 'table': {
        const rows = block.rows ?? [];
        const columns = tableColumnWidths(rows).map(width => `<col style="width:${width}%">`).join('');
        const renderRow = (row: string[], tag: string) => `<tr>${row.map(cell => `<${tag}>${inline(cell)}</${tag}>`).join('')}</tr>`;
        return `<table><colgroup>${columns}</colgroup><thead>${renderRow(rows[0] ?? [], 'th')}</thead><tbody>${rows.slice(1).map(row => renderRow(row, 'td')).join('')}</tbody></table>`;
      }
      case 'mermaid': {
        const img = diagrams ? lookupDiagram(diagrams, block.code ?? '') : null;
        if (img) return `<div class="diagram"><img src="${img.dataUrl}" alt="diagram" /></div>`;
        return `<pre><code>${esc(block.code ?? '')}</code></pre>`;
      }
      case 'code': return `<pre><code>${esc(block.code ?? '')}</code></pre>`;
      default: return '';
    }
  }).join('\n');
}

/** Text downloads retain all words and code, but not markdown delimiters. */
export function contentToPlainText(content: string): string {
  return parseMarkdownToBlocks(content).map(block => {
    if (block.type === 'list') return itemsToLines(block.items).map(plainInlineText).join('\n');
    if (block.type === 'table') return (block.rows ?? []).map(row => row.map(plainInlineText).join('\t')).join('\n');
    if (block.type === 'code' || block.type === 'mermaid') return block.code ?? '';
    if (block.type === 'thematicBreak') return '────────────────';
    return plainInlineText(block.text ?? '');
  }).join('\n\n');
}

/** One template for print, individual PDF, and ZIP PDF exports. */
export function buildDocumentHtml(content: string, diagrams?: PrerenderResult, options: DocumentExportOptions = {}): string {
  const outline = documentOutline(content, options);
  const esc = escapeDocumentHtml;
  const toc = outline.entries.length > 1
    ? `<section class="document-toc"><h2>목차</h2>${outline.entries.map(h => `<p style="padding-left:${h.level === 2 ? 12 : 0}pt">${esc(h.text)}</p>`).join('')}</section>` : '';
  return `<article class="document-export"><section class="document-cover"><h1>${esc(outline.title)}</h1>${outline.projectTitle ? `<p class="document-project">${esc(outline.projectTitle)}</p>` : ''}</section>${toc}<main>${contentToHtml(content, diagrams)}</main></article>`;
}

// Blob 생성(ZIP 묶기 + 개별 다운로드 공용). saveAs는 호출부에서.
// SemanticSection(docgen AST) 기반 → docx Table API로 진짜 표, 코드블록 모노스페이스 렌더.
// 기존 라인 직역은 표를 "a | b" 텍스트 한 줄로 평탄화하고 코드 내용을 평문으로 떨어뜨렸음(치명).
const DOCX_BRAND = THEME.accent;

function docxHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    case 6: return HeadingLevel.HEADING_6;
    default: return HeadingLevel.HEADING_1;
  }
}

// 인라인 마커(**/`/*/~~)를 docx TextRun(bold/italic/strike/code 폰트)로 복원.
function richRuns(text: string, options: { color?: string; size?: number; bold?: boolean } = {}): TextRun[] {
  return parseInlineRuns(text).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        strike: r.strike,
        font: r.code ? 'Consolas' : undefined,
        ...options,
      })
  );
}

// 마크다운 표(rows[][]) → docx Table. 헤더 행 브랜드 강조 + 본문 줄무늬.
function tableFromRows(rows: string[][]): DocxTable {
  const [header, ...body] = rows;
  const widths = tableColumnWidths(rows).map(percent => Math.round((THEME.pageWidth - THEME.margin * 2) * percent / 100));
  const headerCells = (header ?? []).map(
    (c, column) =>
      new TableCell({
        width: { size: widths[column], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        shading: { fill: DOCX_BRAND, type: ShadingType.CLEAR, color: 'auto' },
        children: [
          new Paragraph({
            children: richRuns(c.trim(), { bold: true, color: 'FFFFFF', size: 18 }),
            spacing: { after: 0, line: 280 },
          }),
        ],
      })
  );
  const headerRow = new TableRow({ tableHeader: true, children: headerCells });
  const bodyRows = body.map(
    (row, ri) =>
      new TableRow({
        children: row.map(
          (c, column) =>
            new TableCell({
              width: { size: widths[column], type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              shading: ri % 2
                ? { fill: THEME.stripe, type: ShadingType.CLEAR, color: 'auto' }
                : undefined,
              children: [new Paragraph({ children: richRuns(c.trim(), { size: 18 }), spacing: { after: 0, line: 280 } })],
            })
        ),
      })
  );
  return new DocxTable({
    rows: [headerRow, ...bodyRows],
    columnWidths: widths,
    borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map(edge => [edge, { color: THEME.border, style: BorderStyle.SINGLE, size: 4 }])),
    width: { size: THEME.pageWidth - THEME.margin * 2, type: WidthType.DXA }, // A4 본문 폭(twips) — PERCENTAGE size:100은 2%로 폭 붕괴
  });
}

// 코드/mermaid 블록 → 검은 배경 모노스페이스 문단(줄별). mermaid는 소스를 코드로(이미지는 P1).
function codeParagraphs(code: string, isMermaid: boolean, lang?: string): Paragraph[] {
  if (!code.trim()) return []; // 빈 코드펜스 → 빈 검은 상자 방지.
  const lines = code.split('\n');
  if (isMermaid) {
    lines.unshift('mermaid 다이어그램 원본 소스:');
  } else if (lang && lang !== 'text') {
    lines.unshift(`${lang}:`);
  }
  return lines.map((ln) =>
    new Paragraph({
      children: [new TextRun({ text: ln || ' ', font: 'Consolas', color: THEME.ink, size: 18 })],
      shading: { fill: THEME.stripe, type: ShadingType.CLEAR, color: 'auto' },
      spacing: { after: 0, line: 276 },
    })
  );
}

export async function buildDocxBlob(content: string, options: DocumentExportOptions = {}): Promise<Blob> {
  const sections = dropEmptySections(groupSemanticSections(content));
  const outline = documentOutline(content, options);
  const diagrams = typeof window !== 'undefined' ? await prerenderMermaid(content) : undefined;
  const children: Array<Paragraph | DocxTable> = [];

  for (const section of sections) {
    if (section.heading && section.heading.text.trim()) {
      children.push(
        new Paragraph({
          children: richRuns(section.heading.text),
          heading: docxHeadingLevel(section.heading.level),
          keepNext: true,
          spacing: { before: 240, after: 100 },
        })
      );
    }
    for (const block of section.blocks) {
      switch (block.type) {
        case 'heading':
          children.push(
            new Paragraph({
              children: richRuns(block.text ?? ''),
              heading: docxHeadingLevel(block.level ?? 4),
              spacing: { before: 160, after: 80 },
            })
          );
          break;
        case 'paragraph':
          children.push(new Paragraph({ children: richRuns(block.text ?? ''), spacing: { after: 100 } }));
          break;
        case 'quote':
          children.push(
            new Paragraph({
              children: richRuns(block.text ?? '', { color: '4B5563' }),
              indent: { left: 360 },
              spacing: { after: 100 },
            })
          );
          break;
        case 'list':
          for (const line of itemsToLines(block.items)) {
            children.push(new Paragraph({ children: richRuns(line), spacing: { after: 40 } }));
          }
          break;
        case 'table':
          if (block.rows && block.rows.length > 0) children.push(tableFromRows(block.rows));
          break;
        case 'code':
        case 'mermaid': {
          const diagram = block.type === 'mermaid' && diagrams ? lookupDiagram(diagrams, block.code ?? '') : null;
          if (diagram) {
            const scale = Math.min(640 / diagram.w, 780 / diagram.h, 1);
            children.push(new Paragraph({ alignment: AlignmentType.CENTER,
              children: [new ImageRun({ type: 'png', data: Uint8Array.from(atob(diagram.dataUrl.split(',')[1]), c => c.charCodeAt(0)),
                transformation: { width: diagram.w * scale, height: diagram.h * scale } })], spacing: { before: 160, after: 160 } }));
          } else children.push(...codeParagraphs(block.code ?? '', block.type === 'mermaid', block.lang));
          break;
        }
        case 'thematicBreak':
          children.push(
            new Paragraph({
              text: '',
              border: { bottom: { color: 'E5E7EB', space: 1, style: 'single', size: 6 } },
              spacing: { before: 120, after: 120 },
            })
          );
          break;
        default:
          break;
      }
    }
  }

  // 빈 입력(heading도 block도 없음) → 빈 문서 대신 폴백.
  if (children.length === 0) {
    children.push(new Paragraph({ text: '(내용 없음)', heading: HeadingLevel.HEADING_1 }));
  }

  const cover = [new Paragraph({ text: outline.title, heading: HeadingLevel.TITLE, spacing: { before: 2700, after: 400 } }),
    ...(outline.projectTitle ? [new Paragraph({ children: [new TextRun({ text: outline.projectTitle, size: 30, color: THEME.muted })] })] : [])];
  if (outline.entries.length > 1) {
    cover.push(new Paragraph({ text: '목차', pageBreakBefore: true, spacing: { after: 300 }, children: undefined }));
    cover.push(...outline.entries.map(h => new Paragraph({ text: h.text, indent: { left: h.level === 2 ? 240 : 0 }, spacing: { after: 140 } })));
  }
  children.unshift(...cover, new Paragraph({ pageBreakBefore: true }));
  const heading = (size: number) => ({ run: { font: THEME.font, size, color: THEME.heading, bold: true }, paragraph: { keepNext: true, spacing: { before: 320, after: 160 } } });
  const doc = new DocxDocument({
    title: outline.title,
    styles: { default: {
      document: { run: { font: THEME.font, size: 21, color: THEME.ink }, paragraph: { spacing: { after: 140, line: 340 } } },
      title: heading(64), heading1: heading(44), heading2: heading(32), heading3: heading(25), heading4: heading(22), heading5: heading(22), heading6: heading(22),
    } },
    sections: [{ properties: { titlePage: true, page: { size: { width: THEME.pageWidth, height: THEME.pageHeight }, margin: { top: THEME.margin, bottom: THEME.margin, left: THEME.margin, right: THEME.margin } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: outline.title, color: THEME.heading, size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: THEME.muted })] })] }) },
      children }],
  });
  return Packer.toBlob(doc);
}

// PPT 브랜드 색 — Word/docx와 동일 톤 유지.
const PPTX_BRAND = THEME.accent;
const PPTX_INK = '1F2937';
const PPTX_SUB = '4B5563';

// SlidePlan 1장 → pptxgenjs 슬라이드 1장 렌더. planner가 이미 밀도/분할을 끝낸 상태.
function renderPptxSlide(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  plan: SlidePlan,
  diagrams: PrerenderResult
): void {
  // 표지: 브랜드 배경 + 중앙 대제목. 인라인 마커(**/code) run 복원.
  if (plan.kind === 'title') {
    slide.background = { color: PPTX_BRAND };
    slide.addText(
      parseInlineRuns(plan.title).map((r) => ({
        text: r.text,
        options: { bold: true, italic: r.italic, fontFace: r.code ? 'Courier New' : undefined },
      })),
      { x: 0.5, y: 2.6, w: 9, h: 1.8, fontSize: 40, align: 'center', color: 'FFFFFF' }
    );
    return;
  }
  // 섹션/표/이미지 공통: 상단 제목 + 컬러 언더라인. 분할 슬라이드는 (i/N) 접미.
  const partSuffix =
    plan.partCount && plan.partCount > 1 && plan.partIndex !== undefined
      ? ` (${plan.partIndex + 1}/${plan.partCount})`
      : '';
  slide.addText(
    parseInlineRuns(plan.title + partSuffix).map((r) => ({
      text: r.text,
      options: { bold: r.bold ?? true, italic: r.italic, fontFace: r.code ? 'Courier New' : undefined },
    })),
    { x: 0.5, y: 0.5, w: 9, h: 0.7, fontSize: 28, color: PPTX_INK }
  );
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 1.18, w: 3, h: 0.045, fill: { color: PPTX_BRAND },
  });

  const pptRuns = (text: string) => parseInlineRuns(text).map(run => ({ text: run.text, options: { bold: run.bold, italic: run.italic, strike: run.strike, fontFace: run.code ? 'Courier New' : undefined } }));

  // 표 슬라이드. colW(열 균등분할) + autoPage(셀 텍스트 길 래핑 시 다음 슬라이드로)로 footer 넘침 방지.
  if (plan.kind === 'table' && plan.table) {
    const widths = tableColumnWidths([plan.table.headers, ...plan.table.rows]);
    const rows: PptxGenJS.TableRow[] = [
      plan.table.headers.map((h) => ({
        text: pptRuns(h),
        options: { bold: true, color: 'FFFFFF', fill: { color: PPTX_BRAND }, fontSize: 12 },
      })),
      ...plan.table.rows.map((r, ri) =>
        r.map((c) => ({
          text: pptRuns(c),
          options: {
            color: PPTX_INK,
            fill: { color: ri % 2 ? 'F3F4F6' : 'FFFFFF' },
            fontSize: 11,
          },
        }))
      ),
    ];
    slide.addTable(rows, {
      x: 0.5, y: 1.5, w: 9,
      colW: widths.map(width => width * 9 / 100),
      autoPage: true, autoPageRepeatHeader: true,
      border: { type: 'solid', pt: 0.5, color: 'E5E7EB' }, valign: 'middle',
    });
    return;
  }

  // 이미지/코드 슬라이드. mermaid는 사전 래스터화 PNG, 실패 시 코드 폴백.
  if (plan.kind === 'image' && plan.codeBlock) {
    if (plan.codeBlock.lang === 'mermaid') {
      const img = lookupDiagram(diagrams, plan.codeBlock.code);
      if (img) {
        const dispW = Math.min(8.6, img.w / 96);
        const dispH = Math.min(dispW * (img.h / img.w), 4.6);
        slide.addImage({ data: img.dataUrl, x: (10 - dispW) / 2, y: 1.6, w: dispW, h: dispH });
        return;
      }
    }
    slide.addText(plan.codeBlock.code, {
      x: 0.8, y: 1.5, w: 8.4, h: 4.8, fontSize: 10, fontFace: 'Courier New',
      color: PPTX_SUB, valign: 'top',
    });
    return;
  }

  // 섹션(불릿). itemsToLines가 '· '/'N. ' 접두를 달고 있어 bullet:true 없이 문자열로 표현.
  // parseInlineRuns가 **/`/*/~~ 마커를 run별 bold/code/italic로 복원. fit:'shrink'는 overflow 안전망.
  if (plan.bullets && plan.bullets.length > 0) {
    const textRows: PptxGenJS.TextProps[] = [];
    for (const b of plan.bullets) {
      const runs = parseInlineRuns(b);
      if (runs.length === 0) continue;
      runs.forEach((r, i) => {
        textRows.push({
          text: r.text,
          options: {
            breakLine: i === runs.length - 1,
            bold: r.bold,
            italic: r.italic,
            strike: r.strike,
            fontSize: 16,
            color: PPTX_SUB,
            fontFace: r.code ? 'Courier New' : undefined,
            paraSpaceAfter: 8,
          },
        });
      });
    }
    slide.addText(textRows, { x: 0.7, y: 1.5, w: 8.6, h: 5.0, valign: 'top', fit: 'shrink' });
  }
}

export async function buildPptxBlob(content: string): Promise<Blob> {
  // mermaid 블록은 내보내기 전 PNG로 사전 래스터화(화면 SVG 재사용 불가).
  const diagrams = await prerenderMermaid(content);
  const sections = dropEmptySections(groupSemanticSections(content));
  const plans = planSlides(sections);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4', width: 10, height: 7.5 });
  pptx.layout = 'A4';

  // 브랜드 마스터: 상단 컬러바 + 푸터 + 페이지번호.
  pptx.defineSlideMaster({
    title: 'BRAND',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.16, fill: { color: PPTX_BRAND } } },
      { text: { text: 'MeetingAutoDocs', options: { x: 0.4, y: 7.05, w: 5, h: 0.3, fontSize: 9, color: '9CA3AF' } } },
    ],
    slideNumber: { x: 9.0, y: 7.05, w: 0.7, h: 0.3, fontSize: 9, color: '9CA3AF', align: 'right' },
  });

  for (const plan of plans) {
    const slide =
      plan.kind === 'title' ? pptx.addSlide() : pptx.addSlide({ masterName: 'BRAND' });
    renderPptxSlide(pptx, slide, plan, diagrams);
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

// PDF Blob 생성 (ZIP용). html2pdf로 HTML을 래스터화 → 시스템 한글 폰트 렌더.
// 단일 PDF 다운로드는 handlePrint(인쇄 다이얼로그)를 그대로 사용.
export async function buildPdfBlob(content: string, options: DocumentExportOptions = {}): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;
  const diagrams = await prerenderMermaid(content); // mermaid 사전 래스터화
  const el = document.createElement('div');
  el.innerHTML = `<style>${PDF_EXPORT_CSS}</style>` + buildDocumentHtml(content, diagrams, options);
  // html2pdf does not honor CSS break-after:avoid. Keep each heading with its first block.
  for (const heading of Array.from(el.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')).reverse()) {
    const next = heading.nextElementSibling;
    if (!next) continue;
    const group = document.createElement('div');
    group.className = 'document-heading-group';
    heading.before(group);
    group.append(heading, next);
  }
  el.style.cssText = 'width:642px;';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    const worker = html2pdf()
      .set({
        margin: [20, 20, 20, 20],
        ...{ pagebreak: { mode: ['css', 'legacy'], avoid: ['.document-heading-group', 'p', 'li', 'blockquote', 'pre', 'table', 'tr', '.diagram', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] } },
        html2canvas: { useCORS: true, scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(el).toPdf();
    const pdf = await worker.get('pdf');
    const pages = pdf.internal.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      pdf.setPage(page);
      pdf.setFontSize(9);
      pdf.setTextColor(101, 115, 134);
      pdf.text(String(page), 105, 287, { align: 'center' });
    }
    return pdf.output('blob');
  } finally {
    host.remove(); // 화면 밖 컨테이너까지 정리
  }
}
