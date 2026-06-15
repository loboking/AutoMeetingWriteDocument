import { describe, it, expect } from 'vitest';
import { sanitizeSectionContent } from './sanitizeSection';

describe('sanitizeSectionContent', () => {
  it('프롬프트 지시어 라인(작성 섹션:, 작성 가이드)을 제거한다', () => {
    const input = `작성 섹션: 13. 리스크 및 대응
## 13. 리스크 및 대응
실제 내용입니다.`;
    const out = sanitizeSectionContent(input);
    expect(out).not.toContain('작성 섹션:');
    expect(out).toContain('## 13. 리스크 및 대응');
    expect(out).toContain('실제 내용입니다.');
  });

  it('"원본 회의 내용", "작성 가이드" 등 누출 헤더를 제거한다', () => {
    const input = `## 원본 회의 내용
회의 녹취 그대로...
## 작성 가이드
이렇게 작성하세요
## 6. 기능 요구사항
F-001 로그인`;
    const out = sanitizeSectionContent(input);
    expect(out).not.toContain('원본 회의 내용');
    expect(out).not.toContain('작성 가이드');
    expect(out).toContain('## 6. 기능 요구사항');
  });

  it('정상 콘텐츠는 그대로 보존한다', () => {
    const input = `## 2. 개요
### 2.1 배경
정상적인 PRD 본문입니다.

| 항목 | 값 |
|------|-----|
| A | 1 |`;
    expect(sanitizeSectionContent(input)).toBe(input);
  });

  it('앞뒤 공백 라인을 정리한다', () => {
    const input = `\n\n## 4. 목표\n내용\n\n\n`;
    const out = sanitizeSectionContent(input);
    expect(out.startsWith('## 4. 목표')).toBe(true);
    expect(out.endsWith('내용')).toBe(true);
  });

  it('빈 입력은 빈 문자열을 반환한다', () => {
    expect(sanitizeSectionContent('')).toBe('');
    expect(sanitizeSectionContent('   \n  ')).toBe('');
  });
});
