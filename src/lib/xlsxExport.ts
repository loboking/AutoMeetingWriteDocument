import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { parseMarkdownToBlocks } from './docgen/astParser';
import { plainInlineText } from './docgen/inlineRuns';
import { itemsToLines } from './docgen/pptPlanner';
import { prerenderMermaid, lookupDiagram } from './mermaidExport';
import { DOCUMENT_TEMPLATE as THEME, escapeDocumentHtml as xml } from './documentTemplate';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const visualLength = (text: string) => [...text].reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 2 : 1), 0);

/** Native cells/tables, wrapped narrative, and diagram images. No AI or server calls. */
export async function buildXlsxBlob(content: string): Promise<Blob> {
  const blocks = parseMarkdownToBlocks(content);
  const diagrams = typeof window !== 'undefined' ? await prerenderMermaid(content) : undefined;
  const columns = Math.max(4, ...blocks.flatMap(b => (b.rows ?? []).map(row => row.length)));
  const widths = Array.from({ length: columns }, () => Math.max(18, Math.floor(120 / columns)));
  const data: string[][] = [];
  const styles: number[][] = [];
  const heights: { hpt: number }[] = [];
  const merges: XLSX.Range[] = [];
  const images: { row: number; dataUrl: string; w: number; h: number }[] = [];
  const add = (cells: string[], style: number, merge = false) => {
    const row = data.length;
    data.push(cells); styles.push(cells.map(() => style));
    const lineCount = Math.max(1, ...cells.map((cell, index) => cell.split('\n').reduce((count, line) =>
      count + Math.max(1, Math.ceil(visualLength(line) / Math.max(8, (merge ? widths.reduce((a, b) => a + b, 0) : widths[index]) - 2))), 0)));
    heights.push({ hpt: Math.min(409, Math.max(style === 1 ? 32 : 24, lineCount * 16 + 10)) });
    if (merge) merges.push({ s: { r: row, c: 0 }, e: { r: row, c: columns - 1 } });
  };
  const narrative = (text: string, style: number) => {
    // Excel caps row height. Split very long narrative without losing any characters.
    const chunks = text.match(/[\s\S]{1,1000}/g) ?? [''];
    chunks.forEach(chunk => add([chunk], style, true));
  };
  for (const block of blocks) {
    switch (block.type) {
      case 'heading': narrative(plainInlineText(block.text ?? ''), 1); break;
      case 'paragraph': case 'quote': narrative(plainInlineText(block.text ?? ''), 0); break;
      case 'list': itemsToLines(block.items).forEach(line => narrative(plainInlineText(line), 0)); break;
      case 'table':
        (block.rows ?? []).forEach((row, index) => add(row.map(plainInlineText), index === 0 ? 2 : index % 2 ? 3 : 4));
        break;
      case 'mermaid': {
        const diagram = diagrams ? lookupDiagram(diagrams, block.code ?? '') : null;
        if (diagram) {
          const scale = Math.min(760 / diagram.w, 700 / diagram.h, 1);
          const w = diagram.w * scale, h = diagram.h * scale;
          images.push({ row: data.length, dataUrl: diagram.dataUrl, w, h });
          for (let i = 0; i < Math.ceil((h + 20) / 32); i++) { data.push([]); styles.push([]); heights.push({ hpt: 24 }); }
        } else {
          narrative('다이어그램 원본', 1);
          (block.code ?? '').split('\n').forEach(line => narrative(line, 5));
        }
        break;
      }
      case 'code': (block.code ?? '').split('\n').forEach(line => narrative(line, 5)); break;
      case 'thematicBreak': break;
    }
    data.push([]); styles.push([]); heights.push({ hpt: 10 });
  }
  if (!data.length) add(['(내용 없음)'], 0, true);
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = widths.map(wch => ({ wch }));
  sheet['!rows'] = heights;
  sheet['!merges'] = merges;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Document');
  const zip = await JSZip.loadAsync(XLSX.write(book, { bookType: 'xlsx', type: 'array' }));
  // SheetJS CE does not write cell styles. Add standard OOXML styles to its package.
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}">
    <fonts count="4"><font><sz val="11"/><color rgb="FF${THEME.ink}"/><name val="맑은 고딕"/></font><font><b/><sz val="15"/><color rgb="FF${THEME.accent}"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><sz val="10"/><name val="Consolas"/></font></fonts>
    <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${THEME.accent}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${THEME.stripe}"/><bgColor indexed="64"/></patternFill></fill></fills>
    <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left','right','top','bottom'].map(side => `<${side} style="thin"><color rgb="FF${THEME.border}"/></${side}>`).join('')}<diagonal/></border></borders>
    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="6">${[[0,0,0],[1,3,0],[2,2,1],[0,0,1],[0,3,1],[3,3,0]].map(([font,fill,border]) => `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`).join('')}</cellXfs>
    <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  let sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  sheetXml = sheetXml.replace(/<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)>/g, (_match, attrs: string, ref: string) => {
    const cell = XLSX.utils.decode_cell(ref);
    return `<c${attrs.replace(/\s+s="\d+"/g, '')} s="${styles[cell.r]?.[cell.c] ?? 0}">`;
  });
  sheetXml = sheetXml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>');
  if (images.length) {
    const anchors: string[] = [];
    const rels: string[] = [];
    images.forEach((img, index) => {
      const id = index + 1;
      zip.file(`xl/media/image${id}.png`, img.dataUrl.split(',')[1], { base64: true });
      rels.push(`<Relationship Id="rId${id}" Type="${REL}/image" Target="../media/image${id}.png"/>`);
      anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${img.row}</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(img.w * 9525)}" cy="${Math.round(img.h * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(`다이어그램 ${id}`)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    });
    zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">${anchors.join('')}</xdr:wsDr>`);
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rIdDrawing"/></worksheet>');
    let types = await zip.file('[Content_Types].xml')!.async('string');
    if (!types.includes('Extension="png"')) types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
  }
  zip.file('xl/worksheets/sheet1.xml', sheetXml);
  return zip.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
}
