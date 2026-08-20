import { describe, it, expect } from 'vitest';
import { groupSemanticSections, dropEmptySections } from './semanticSection';

describe('groupSemanticSections', () => {
  it('빈 입력은 빈 배열', () => {
    expect(groupSemanticSections('')).toEqual([]);
  });

  it('heading마다 section 분리, 자식 block은 그 section에', () => {
    const md = `# 제목1\n내용A\n\n- 항목1\n- 항목2\n\n## 제목2\n내용B`;
    const sections = groupSemanticSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading?.text).toBe('제목1');
    expect(sections[0].heading?.level).toBe(1);
    expect(sections[0].blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
    expect(sections[1].heading?.text).toBe('제목2');
    expect(sections[1].blocks).toHaveLength(1);
    expect(sections[1].blocks[0].type).toBe('paragraph');
  });

  it('heading 앞 최상위 블록은 heading 없는 가상 루트 section', () => {
    const md = `서론 텍스트\n\n# 본문\n내용`;
    const sections = groupSemanticSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBeUndefined();
    expect(sections[0].blocks[0].type).toBe('paragraph');
    expect(sections[1].heading?.text).toBe('본문');
  });

  it('thematicBreak(---)는 block으로 보존(렌더가 hr 처리) — 의도된 문서 단절 유지', () => {
    const md = `# 제목\n내용\n\n---\n\n더 내용`;
    const sections = groupSemanticSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].blocks.some((b) => b.type === 'thematicBreak')).toBe(true);
    expect(sections[0].blocks.filter((b) => b.type === 'paragraph')).toHaveLength(2);
  });

  it('heading만 있고 자식 없는 section도 생성(빈 blocks)', () => {
    const md = `# 제목1\n\n# 제목2\n내용`;
    const sections = groupSemanticSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].blocks).toHaveLength(0);
    expect(sections[1].blocks).toHaveLength(1);
  });

  it('표는 table block으로 한 section에', () => {
    const md = `# 표섹션\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |`;
    const sections = groupSemanticSections(md);
    expect(sections[0].blocks).toHaveLength(1);
    expect(sections[0].blocks[0].type).toBe('table');
    expect(sections[0].blocks[0].rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});

describe('dropEmptySections', () => {
  it('빈 section(heading도 없고 block도 없음) 제거', () => {
    const md = `# 제목\n\n내용`;
    const sections = groupSemanticSections(md);
    // heading 있는 section은 유지
    expect(dropEmptySections(sections)).toHaveLength(1);
  });
  it('heading 텍스트 있으면 block 없어도 유지', () => {
    const md = `# 제목1\n\n# 제목2\n내용`;
    const sections = groupSemanticSections(md);
    const dropped = dropEmptySections(sections);
    expect(dropped).toHaveLength(2); // 둘 다 heading 있음
  });
});
