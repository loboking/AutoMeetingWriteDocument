// ContentBlock[] → SemanticSection[]. heading을 부모로 자식 blocks를 묶는다.
// PPT planner/Word 렌더의 공통 upstream. 정규식 기반 build*의 "줄 단위" 처리를
// "의미 단위"로 바꾸는 핵심 — #### 이하 헤더 손실/표 텍스트화/코드 평문화를 모두 여기서 해소.
import type { SemanticSection, SourceRange } from './types';
import { parseMarkdownToBlocks } from './astParser';

// range 확장: base에 other를 포함하도록 병합(둘 다 유효할 때).
function extendRange(base: SourceRange, other: SourceRange): SourceRange {
  return {
    start: base.start.line === 0 ? other.start : base.start,
    end: other.end.line === 0 ? base.end : other.end,
  };
}

export function groupSemanticSections(md: string): SemanticSection[] {
  const blocks = parseMarkdownToBlocks(md);
  const sections: SemanticSection[] = [];
  let current: SemanticSection | null = null;
  let nextId = 0;

  const seal = () => {
    if (current) sections.push(current);
    current = null;
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      seal();
      current = {
        id: nextId++,
        heading: { level: block.level ?? 1, text: block.text ?? '', range: block.range },
        blocks: [],
        range: block.range,
      };
      continue;
    }
    // thematicBreak도 block으로 보존(렌더가 hr/구분선 처리). 이전엔 무시해 문서 단절이 사라졌다.
    if (!current) {
      // heading 앞 최상위 블록 — 가상 루트 section.
      current = { id: nextId++, blocks: [], range: block.range };
    }
    current.blocks.push(block);
    current.range = extendRange(current.range, block.range);
  }
  seal();
  return sections;
}

// 빈 section(heading만 있고 자식 없음) 제거. planner가 폐기된 section을 안 다루도록.
export function dropEmptySections(sections: SemanticSection[]): SemanticSection[] {
  return sections.filter((s) => s.blocks.length > 0 || (s.heading && s.heading.text));
}
