import { describe, it, expect } from 'vitest';
import { topoSortLevels, levelsFor, topoSortDocs, orderCoreFirst, CORE_DOCS, DEPENDENCIES, DOCUMENTS, type DocType } from '@/lib/documentUtils';

// 레벨 배열을 평탄화하고, 각 문서가 자기 의존 대상보다 뒤(또는 같은 레벨이 아닌 앞)인지 검증.
function assertTopologicallyValid(levels: DocType[][], scope: Set<DocType>) {
  const positionOfLevel = new Map<DocType, number>();
  levels.forEach((level, idx) => level.forEach((dt) => positionOfLevel.set(dt, idx)));

  for (const [docType, deps] of Object.entries(DEPENDENCIES) as [DocType, DocType[]][]) {
    if (!scope.has(docType)) continue;
    const selfLevel = positionOfLevel.get(docType);
    expect(selfLevel, `${docType} must be present`).toBeDefined();
    for (const dep of deps) {
      // 의존 대상이 scope 안에 있다면, 반드시 자신보다 앞선(작은) 레벨에 있어야 한다.
      if (scope.has(dep)) {
        const depLevel = positionOfLevel.get(dep);
        expect(depLevel, `${dep} (dep of ${docType}) must be present`).toBeDefined();
        expect(depLevel!, `${dep} must come before ${docType}`).toBeLessThan(selfLevel!);
      }
    }
  }
}

describe('topoSortLevels (전체 14종 위상 레벨)', () => {
  const levels = topoSortLevels();

  it('14개 문서를 모두 포함한다 (누락/중복 없음)', () => {
    const flat = levels.flat();
    expect(flat.length).toBe(14);
    expect(new Set(flat).size).toBe(14);
  });

  it('레벨 0은 의존성이 없는 문서들이다 (prd/user-story/feature-list/flowchart)', () => {
    const level0 = new Set(levels[0]);
    expect(level0.has('prd')).toBe(true);
    expect(level0.has('user-story')).toBe(true);
    expect(level0.has('feature-list')).toBe(true);
    expect(level0.has('flowchart')).toBe(true);
  });

  it('모든 의존 관계가 위상순서를 만족한다 (dep이 자신보다 앞선 레벨)', () => {
    assertTopologicallyValid(levels, new Set(DOCUMENTS.map((d) => d.key)));
  });
});

describe('levelsFor (부분집합 일괄 재생성용)', () => {
  it('빈 입력은 빈 배열', () => {
    expect(levelsFor([])).toEqual([]);
  });

  it('targets에 속한 문서만 남기고 빈 레벨을 제거한다', () => {
    const targets: DocType[] = ['ia', 'wbs']; // 서로 다른 레벨, 사이 레벨은 비어야 함
    const levels = levelsFor(targets);
    const flat = levels.flat();
    expect(new Set(flat)).toEqual(new Set(targets));
    // 빈 레벨이 없어야 함
    expect(levels.every((lvl) => lvl.length > 0)).toBe(true);
  });

  it('부분집합 안에서도 의존 순서를 보존한다 (screen-list → ia → wireframe)', () => {
    const targets: DocType[] = ['wireframe', 'ia', 'screen-list'];
    const levels = levelsFor(targets);
    const scope = new Set(targets);
    assertTopologicallyValid(levels, scope);
    // screen-list가 ia보다, ia가 wireframe보다 앞 레벨
    const pos = new Map<DocType, number>();
    levels.forEach((lvl, i) => lvl.forEach((d) => pos.set(d, i)));
    expect(pos.get('screen-list')!).toBeLessThan(pos.get('ia')!);
    expect(pos.get('ia')!).toBeLessThan(pos.get('wireframe')!);
  });

  it('feature-list 허브를 포함한 큰 부분집합도 위상 정합', () => {
    // feature-list 수정 시 영향받는 전형적 하위 집합
    const targets: DocType[] = [
      'screen-list', 'ia', 'database', 'api-spec',
      'test-plan', 'test-case', 'wbs', 'deployment', 'wireframe',
    ];
    const levels = levelsFor(targets);
    expect(new Set(levels.flat())).toEqual(new Set(targets));
    assertTopologicallyValid(levels, new Set(targets));
  });

  it('단일 문서는 한 레벨에 그 문서만', () => {
    expect(levelsFor(['database'])).toEqual([['database']]);
  });

  it('targets 밖 문서는 절대 포함하지 않는다', () => {
    const targets: DocType[] = ['api-spec', 'test-plan'];
    const flat = levelsFor(targets).flat();
    expect(flat).not.toContain('feature-list');
    expect(flat).not.toContain('database');
    expect(new Set(flat)).toEqual(new Set(targets));
  });
});

