import { describe, it, expect } from 'vitest';
import { docTypeToField, DEPENDENCIES, DOCUMENTS } from './documentUtils';

describe('docTypeToField', () => {
  it('하이픈 docType을 camelCase Meeting 필드로 매핑한다', () => {
    expect(docTypeToField('feature-list')).toBe('featureList');
    expect(docTypeToField('screen-list')).toBe('screenList');
    expect(docTypeToField('user-story')).toBe('userStory');
    expect(docTypeToField('api-spec')).toBe('apiSpec');
    expect(docTypeToField('test-plan')).toBe('testPlan');
  });

  it('test-case를 testCase로 매핑한다 (회귀: 누락 시 문서 저장 안 됨)', () => {
    expect(docTypeToField('test-case')).toBe('testCase');
  });

  it('단어 docType은 그대로 반환', () => {
    expect(docTypeToField('prd')).toBe('prd');
    expect(docTypeToField('ia')).toBe('ia');
    expect(docTypeToField('wbs')).toBe('wbs');
    expect(docTypeToField('database')).toBe('database');
    expect(docTypeToField('deployment')).toBe('deployment');
  });

  it('모든 14개 DocType이 빈 문자열이 아닌 필드로 매핑된다 (전수)', () => {
    for (const doc of DOCUMENTS) {
      const field = docTypeToField(doc.key);
      expect(field).toBeTruthy();
      // 매핑 결과가 docType 그대로면(단어형) 하이픈이 없어야 함
      if (field === doc.key) expect(doc.key).not.toContain('-');
    }
  });
});

describe('DEPENDENCIES 무결성', () => {
  it('모든 의존성이 실제 DocType을 가리킨다 (오타 없음)', () => {
    const keys = new Set(DOCUMENTS.map((d) => d.key));
    for (const [doc, deps] of Object.entries(DEPENDENCIES)) {
      expect(keys.has(doc as never)).toBe(true);
      for (const dep of deps) expect(keys.has(dep as never)).toBe(true);
    }
  });

  it('순환 의존성이 없다 (위상정렬 가능)', () => {
    const allKeys = DOCUMENTS.map((d) => d.key);
    const remaining = new Set(allKeys);
    let progressed = true;
    while (remaining.size > 0 && progressed) {
      progressed = false;
      for (const k of [...remaining]) {
        const depsLeft = (DEPENDENCIES[k] || []).filter((d) => remaining.has(d));
        if (depsLeft.length === 0) {
          remaining.delete(k);
          progressed = true;
        }
      }
    }
    expect(remaining.size).toBe(0); // 다 비워지면 순환 없음
  });
});
