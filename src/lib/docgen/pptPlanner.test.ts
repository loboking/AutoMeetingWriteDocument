import { describe, it, expect } from 'vitest';
import { planSlides, MAX_BULLETS, MAX_BULLET_CHARS, MAX_TABLE_ROWS } from './pptPlanner';
import { groupSemanticSections } from './semanticSection';

const plan = (md: string) => planSlides(groupSemanticSections(md));

describe('planSlides', () => {
  it('빈 입력은 최소 title 1장', () => {
    const plans = plan('');
    expect(plans).toHaveLength(1);
    expect(plans[0].kind).toBe('title');
  });

  it('첫 heading(level 1~2)은 title 슬라이드, 자식은 다음 section 슬라이드', () => {
    const plans = plan('# 문서 제목\n\n내용A\n- 항목1');
    expect(plans[0].kind).toBe('title');
    expect(plans[0].title).toBe('문서 제목');
    // title 다음에 section 슬라이드(불릿). itemsToLines가 list에 '· ' 접두.
    expect(plans.length).toBeGreaterThan(1);
    expect(plans[1].kind).toBe('section');
    expect(plans[1].bullets).toEqual(expect.arrayContaining(['내용A', '· 항목1']));
  });

  it('중첩 리스트는 level 들여쓰기로 보존 — 부모/자식이 통문자로 붙지 않는다', () => {
    const md = '# 제목\n\n- 부모\n  - 자식1\n  - 자식2';
    const sec = plan(md).find((p) => p.kind === 'section');
    expect(sec?.bullets).toEqual(['· 부모', '  · 자식1', '  · 자식2']);
  });

  it('단일 초장 불릿(2000자)은 청킹 — 한 bullet은 MAX_BULLET_CHARS 이하, 총량 보존', () => {
    const long = '가'.repeat(2000);
    const secs = plan('# t\n\n- ' + long).filter((p) => p.kind === 'section');
    const allBullets = secs.flatMap((s) => s.bullets ?? []);
    expect(allBullets.join('').replace(/·\s|  /g, '').length).toBe(2000);
    for (const b of allBullets) expect(b.length).toBeLessThanOrEqual(MAX_BULLET_CHARS + 8);
  });

  it('본문 없는 level 4 heading도 section 슬라이드로 누락 없음 (#### 손실 잔류 방지)', () => {
    const plans = plan('# H1\n\n내용\n\n#### H4 제목\n\n## H2\n\n뒷내용');
    expect(plans.map((p) => p.title)).toContain('H4 제목');
  });

  it('heading 없는 서론은 title 폴백 없이 section(제목 빈 칸/개요)으로', () => {
    const plans = plan('서론 본문입니다.');
    expect(plans.some((p) => p.title === '개요' || p.title.trim() === '' || p.title === '서론 본문입니다.')).toBe(true);
  });

  it('불릿이 MAX_BULLETS 초과 시 분할(continuationOf/partIndex)', () => {
    const items = Array.from({ length: MAX_BULLETS + 3 }, (_, i) => `항목${i}`);
    const md = `# 제목\n\n${items.map((x) => `- ${x}`).join('\n')}`;
    const plans = plan(md);
    const sectionPlans = plans.filter((p) => p.kind === 'section');
    expect(sectionPlans.length).toBeGreaterThanOrEqual(2);
    // 두 번째부터 continuationOf가 첫 section을 가리킴.
    const firstIdx = plans.findIndex((p) => p.kind === 'section');
    expect(sectionPlans[1].continuationOf).toBe(firstIdx);
    expect(sectionPlans[0].partIndex).toBe(0);
    expect(sectionPlans[1].partIndex).toBe(1);
  });

  it('한 불릿이 MAX_BULLET_CHARS 초과해도 분할(글자수 밀도)', () => {
    const long = '가'.repeat(MAX_BULLET_CHARS + 50);
    const md = `# 제목\n\n- ${long}\n- ${long}`;
    const plans = plan(md);
    const sectionPlans = plans.filter((p) => p.kind === 'section');
    expect(sectionPlans.length).toBeGreaterThanOrEqual(2);
  });

  it('표는 table 슬라이드, 행 수가 MAX_TABLE_ROWS 초과 시 분할', () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => `| ${i} | ${i + 1} |`);
    const md = `# 표\n\n| A | B |\n|---|---|\n${rows.join('\n')}`;
    const plans = plan(md);
    const tablePlans = plans.filter((p) => p.kind === 'table');
    expect(tablePlans.length).toBeGreaterThanOrEqual(2);
    expect(tablePlans[0].partIndex).toBe(0);
    expect(tablePlans[1].continuationOf).toBeDefined();
    // partCount가 명시되어야 분할 정보가 완결.
    expect(tablePlans[0].partCount).toBe(tablePlans.length);
  });

  it('mermaid 블록은 image 슬라이드 + codeBlock.lang=mermaid', () => {
    const md = `# 흐름\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\``;
    const plans = plan(md);
    const imagePlan = plans.find((p) => p.kind === 'image');
    expect(imagePlan).toBeDefined();
    expect(imagePlan!.codeBlock?.lang).toBe('mermaid');
    expect(imagePlan!.codeBlock?.code).toContain('flowchart');
  });

  it('일반 코드 블록도 image 슬라이드(lang=text), omissions 기록', () => {
    const md = `# 코드\n\n\`\`\`js\nconst x = 1;\n\`\`\``;
    const plans = plan(md);
    const imagePlan = plans.find((p) => p.kind === 'image');
    expect(imagePlan).toBeDefined();
    expect(imagePlan!.codeBlock?.lang).toBe('js');
    expect(imagePlan!.omissions).toBeDefined();
  });
});