describe('CORE_DOCS (composite 핵심 우선 집합)', () => {
  it('핵심 3개: prd / feature-list / wbs (서연 확정)', () => {
    expect(CORE_DOCS).toEqual(['prd', 'feature-list', 'wbs']);
  });

  it('모든 핵심이 실제 DocType이다', () => {
    const keys = new Set(DOCUMENTS.map((d) => d.key));
    for (const c of CORE_DOCS) expect(keys.has(c)).toBe(true);
  });
});

describe('orderCoreFirst (composite 핵심 우선 재배치)', () => {
  it('14개 전체를 그대로 포함한다 (누락/중복 없음)', () => {
    const order = orderCoreFirst(topoSortDocs());
    expect(order.length).toBe(14);
    expect(new Set(order).size).toBe(14);
  });

  it('위상 순서를 위반하지 않는다 (dep이 자신보다 앞에)', () => {
    const order = orderCoreFirst(topoSortDocs());
    const pos = new Map<DocType, number>();
    order.forEach((d, i) => pos.set(d, i));
    for (const [doc, deps] of Object.entries(DEPENDENCIES) as [DocType, DocType[]][]) {
      for (const dep of deps) {
        expect(pos.get(dep)!, `${dep} must come before ${doc}`).toBeLessThan(pos.get(doc)!);
      }
    }
  });

  it('핵심 3개가 나머지보다 먼저 올 수 있는 건 각자의 위상 레벨 내에서만', () => {
    // 핵심이 의존성을 위반해 앞당겨지지 않았는지 추가 검증:
    // wbs는 feature-list, api-spec, wireframe에 의존. wbs가 이 셋보다 앞이면 위반.
    const order = orderCoreFirst(topoSortDocs());
    const pos = new Map<DocType, number>();
    order.forEach((d, i) => pos.set(d, i));
    expect(pos.get('feature-list')!).toBeLessThan(pos.get('wbs')!);
    expect(pos.get('api-spec')!).toBeLessThan(pos.get('wbs')!);
    expect(pos.get('wireframe')!).toBeLessThan(pos.get('wbs')!);
  });

  it('빈 order는 빈 배열', () => {
    expect(orderCoreFirst([])).toEqual([]);
  });

  it('단일 문서도 정상 반환', () => {
    expect(orderCoreFirst(['prd'])).toEqual(['prd']);
  });

  it('같은 레벨 내에서 core가 non-core보다 앞에 정렬된다 (레벨 0: prd/user-story/feature-list/flowchart)', () => {
    // 레벨 0 = 의존성 없는 4종. 그중 core는 prd, feature-list. 이 둘이 non-core(user-story, flowchart)보다 앞이어야 함.
    const order = orderCoreFirst(topoSortDocs());
    const pos = new Map<DocType, number>();
    order.forEach((d, i) => pos.set(d, i));
    expect(pos.get('prd')!).toBeLessThan(pos.get('user-story')!);
    expect(pos.get('prd')!).toBeLessThan(pos.get('flowchart')!);
    expect(pos.get('feature-list')!).toBeLessThan(pos.get('user-story')!);
    expect(pos.get('feature-list')!).toBeLessThan(pos.get('flowchart')!);
  });
});

describe('coreDone 판정 (composite 완료 조건)', () => {
  // runGenerationLoop의 완료 판정 로직을 단순 재현한 헬퍼.
  const isCoreDone = (doneSet: Set<DocType>) => CORE_DOCS.every((d) => doneSet.has(d));

  it('핵심 3개가 모두 있으면 true', () => {
    expect(isCoreDone(new Set(['prd', 'feature-list', 'wbs']))).toBe(true);
    expect(isCoreDone(new Set(['prd', 'feature-list', 'wbs', 'api-spec']))).toBe(true);
  });

  it('하나라도 빠지면 false', () => {
    expect(isCoreDone(new Set(['prd', 'feature-list']))).toBe(false);
    expect(isCoreDone(new Set(['prd', 'wbs']))).toBe(false);
    expect(isCoreDone(new Set(['feature-list', 'wbs']))).toBe(false);
    expect(isCoreDone(new Set())).toBe(false);
  });

  it('나머지 11개만 있어도 false (핵심이 우선)', () => {
    const allButCore = DOCUMENTS.map((d) => d.key).filter((d) => !CORE_DOCS.includes(d));
    expect(isCoreDone(new Set(allButCore))).toBe(false);
  });
});
