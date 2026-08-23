// PRD 섹션 조립 (순수 — 서버/클라 공용).
// 클라 섹션 오케스트레이션(섹션당 1콜)이 조립을 클라에서 하므로 prdChunkGenerator에서 분리.
import { PRD_SECTIONS } from './prdSections';

// 섹션 H2 대제목(## N. 제목) 보장.
// GLM이 ### N.1 부터 출력해 H2를 누락하면 뷰어가 해당 섹션을 못 찾아 공백으로 보임 → 자동 보정.
export function ensureSectionHeading(content: string, sectionTitle: string): string {
  const trimmed = content.trimStart();
  const num = sectionTitle.match(/^(\d+)\./)?.[1];
  if (num) {
    const h2Pattern = new RegExp(`^##\\s+${num}\\.`, 'm');
    if (new RegExp(`^##\\s+${num}\\.`).test(trimmed)) return content;
    if (!h2Pattern.test(content)) {
      return `## ${sectionTitle}\n\n${trimmed}`;
    }
  }
  if (!/^##\s/.test(trimmed)) {
    return `## ${sectionTitle}\n\n${trimmed}`;
  }
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
