// exportFormatters 유닛테스트 — 추출 전 green 확인, 추출 후 무회귀 증명.
// contentToHtml: 마크다운 → HTML 변환 검증.
// build*: Blob.type 및 size>0 검증 (실제 파일 내용은 통합테스트 범위).

import { describe, it, expect } from 'vitest';
import { contentToHtml, buildXlsxBlob } from './exportFormatters';

// Note: buildDocxBlob, buildPptxBlob, buildPdfBlob은 브라우저 API(document, html2pdf)에 의존하므로
// Node 환경에서 동작하는 buildXlsxBlob과 contentToHtml만 여기서 커버.
// buildDocxBlob / buildPptxBlob / buildPdfBlob은 E2E/브라우저 테스트 범위.

describe('contentToHtml', () => {
  it('h1 헤더를 <h1> 태그로 변환한다', () => {
    const result = contentToHtml('# 제목');
    expect(result).toContain('<h1>제목</h1>');
  });

  it('h2 헤더를 <h2> 태그로 변환한다', () => {
    const result = contentToHtml('## 소제목');
    expect(result).toContain('<h2>소제목</h2>');
  });

  it('볼드 인라인을 <strong>으로 변환한다', () => {
    const result = contentToHtml('## **중요** 항목');
    expect(result).toContain('<strong>중요</strong>');
  });

  it('리스트 항목을 <ul><li>로 변환한다', () => {
    const result = contentToHtml('- 항목1\n- 항목2');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
    expect(result).toContain('항목1');
    expect(result).toContain('항목2');
  });

  it('테이블을 <table> 태그로 변환한다', () => {
    const md = '| 이름 | 값 |\n|------|----|\n| A | 1 |';
    const result = contentToHtml(md);
    expect(result).toContain('<table>');
    expect(result).toContain('<th>');
    expect(result).toContain('이름');
    expect(result).toContain('A');
  });

  it('코드 펜스를 <pre><code>로 변환한다', () => {
    const md = '```js\nconsole.log("hello")\n```';
    const result = contentToHtml(md);
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
  });

  it('XSS 위험 문자를 이스케이프한다', () => {
    const result = contentToHtml('# <script>alert(1)</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('diagrams가 없으면 mermaid 블록을 코드로 렌더한다', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const result = contentToHtml(md);
    // diagrams 미제공 → 코드 폴백 또는 <pre> 렌더
    expect(result).toContain('graph TD');
  });
});

describe('buildXlsxBlob', () => {
  it('Blob을 반환한다', () => {
    const blob = buildXlsxBlob('# 제목\n\n- 항목1\n- 항목2');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('size > 0이다', () => {
    const blob = buildXlsxBlob('# 제목\n내용');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('XLSX MIME 타입이다', () => {
    const blob = buildXlsxBlob('내용');
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('테이블 마크다운도 처리한다', () => {
    const md = '| 이름 | 값 |\n|------|----|\n| A | 1 |';
    const blob = buildXlsxBlob(md);
    expect(blob.size).toBeGreaterThan(0);
  });
});
