// 문서 내보내기 순수 변환 함수 모음.
// content: string만 받고 컴포넌트 state/props/hook을 읽지 않는 순수함수.
// handleDownload(state 읽음)는 PrdViewer에 남기고 build* 함수만 import해서 호출.

import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import {
  Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel,
  Table as DocxTable, TableRow, TableCell, WidthType, ShadingType,
} from 'docx';
import { prerenderMermaid, lookupDiagram, type PrerenderResult } from './mermaidExport';
import { groupSemanticSections, dropEmptySections } from './docgen/semanticSection';
import { planSlides, itemsToLines } from './docgen/pptPlanner';
import { parseInlineRuns } from './docgen/inlineRuns';
import type { SlidePlan } from './docgen/types';

// PDF 내보내기(html2pdf)용 스타일. 인쇄(handlePrint)와 동일 톤의 컬러 헤더/표 디자인.
export const PDF_EXPORT_CSS = `
  body, div { font-family: 'NanumGothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; line-height: 1.7; color: #333; }
  h1 { font-size: 24px; color: #1e3a8a; border-bottom: 3px solid #2563eb; padding-bottom: 6px; margin: 18px 0 12px; }
  h2 { font-size: 19px; color: #1e40af; border-left: 5px solid #2563eb; padding-left: 10px; margin: 16px 0 10px; }
  h3 { font-size: 16px; color: #1f2937; margin: 14px 0 8px; }
  h4, h5, h6 { font-size: 14px; color: #374151; margin: 12px 0 6px; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  p { margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; font-size: 13px; }
  th, tr:first-child td { background-color: #2563eb; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) { background-color: #f9fafb; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1f2937; color: #f9fafb; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: transparent; color: inherit; padding: 0; }
  blockquote { border-left: 4px solid #6b7280; padding-left: 12px; color: #6b7280; margin: 12px 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 18px 0; }
  .diagram { text-align: center; margin: 16px 0; }
  .diagram img { max-width: 100%; height: auto; }
`;

