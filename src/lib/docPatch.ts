// 문서 부분 수정(패치) 적용. AI가 "전체 재작성" 대신 작은 패치만 생성 → 빠르고 안전.
// 3종 패치: replace(find→replace), insert(after 뒤에 삽입), append(문서 끝에 추가).

export interface DocPatch {
  find?: string; // replace: 원본에서 정확히 찾을 텍스트
  replace?: string; // replace: 대체 텍스트
  after?: string; // insert: 이 텍스트 "직후"에 삽입
  insert?: string; // insert: 삽입할 텍스트
  append?: string; // append: 문서 끝에 추가할 텍스트
}

export interface PatchResult {
  content: string;
  applied: number; // 성공 적용 수
  failed: number; // 매칭 실패로 건너뛴 수
  failedFinds: string[]; // 실패한 find/after (디버깅·안내용, 앞부분만)
}

const snippet = (s: string, n = 40) => s.replace(/\s+/g, ' ').slice(0, n);

// 첫 일치만 치환(전역 치환은 의도치 않은 다중 변경 위험). 정확 일치 우선.
function replaceFirst(haystack: string, find: string, replace: string): string | null {
  const idx = haystack.indexOf(find);
  if (idx === -1) return null;
  return haystack.slice(0, idx) + replace + haystack.slice(idx + find.length);
}

export function applyPatches(original: string, patches: DocPatch[]): PatchResult {
  let content = original;
  let applied = 0;
  let failed = 0;
  const failedFinds: string[] = [];

  for (const pt of patches) {
    // 1) replace: find → replace
    if (typeof pt.find === 'string' && pt.find.length > 0 && typeof pt.replace === 'string') {
      const next = replaceFirst(content, pt.find, pt.replace);
      if (next === null) {
        failed++;
        failedFinds.push(snippet(pt.find));
      } else {
        content = next;
        applied++;
      }
      continue;
    }
    // 2) insert: after 직후에 insert
    if (typeof pt.after === 'string' && pt.after.length > 0 && typeof pt.insert === 'string') {
      const idx = content.indexOf(pt.after);
      if (idx === -1) {
        failed++;
        failedFinds.push(snippet(pt.after));
      } else {
        const pos = idx + pt.after.length;
        content = content.slice(0, pos) + pt.insert + content.slice(pos);
        applied++;
      }
      continue;
    }
    // 3) append: 문서 끝에 추가
    if (typeof pt.append === 'string' && pt.append.length > 0) {
      content = content.replace(/\s*$/, '') + '\n\n' + pt.append;
      applied++;
      continue;
    }
    // 형식 불명 패치
    failed++;
  }

  return { content, applied, failed, failedFinds };
}
