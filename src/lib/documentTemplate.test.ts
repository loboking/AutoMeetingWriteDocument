import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildDocxBlob, buildDocumentHtml, contentToHtml } from './exportFormatters';
import { documentOutline, tableColumnWidths } from './documentTemplate';
const source = '# 요구사항\n\n## 범위\n\n금액은 **1,250,000원**, 비율은 99.9%입니다.\n\n| 번호 | 조건 |\n| --- | --- |\n| A-01 | 본문을 그대로 유지합니다. |\n\n## 검증\n\n1. 원문 확인\n2. 파일 확인\n\n```json\n{"count": 42}\n```';
describe('공통 다운로드 템플릿', () => {
  it('본문을 그대로 포함하고 목차에 코드 속 제목을 섞지 않는다', () => {
    const html = buildDocumentHtml(source, undefined, { title: '<기준 문서>', projectTitle: '<script>test</script>' });
    expect(html).toContain(`<main>${contentToHtml(source)}</main>`);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;기준 문서&gt;');
    expect(documentOutline('# 제목\n```text\n## 코드 제목\n```').entries).toHaveLength(1);
  });
  it('Word에 표지, 제목, 본문, 수치, 실제 표와 페이지 필드를 보존한다', async () => {
    const blob = await buildDocxBlob(source, { title: '기준 문서', projectTitle: '예시 프로젝트' });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const text of ['기준 문서', '예시 프로젝트', '목차', '1,250,000원', '99.9%', 'A-01', '본문을 그대로 유지합니다.', '원문 확인', '파일 확인', '42']) expect(xml).toContain(text);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader');
    expect(xml).toContain('w:w="11906"');
    const footer = Object.keys(zip.files).find(path => /^word\/footer\d+\.xml$/.test(path))!;
    expect(await zip.file(footer)!.async('string')).toContain('PAGE');
  });
  it('서술형 열에 더 많은 폭을 할당한다', () => {
    const widths = tableColumnWidths([['ID', '설명'], ['A', '긴 요구사항 문장의 내용을 온전히 표시합니다.']]);
    expect(widths[1]).toBeGreaterThan(widths[0]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
  it('번호 목록과 닫히지 않은 코드도 출력한다', () => {
    expect(contentToHtml('3. 세 번째\n4. 네 번째')).toContain('<ol start="3">');
    expect(contentToHtml('```text\n마지막 내용')).toContain('마지막 내용');
  });
});

describe('다이어그램 펜스 출력 호환', () => {
  it.each(['~~~Mermaid\r\nflowchart TB\r\nA-->B\r\n~~~', '```` mermaid\nflowchart TB\nA-->B\n````'])('추출과 PDF 렌더러가 같은 코드를 사용한다', content => {
    const diagram = { dataUrl: 'data:image/png;base64,test', w: 100, h: 100 };
    const html = contentToHtml(content, { byCode: new Map([['flowchart TB\nA-->B', diagram]]), byRaw: new Map() });
    expect(html).toContain('<img ');
    expect(html).not.toContain('<pre>');
  });
});
