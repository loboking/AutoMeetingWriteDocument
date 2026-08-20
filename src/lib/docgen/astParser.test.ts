import { describe, it, expect } from 'vitest';
import { parseMarkdownToBlocks } from './astParser';

const paraText = (md: string) => parseMarkdownToBlocks(md).find((b) => b.type === 'paragraph')?.text ?? '';

describe('parseMarkdownToBlocks — 인라인 노드 보존', () => {
  it('하드 브레이크(2스페이스 + 줄바꿈)는 \\n로 보존 — 멀티라인 붕괴 방지', () => {
    expect(paraText('줄1  \n줄2')).toBe('줄1\n줄2');
  });

  it('인라인 이미지 ![alt](url)은 alt/url 보존(silent loss 방지)', () => {
    expect(paraText('본문 ![다이어그램](dia.png) 끝')).toBe('본문 ![다이어그램](dia.png) 끝');
  });

  it('링크 [text](url)은 href 보존 — 외부 참조 소거 방지', () => {
    expect(paraText('문서 [바로가기](https://x.com) 입니다')).toBe('문서 바로가기 (https://x.com) 입니다');
  });

  it('강조 마커(**/`/* /~~) 보존', () => {
    expect(paraText('**굵게** *기울임* `code` ~~취소~~')).toBe('**굵게** *기울임* `code` ~~취소~~');
  });

  it('GFM task list 체크박스 상태([ ]/[x]) 보존', () => {
    const block = parseMarkdownToBlocks('- [x] 완료\n- [ ] 미완료').find((b) => b.type === 'list');
    expect(block?.items?.[0].text).toBe('[x] 완료');
    expect(block?.items?.[1].text).toBe('[ ] 미완료');
  });
});
