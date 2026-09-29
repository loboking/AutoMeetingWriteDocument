// PRD 섹션 조립 (순수 — 서버/클라 공용).
// 클라 섹션 오케스트레이션(섹션당 1콜)이 조립을 클라에서 하므로 prdChunkGenerator에서 분리.
import { PRD_SECTIONS } from './prdSections';

// 섹션 H2 대제목(## N. 제목) 보장.
// - GLM이 ### N.1 부터 출력해 H2를 누락하면 뷰어가 해당 섹션을 못 찾아 공백으로 보임 → 앞에 붙임.
// - GLM이 "# N. 제목"(H1)으로 쓰면 예전엔 H2를 또 붙여 제목이 2번 반복됨 → 그 줄을 H2 정본 제목으로 교체.
export function ensureSectionHeading(content: string, sectionTitle: string): string {
  const trimmed = content.trimStart();
  const num = sectionTitle.match(/^(\d+)\./)?.[1];
  const canonical = `## ${sectionTitle}`;
  if (num) {
    if (new RegExp(`^##\\s+${num}\\.`).test(trimmed)) return content;
    // 레벨이 다른(#, ###…) "N. 제목" 줄이 있으면 그 줄을 정본 H2로 교체 (중복 방지)
    const anyLevel = new RegExp(`^#{1,6}\\s+${num}\\.(?!\\d)[^\\n]*$`, 'm'); // (?!\d): 6.1 같은 하위 번호는 제외
    if (anyLevel.test(content)) return content.replace(anyLevel, canonical);
    return `${canonical}\n\n${trimmed}`;
  }
  if (/^#\s/.test(trimmed)) return trimmed.replace(/^#\s+[^\n]*/, canonical);
  if (!/^##\s/.test(trimmed)) return `${canonical}\n\n${trimmed}`;
  return content;
}

// PRD 문서 조립. sections: { sectionId: content }.
export function assemblePRD(
  sections: Record<string, string>,
  meetingInfo: { title: string; date: string }
): string {
  const parts: string[] = [];

  parts.push(`# PRD (Product Requirements Document)`);
  parts.push(``);
  parts.push(`> 회의: ${meetingInfo.title}`);
  parts.push(`> 작성일: ${meetingInfo.date}`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  const sortedSections = [...PRD_SECTIONS].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const content = sections[section.id];
    if (content) {
      parts.push(ensureSectionHeading(content, section.title));
      parts.push(``);
      parts.push(`---`);
      parts.push(``);
    }
  }

  parts.push(``);
  parts.push(`---`);
  parts.push(``);
  parts.push(`*이 문서는 회의 녹음을 바탕으로 AI가 자동 생성했습니다.*`);

  return parts.join('\n');
}
