import { describe, it, expect } from 'vitest';
import { assemblePRD, ensureSectionHeading } from './assemblePRD';
import { PRD_SECTIONS } from './prdSections';

const info = { title: '테스트 회의', date: '2026-08-24' };

describe('ensureSectionHeading', () => {
  it('H2가 있으면 그대로 둔다', () => {
    const c = '## 9. 기술 요구사항\n\n내용';
    expect(ensureSectionHeading(c, '9. 기술 요구사항')).toBe(c);
  });
  it('H1(# N.)로 쓰면 H2로 바꾸고 제목을 중복시키지 않는다', () => {
    const out = ensureSectionHeading('# 6. 기능 요구사항 (Functional Requirements)\n\n### 6.1 필수\n본문', '6. 기능 요구사항 (Functional Requirements)');
    expect(out.startsWith('## 6. 기능 요구사항')).toBe(true);
    expect(out.match(/6\. 기능 요구사항/g)?.length).toBe(1);
  });
  it('H3(### N.1)만 있으면 그 줄을 건드리지 않고 H2를 앞에 붙인다', () => {
    const out = ensureSectionHeading('### 6.1 필수 기능\n본문', '6. 기능 요구사항');
    expect(out).toBe('## 6. 기능 요구사항\n\n### 6.1 필수 기능\n본문');
  });
  it('H3로 시작하면 H2 대제목을 앞에 붙인다', () => {
    const out = ensureSectionHeading('### 9.1 기술 스택\n표', '9. 기술 요구사항');
    expect(out.startsWith('## 9. 기술 요구사항')).toBe(true);
  });
});

describe('assemblePRD', () => {
  it('섹션을 order 순으로 조립하고 헤더/푸터를 포함한다', () => {
    const map: Record<string, string> = {
      overview: '## 2. 개요 (Executive Summary)\n\n개요 본문',
      problem: '## 3. 문제 정의 (Problem Statement)\n\n문제 본문',
    };
    const doc = assemblePRD(map, info);
    expect(doc).toContain('# PRD (Product Requirements Document)');
    expect(doc).toContain('테스트 회의');
    // order: overview(2)가 problem(3)보다 앞
    expect(doc.indexOf('개요 본문')).toBeLessThan(doc.indexOf('문제 본문'));
    expect(doc).toContain('AI가 자동 생성');
  });

  it('빠진 섹션은 건너뛴다(부분 조립 허용)', () => {
    const doc = assemblePRD({ overview: '## 2. 개요\n\n본문' }, info);
    expect(doc).toContain('본문');
    // 없는 섹션 제목은 안 들어감
    expect(doc).not.toContain('15. 부록');
  });
});

// 클라 섹션 오케스트레이션의 partial/okCount 판정 로직(순수부분)만 재현 검증.
describe('section partial 판정', () => {
  const decide = (results: { failed: boolean; content: string }[]) => {
    let okCount = 0;
    for (const r of results) if (!r.failed && r.content) okCount++;
    return { okCount, partial: okCount < results.length, total: results.length };
  };
  it('전부 성공 → partial=false', () => {
    const r = decide(PRD_SECTIONS.map(() => ({ failed: false, content: 'x' })));
    expect(r.partial).toBe(false);
    expect(r.okCount).toBe(PRD_SECTIONS.length);
  });
  it('일부 실패 → partial=true, okCount>0', () => {
    const r = decide([
      { failed: false, content: 'a' },
      { failed: true, content: '## t\n\n생성 실패' },
      { failed: false, content: 'b' },
    ]);
    expect(r.partial).toBe(true);
    expect(r.okCount).toBe(2);
  });
  it('전부 실패 → okCount=0 (상위에서 문서 실패 처리)', () => {
    const r = decide([{ failed: true, content: '생성 실패' }, { failed: true, content: '' }]);
    expect(r.okCount).toBe(0);
  });
});
