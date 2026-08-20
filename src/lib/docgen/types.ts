// docgen 공통 파이프라인 타입 — Markdown AST → ContentBlock → SemanticSection → (SlidePlan|docx 직렬) → 렌더
// 정규식 직역(contentToHtml/build*)을 AST 기반으로 대체. Claude+Codex 합의 v1.
//   - sourceRange: 원문 위치(디버그/근거/사용자 수정 반영)
//   - notes/omissions: 원문 이중 보존(본문 압축 + 노트 원문)
//   - 한국어 밀도: 단어 수가 아니라 글자 수+줄+렌더 overflow로 판정(planner 단계)
// PPT/Word 양쪽이 SemanticSection까지 공유. Word는 페이지 무한이라 별도 플랜 불필요(SemanticSection 직렬).

export type ContentBlockType =
  | 'heading' | 'paragraph' | 'list' | 'table'
  | 'code' | 'mermaid' | 'quote' | 'thematicBreak';

export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface ContentBlock {
  type: ContentBlockType;
  level?: number;            // heading 전용(1~6)
  text?: string;             // paragraph / heading / quote / callout
  items?: ListItem[];        // list (중첩 level 보존)
  ordered?: boolean;         // 최상위 list 플래그(items에 항목별 ordered도 담음)
  rows?: string[][];         // table (rows[0] = 헤더, 모든 행이 동일 열 수로 정규화)
  lang?: string;             // code
  code?: string;             // code / mermaid
  range: SourceRange;        // 원문 위치
}

// 리스트 항목 — 중첩 리스트를 평탄 배열로(level로 들여쓰기 단위 표현).
// 회의록 액션아이템 하위 태스크·의사결정 근거-후속 등 계층이 흔해 level 보존이 필수.
export interface ListItem {
  text: string;
  level: number;             // 0 = 최상위, 1 = 1단계 중첩, ...
  ordered?: boolean;         // 이 항목이 속한 (자식) list가 ordered면 true → 번호 매김
}

// heading을 부모로 자식 blocks를 묶은 의미 단위. PPT planner/Word 렌더의 공통 입력.
// heading이 없는 최상위 블록(문서 서론 등)은 heading=undefined인 가상 루트 section.
export interface SemanticSection {
  id: number;
  heading?: { level: number; text: string; range: SourceRange };
  blocks: ContentBlock[];    // heading 직속 자식(heading 자신 제외)
  range: SourceRange;        // section 전체 범위(heading~마지막 자식)
}

export type SlideKind =
  | 'title' | 'agenda' | 'section' | 'table' | 'image'
  | 'quote' | 'metrics' | 'summary';

export interface SlideTable {
  headers: string[];
  rows: string[][];
}

export interface SlidePlan {
  kind: SlideKind;
  title: string;
  keyPoint?: string;
  bullets?: string[];
  table?: SlideTable;
  image?: { dataUrl: string; alt?: string };
  codeBlock?: { lang: string; code: string }; // code/mermaid 원본. 렌더가 mermaid면 diagrams에서 PNG 교체.
  callout?: string;
  notes?: string;            // 원문 근거(발표자 노트). 본문엔 압축, 노트엔 원문.
  sourceRange?: SourceRange;
  continuationOf?: number;   // 분할 시 이전 슬라이드 인덱스
  partIndex?: number;
  partCount?: number;
  importance?: 'high' | 'normal' | 'low';
  layoutHint?: 'text' | 'table' | 'image' | 'split';
  omissions?: string[];      // 생략한 코드/표 행/긴 본문 명시 기록
}