// 마크다운 → HTML (인쇄/PDF용). fence·표·리스트를 상태머신으로 묶어 깨짐 방지.
// diagrams: 사전 래스터화된 mermaid PNG 맵. mermaid 블록은 <img>로, 실패 시 코드로 폴백.
export function contentToHtml(content: string, diagrams?: PrerenderResult): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 인라인 마크다운 최소 변환 (이미 esc된 문자열에 적용)
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>');

  const lines = content.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBuf: string[] = [];
  let inList = false;
  let tableBuf: string[][] = [];

  const flushList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const flushTable = () => {
    if (tableBuf.length === 0) return;
    const rows = tableBuf
      .map((cells, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        return `<tr>${cells.map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join('')}</tr>`;
      })
      .join('');
    out.push(`<table>${rows}</table>`);
    tableBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // 코드펜스 토글
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLang = trimmed.slice(3).trim().toLowerCase();
        fenceBuf = [];
      } else {
        flushList();
        flushTable();
        if (fenceLang === 'mermaid') {
          const img = diagrams ? lookupDiagram(diagrams, fenceBuf.join('\n')) : null;
          out.push(
            img
              ? `<div class="diagram"><img src="${img.dataUrl}" alt="diagram" /></div>`
              : `<pre><code>${esc(fenceBuf.join('\n'))}</code></pre>`
          );
        } else {
          out.push(`<pre><code>${esc(fenceBuf.join('\n'))}</code></pre>`);
        }
        inFence = false;
        fenceLang = '';
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      continue;
    }

    // 표 누적
    if (trimmed.includes('|') && !trimmed.match(/^#/)) {
      if (trimmed.replace(/[|\s:-]/g, '') === '') continue; // 구분행 제외
      const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (cells.length > 0) {
        flushList();
        tableBuf.push(cells);
        continue;
      }
    } else if (tableBuf.length) {
      flushTable();
    }

    if (!trimmed) {
      flushList();
      continue;
    }

    // 헤더
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      flushList();
      const level = headerMatch[1].length;
      out.push(`<h${level}>${inline(headerMatch[2])}</h${level}>`);
      continue;
    }

    // 리스트 (ul 래핑)
    if (trimmed.match(/^[\-\*+]\s/) || trimmed.match(/^\d+\.\s/)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(trimmed.replace(/^[\-\*+\d.]+\s/, ''))}</li>`);
      continue;
    }
    flushList();

    // 수평선
    if (trimmed === '---' || trimmed === '***') {
      out.push('<hr>');
      continue;
    }
    // 인용문
    if (trimmed.startsWith('>')) {
      out.push(`<blockquote>${inline(trimmed.substring(1).trim())}</blockquote>`);
      continue;
    }
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  flushList();
  flushTable();
  return out.join('\n');
}

// Blob 생성(ZIP 묶기 + 개별 다운로드 공용). saveAs는 호출부에서.
// SemanticSection(docgen AST) 기반 → docx Table API로 진짜 표, 코드블록 모노스페이스 렌더.
// 기존 라인 직역은 표를 "a | b" 텍스트 한 줄로 평탄화하고 코드 내용을 평문으로 떨어뜨렸음(치명).
const DOCX_BRAND = '2563EB';

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
function richRuns(text: string): TextRun[] {
  return parseInlineRuns(text).map(
    (r) =>
      new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        strike: r.strike,
        font: r.code ? 'Consolas' : undefined,
      })
  );
}

// 마크다운 표(rows[][]) → docx Table. 헤더 행 브랜드 강조 + 본문 줄무늬.
function tableFromRows(rows: string[][]): DocxTable {
  const [header, ...body] = rows;
  const headerCells = (header ?? []).map(
    (c) =>
      new TableCell({
        shading: { fill: DOCX_BRAND, type: ShadingType.CLEAR, color: 'auto' },
        children: [
          new Paragraph({
            children: [new TextRun({ text: c.trim(), bold: true, color: 'FFFFFF' })],
          }),
        ],
      })
  );
  const headerRow = new TableRow({ tableHeader: true, children: headerCells });
  const bodyRows = body.map(
    (row, ri) =>
      new TableRow({
        children: row.map(
          (c) =>
            new TableCell({
              shading: ri % 2
                ? { fill: 'F3F4F6', type: ShadingType.CLEAR, color: 'auto' }
                : undefined,
              children: [new Paragraph({ children: richRuns(c.trim()) })],
            })
        ),
      })
  );
  return new DocxTable({
    rows: [headerRow, ...bodyRows],
    width: { size: 9000, type: WidthType.DXA }, // A4 본문 폭(twips) — PERCENTAGE size:100은 2%로 폭 붕괴
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
      children: [new TextRun({ text: ln || ' ', font: 'Consolas', color: 'F9FAFB' })],
      shading: { fill: '1F2937', type: ShadingType.CLEAR, color: 'auto' },
      spacing: { after: 0, line: 276 },
    })
  );
}

export async function buildDocxBlob(content: string): Promise<Blob> {
  const sections = dropEmptySections(groupSemanticSections(content));
  const children: Array<Paragraph | DocxTable> = [];

  for (const section of sections) {
    if (section.heading && section.heading.text.trim()) {
      children.push(
        new Paragraph({
          children: richRuns(section.heading.text),
          heading: docxHeadingLevel(section.heading.level),
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
              children: [new TextRun({ text: block.text ?? '', italics: true, color: '4B5563' })],
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
        case 'mermaid':
          children.push(...codeParagraphs(block.code ?? '', block.type === 'mermaid', block.lang));
          break;
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

  const doc = new DocxDocument({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBlob(doc);
}

export function buildXlsxBlob(content: string): Blob {
  // 마크다운을 파싱하여 테이블과 텍스트로 변환
  const lines = content.split('\n');
  const worksheetData: (string | { v: string; s: { font: { bold: boolean } } })[][] = [];

  lines.forEach(line => {
    // 헤더 처리 (# ## ###)
    if (line.startsWith('#')) {
      const text = line.replace(/^#+\s*/, '');
      worksheetData.push([{ v: text, s: { font: { bold: true } } }]);
      worksheetData.push([]); // 빈 줄
    }
    // 리스트 처리 (-, *, 1.)
    else if (line.match(/^[\-\*\+]\s/) || line.match(/^\d+\.\s/)) {
      worksheetData.push([{ v: line.trim().replace(/^[\-\*\+\d\.]\s/, '• '), s: { font: { bold: false } } }]);
    }
    // 테이블 처리 (|)
    else if (line.includes('|') && !line.match(/^#{1,6}\s/)) {
      const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (cells.length > 0) {
        worksheetData.push(cells.map(c => c.trim()));
      }
    }
    // 빈 줄
    else if (line.trim() === '') {
      worksheetData.push([]);
    }
    // 일반 텍스트
    else {
      worksheetData.push([line.trim()]);
    }
  });

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // 열 너비 자동 조정
  const colWidths = worksheetData.reduce((max: number[], row) => {
    row.forEach((cell, i) => {
      const len = String(cell).length;
      if (!max[i] || len > max[i]) max[i] = len;
    });
    return max;
  }, []);
  worksheet['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w, 15), 50) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Document');
  const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }); // ArrayBuffer
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// PPT 브랜드 색 — Word/docx와 동일 톤 유지.
const PPTX_BRAND = '2563EB';
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

  // 표 슬라이드. colW(열 균등분할) + autoPage(셀 텍스트 길 래핑 시 다음 슬라이드로)로 footer 넘침 방지.
  if (plan.kind === 'table' && plan.table) {
    const colCount = Math.max(1, plan.table.headers.length);
    const rows: PptxGenJS.TableRow[] = [
      plan.table.headers.map((h) => ({
        text: h,
        options: { bold: true, color: 'FFFFFF', fill: { color: PPTX_BRAND }, fontSize: 12 },
      })),
      ...plan.table.rows.map((r, ri) =>
        r.map((c) => ({
          text: c,
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
      colW: Array(colCount).fill(9 / colCount),
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
export async function buildPdfBlob(content: string): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default;
  const diagrams = await prerenderMermaid(content); // mermaid 사전 래스터화
  const el = document.createElement('div');
  el.innerHTML = `<style>${PDF_EXPORT_CSS}</style>` + contentToHtml(content, diagrams);
  el.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;'; // A4 px폭, 화면 밖
  document.body.appendChild(el);
  try {
    return await html2pdf()
      .set({
        margin: 10,
        html2canvas: { useCORS: true, scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(el)
      .outputPdf('blob');
  } finally {
    document.body.removeChild(el); // 누수 방지
  }
}
