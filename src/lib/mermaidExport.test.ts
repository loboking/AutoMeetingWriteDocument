import { describe, it, expect } from 'vitest';
import { extractAllMermaid } from './mermaidExport';

describe('extractAllMermaid', () => {
  it('단일 mermaid 블록을 추출한다', () => {
    const md = '# 제목\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n끝';
    const blocks = extractAllMermaid(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe('graph TD\n  A --> B');
  });

  it('여러 mermaid 블록을 모두 추출한다 (extractMermaidCode는 첫 1개만)', () => {
    const md =
      '```mermaid\ngraph TD\n  A --> B\n```\n\n중간\n\n```mermaid\nerDiagram\n  USER ||--o{ ORDER : has\n```';
    const blocks = extractAllMermaid(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].code).toContain('graph TD');
    expect(blocks[1].code).toContain('erDiagram');
  });

  it('HTML 엔티티를 원래 기호로 복원한다', () => {
    const md = '```mermaid\ngraph TD\n  A --&gt; B\n  C[&lt;b&gt;노드&lt;/b&gt;]\n```';
    const blocks = extractAllMermaid(md);
    expect(blocks[0].code).toContain('A --> B');
    expect(blocks[0].code).toContain('<b>노드</b>');
  });

  it('mermaid 블록이 없으면 빈 배열', () => {
    expect(extractAllMermaid('# 제목\n\n일반 텍스트')).toEqual([]);
  });

  it('일반 코드블록(```js)은 추출하지 않는다', () => {
    const md = '```js\nconst a = 1;\n```\n\n```mermaid\ngraph TD\nX-->Y\n```';
    const blocks = extractAllMermaid(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toContain('graph TD');
  });

  it('raw에 원본 펜스 전체가 보존된다', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const blocks = extractAllMermaid(md);
    expect(blocks[0].raw).toBe('```mermaid\ngraph TD\nA-->B\n```');
  });
});
