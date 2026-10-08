import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { buildDocxBlob, buildPptxBlob, buildXlsxBlob, contentToHtml, contentToPlainText } from './exportFormatters';
import { parseInlineRuns } from './docgen/inlineRuns';

const fixture = '# **검토 보고서**\n\n> **결정**과 _근거_\n\n- [x] **완료**\n- [ ] 검토\n\n3. 세 번째\n4. 네 번째\n\n| **항목** | 결과 |\n| --- | --- |\n| `API_KEY` | **정상** 및 ~~이전~~ |\n\n[근거](https://example.com)\n\n```js\nconst pattern = "**literal**";\n```';
const text = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map(m => m[1]).join(' ');

describe('다운로드 문법을 서식으로 변환', () => {
  it('인용 부호 뒤 한글 조사가 붙은 강조를 정리하되 이스케이프한 별표는 보존한다', () => {
    const source = '**“안내 문구”**가 표시됩니다. \\*리터럴\\*';
    expect(contentToHtml(source)).toContain('<strong>“안내 문구”</strong>가');
    expect(contentToPlainText(source)).toBe('“안내 문구”가 표시됩니다. *리터럴*');
  });
  it('중첩 강조와 밑줄 강조, 링크, 코드의 의미를 보존한다', () => {
    const runs = parseInlineRuns('**굵은 *강조***와 __볼드__ [참고](https://example.com) `a_b**c`');
    expect(runs.some(r => r.text === '강조' && r.bold && r.italic)).toBe(true);
    expect(runs.some(r => r.text === '볼드' && r.bold)).toBe(true);
    expect(runs.some(r => r.text === 'a_b**c' && r.code)).toBe(true);
    expect(runs.map(r => r.text).join('')).toContain('참고 (https://example.com)');
  });
  it('HTML과 TXT의 표·체크박스를 정리하고 코드 원문은 유지한다', () => {
    const html = contentToHtml(fixture);
    expect(html).toContain('<strong>정상</strong>');
    expect(html).toContain('<em>근거</em>');
    expect(html).toContain('<del>이전</del>');
    expect(html).toContain('☑');
    expect(html).toContain('☐');
    expect(html).not.toContain('[x]');
    expect(html).not.toContain('| ---');
    const plain = contentToPlainText(fixture);
    expect(plain).toContain('3. 세 번째');
    expect(plain).toContain('항목\t결과');
    expect(plain).toContain('const pattern = "**literal**";');
    expect(plain).not.toContain('**정상**');
  });
  it('Word 인용문과 PPT 표의 마커를 실제 강조 서식으로 바꾼다', async () => {
    const docx = await JSZip.loadAsync(await (await buildDocxBlob(fixture)).arrayBuffer());
    const word = await docx.file('word/document.xml')!.async('string');
    expect(text(word, 'w:t')).toContain('결정');
    expect(text(word, 'w:t')).not.toContain('**결정**');
    expect(text(word, 'w:t')).toContain('☑');
    const pptx = await JSZip.loadAsync(await (await buildPptxBlob(fixture)).arrayBuffer());
    const slides = (await Promise.all(Object.keys(pptx.files).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).map(k => pptx.file(k)!.async('string')))).join('');
    const visible = text(slides, 'a:t');
    expect(visible).toContain('정상');
    expect(visible).not.toContain('**정상**');
    expect(visible).not.toContain('[x]');
    expect(visible).toContain('**literal**');
  });
  it('Excel 표 구분행·코드펜스를 제거하고 줄바꿈·표 스타일을 저장한다', async () => {
    const blob = await buildXlsxBlob(fixture);
    const bytes = await blob.arrayBuffer();
    const book = XLSX.read(bytes, { type: 'array' });
    const cells = XLSX.utils.sheet_to_json(book.Sheets.Document, { header: 1 }) as string[][];
    expect(cells.some(row => row[0] === '항목' && row[1] === '결과')).toBe(true);
    const visible = cells.flat().join('\n');
    expect(visible).not.toContain('**정상**');
    expect(visible).not.toContain('---');
    expect(visible).not.toContain('```');
    expect(visible).toContain('☑ 완료');
    expect(visible).toContain('**literal**');
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/styles.xml')!.async('string')).toContain('wrapText="1"');
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('s="2"');
  });
});
