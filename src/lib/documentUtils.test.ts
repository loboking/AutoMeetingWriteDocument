import { describe, it, expect } from 'vitest';
import { docTypeToField, DEPENDENCIES, DOCUMENTS, getDirectParentTitles, getStaleParents, type DocType } from './documentUtils';

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

describe('getDirectParentTitles', () => {
  it('직계 부모(1-hop)만 한글 제목으로 반환한다', () => {
    // test-case 의존: feature-list, api-spec, test-plan
    expect(getDirectParentTitles('test-case')).toEqual(['기능목록', 'API명세', '테스트계획']);
  });

  it('의존성 없는 문서는 빈 배열', () => {
    expect(getDirectParentTitles('prd')).toEqual([]);
    expect(getDirectParentTitles('feature-list')).toEqual([]);
  });
});

describe('getStaleParents', () => {
  const emptyDocs = Object.fromEntries(DOCUMENTS.map((d) => [d.key, ''])) as Record<DocType, string>;

  it('존재하면서 outdated인 직계 부모만 반환', () => {
    const docs = { ...emptyDocs, 'feature-list': '내용', 'api-spec': '내용' };
    // feature-list만 outdated, api-spec은 latest
    const getStatus = (d: DocType) => (d === 'feature-list' ? 'outdated' : 'latest');
    expect(getStaleParents('api-spec', docs, getStatus)).toEqual(['feature-list']);
  });

  it('부모가 존재하지 않으면(본문 없음) stale로 보지 않음', () => {
    const getStatus = () => 'outdated';
    // feature-list 본문 없음 → stale 아님
    expect(getStaleParents('api-spec', emptyDocs, getStatus)).toEqual([]);
  });

  it('모든 부모가 latest면 빈 배열', () => {
    const docs = { ...emptyDocs, 'feature-list': '내용' };
    const getStatus = () => 'latest';
    expect(getStaleParents('api-spec', docs, getStatus)).toEqual([]);
  });
});
