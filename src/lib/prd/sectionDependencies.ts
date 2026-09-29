import { PRD_SECTIONS, type PRDSection } from './prdSections';

/** 서버와 브라우저가 같은 의존 순서로 섹션을 생성한다. */
export function getSectionLevels(): PRDSection[][] {
  const pending = new Map(PRD_SECTIONS.map(section => [section.id, section]));
  const completed = new Set<string>();
  const levels: PRDSection[][] = [];
  while (pending.size) {
    const ready = [...pending.values()]
      .filter(section => (section.dependsOn ?? []).every(id => completed.has(id)))
      .sort((a, b) => a.order - b.order);
    if (!ready.length) throw new Error('PRD 섹션 의존성이 순환하거나 누락되었습니다.');
    levels.push(ready);
    for (const section of ready) {
      completed.add(section.id);
      pending.delete(section.id);
    }
  }
  return levels;
}

/** 성공한 선행 본문만 허용한다. 실패한 섹션으로 후속 설계를 만들지 않는다. */
export function getSectionContext(sectionId: string, completed: unknown): Record<string, string> {
  const section = PRD_SECTIONS.find(candidate => candidate.id === sectionId);
  if (!section) throw new Error(`섹션을 찾을 수 없습니다: ${sectionId}`);
  const input = completed && typeof completed === 'object' && !Array.isArray(completed)
    ? completed as Record<string, unknown> : {};
  const context: Record<string, string> = {};
  for (const id of section.dependsOn ?? []) {
    const content = input[id];
    if (typeof content !== 'string' || !content.trim() || content.includes('생성 실패')) {
      throw new Error(`선행 섹션 확인 필요: ${id}`);
    }
    context[id] = content;
  }
  return context;
}
