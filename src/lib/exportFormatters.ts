// 문서 내보내기 순수 변환 함수 모음.
// content: string만 받고 컴포넌트 state/props/hook을 읽지 않는 순수함수.
// handleDownload(state 읽음)는 PrdViewer에 남기고 build* 함수만 import해서 호출.

import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { prerenderMermaid, lookupDiagram, type PrerenderResult } from './mermaidExport';

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
export async function buildDocxBlob(content: string): Promise<Blob> {
  // 마크다운을 파싱하여 Word 문서 생성
  const lines = content.split('\n');
  const paragraphs: Paragraph[] = [];

  lines.forEach(line => {
    const trimmed = line.trim();

    // 빈 줄
    if (!trimmed) {
      paragraphs.push(new Paragraph({ text: '' }));
      return;
    }

    // 헤더 처리 (# ## ### #### ##### ######)
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      let headingLevel: typeof HeadingLevel[keyof typeof HeadingLevel];

      switch (level) {
        case 1: headingLevel = HeadingLevel.HEADING_1; break;
        case 2: headingLevel = HeadingLevel.HEADING_2; break;
        case 3: headingLevel = HeadingLevel.HEADING_3; break;
        case 4: headingLevel = HeadingLevel.HEADING_4; break;
        case 5: headingLevel = HeadingLevel.HEADING_5; break;
        case 6: headingLevel = HeadingLevel.HEADING_6; break;
        default: headingLevel = HeadingLevel.HEADING_1;
      }

      paragraphs.push(new Paragraph({
        text: text,
        heading: headingLevel,
        spacing: { before: 200, after: 100 }
      }));
      return;
    }

    // 볼드 처리 (**text**)
    if (trimmed.includes('**')) {
      const parts = trimmed.split(/\*\*(.+?)\*\*/);
      const runs: TextRun[] = parts.map((part, i) =>
        i % 2 === 0 ? new TextRun(part) : new TextRun({ text: part, bold: true })
      );
      paragraphs.push(new Paragraph({ children: runs, spacing: { after: 100 } }));
      return;
    }

    // 리스트 처리 (-, *, +, 1.)
    const listMatch = trimmed.match(/^[\-\*\+]\s+(.+)$/);
    const numberMatch = trimmed.match(/^\d+\.\s+(.+)$/);

    if (listMatch || numberMatch) {
      const text = listMatch ? listMatch[1] : numberMatch![1];
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: '• ', bold: true }),
          new TextRun(text)
        ],
        indent: { left: 720 },
        spacing: { after: 50 }
      }));
      return;
    }

    // 테이블 처리 (|)
    if (trimmed.includes('|')) {
      const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
      // 간단한 테이블 처리 - 나중에 개선 가능
      if (cells.length > 1) {
        paragraphs.push(new Paragraph({
          text: cells.join(' | '),
          spacing: { after: 50 }
        }));
        return;
      }
    }

    // 코드 블록 처리 (```로 감싸진 부분)
    if (trimmed.startsWith('```')) {
      return; // 코드 블록 시작/종료 무시
    }

    // 일반 텍스트
    paragraphs.push(new Paragraph({
      text: trimmed,
      spacing: { after: 100 }
    }));
  });

  const doc = new DocxDocument({
    sections: [{
      properties: {},
      children: paragraphs
    }]
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

export async function buildPptxBlob(content: string): Promise<Blob> {
  // ★ 내보내기 전 mermaid 블록을 PNG로 사전 래스터화 (화면 SVG는 재사용 불가)
  const diagrams = await prerenderMermaid(content);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4', width: 10, height: 7.5 });
  pptx.layout = 'A4';

  const BRAND = '2563EB';
  const INK = '1F2937';
  const SUB = '4B5563';

  // 브랜드 마스터: 상단 컬러바 + 푸터 + 페이지번호
  pptx.defineSlideMaster({
    title: 'BRAND',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.16, fill: { color: BRAND } } },
      { text: { text: 'MeetingAutoDocs', options: { x: 0.4, y: 7.05, w: 5, h: 0.3, fontSize: 9, color: '9CA3AF' } } },
    ],
    slideNumber: { x: 9.0, y: 7.05, w: 0.7, h: 0.3, fontSize: 9, color: '9CA3AF', align: 'right' },
  });

  const lines = content.split('\n');

  // 제목 슬라이드 (브랜드 배경)
  const firstLine = lines.find((l) => l.match(/^#{1,6}\s/))?.replace(/^#+\s*/, '') || lines[0] || '문서';
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: BRAND };
  titleSlide.addText(firstLine, {
    x: 0.5, y: 2.6, w: 9, h: 1.8, fontSize: 40, bold: true, align: 'center', color: 'FFFFFF',
  });

  let currentSlide: PptxGenJS.Slide = pptx.addSlide({ masterName: 'BRAND' });
  let yPosition = 0.6;
  const newSlide = () => {
    currentSlide = pptx.addSlide({ masterName: 'BRAND' });
    yPosition = 0.6;
  };
  const ensureSpace = (need: number) => {
    if (yPosition + need > 6.9) newSlide();
  };

  // fence/table 상태머신
  let inFence = false;
  let fenceLang = '';
  let fenceBuf: string[] = [];
  let tableBuf: string[][] = [];

  const flushTable = () => {
    if (tableBuf.length === 0) return;
    ensureSpace(Math.min(0.4 * tableBuf.length + 0.3, 4));
    const rows = tableBuf.map((cells, ri) =>
      cells.map((c) => ({
        text: c.trim(),
        options:
          ri === 0
            ? { bold: true, color: 'FFFFFF', fill: { color: BRAND }, fontSize: 12 }
            : { color: INK, fill: { color: ri % 2 ? 'F3F4F6' : 'FFFFFF' }, fontSize: 11 },
      }))
    );
    currentSlide.addTable(rows as unknown as PptxGenJS.TableRow[], {
      x: 0.5, y: yPosition, w: 9, border: { type: 'solid', pt: 0.5, color: 'E5E7EB' },
      valign: 'middle',
    });
    yPosition += Math.min(0.42 * tableBuf.length + 0.3, 4);
    tableBuf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // ── 코드펜스 토글 ──
    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLang = trimmed.slice(3).trim().toLowerCase();
        fenceBuf = [];
      } else {
        flushTable();
        if (fenceLang === 'mermaid') {
          const img = lookupDiagram(diagrams, fenceBuf.join('\n'));
          if (img) {
            const dispW = Math.min(8.6, img.w / 96);
            const dispH = Math.min(dispW * (img.h / img.w), 4.6);
            ensureSpace(dispH + 0.3);
            currentSlide.addImage({ data: img.dataUrl, x: (10 - dispW) / 2, y: yPosition, w: dispW, h: dispH });
            yPosition += dispH + 0.3;
          } else if (fenceBuf.length) {
            // 폴백: 다이어그램 렌더 실패 → 코드 텍스트로
            ensureSpace(1.2);
            currentSlide.addText(fenceBuf.join('\n'), {
              x: 0.8, y: yPosition, w: 8.4, h: 1, fontSize: 10, fontFace: 'Courier New', color: SUB,
            });
            yPosition += 1.2;
          }
        } else if (fenceBuf.length) {
          ensureSpace(1.2);
          currentSlide.addText(fenceBuf.join('\n'), {
            x: 0.8, y: yPosition, w: 8.4, h: 1, fontSize: 10, fontFace: 'Courier New', color: SUB,
          });
          yPosition += 1.2;
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

    if (!trimmed) continue;

    // ── 표 누적 (연속 |행을 한 표로) ──
    if (trimmed.includes('|') && !trimmed.match(/^#/)) {
      if (trimmed.replace(/[|\s:-]/g, '') === '') continue; // 구분행 |---|---| 제외
      const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
      if (cells.length > 0) {
        tableBuf.push(cells);
        continue;
      }
    } else if (tableBuf.length) {
      flushTable();
    }

    // ── 헤더: 새 슬라이드 + 컬러 언더라인 ──
    const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      newSlide();
      const level = headerMatch[1].length;
      const fontSize = 32 - level * 5;
      currentSlide.addText(headerMatch[2], {
        x: 0.5, y: yPosition, w: 9, h: 0.7, fontSize, bold: true, color: INK,
      });
      currentSlide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: yPosition + 0.72, w: 3, h: 0.045, fill: { color: BRAND },
      });
      yPosition += 1.0;
      continue;
    }

    ensureSpace(0.5);

    // 리스트
    if (trimmed.match(/^[\-\*\+]\s/) || trimmed.match(/^\d+\.\s/)) {
      const text = trimmed.replace(/^[\-\*\+\d.]+\s/, '');
      currentSlide.addText(`• ${text}`, {
        x: 0.8, y: yPosition, w: 8.4, h: 0.4, fontSize: 16, color: SUB,
      });
      yPosition += 0.5;
    } else {
      currentSlide.addText(trimmed, {
        x: 0.7, y: yPosition, w: 8.6, h: 0.4, fontSize: 14, color: INK,
      });
      yPosition += 0.42;
    }
  }
  flushTable();

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
