// PRD 섹션 후처리: 프롬프트 누출 제거 + 중국어(한자) 정리
// GLM은 중국 모델이라 한국어 출력 중 한자가 섞이거나(예: 上述, 心理)
// 프롬프트 지시어("작성 가이드" 등)가 그대로 누출될 수 있어 조립 전에 정리한다.

// 흔한 한자어 → 한국어 치환 (의미 보존). 여기 없는 한자는 제거된다.
const HANJA_MAP: Record<string, string> = {
  上述: '위에서 언급한',
  前述: '앞에서 언급한',
  下記: '아래',
  上記: '위',
  心理: '심리',
  該当: '해당',
  該當: '해당',
  関連: '관련',
  関聯: '관련',
  対応: '대응',
  対象: '대상',
  確保: '확보',
  構築: '구축',
  運営: '운영',
  処理: '처리',
  実装: '구현',
  最適化: '최적화',
  自動化: '자동화',
};

// 제거할 프롬프트 누출 라인 (이 문구로 시작하거나 포함하면 해당 라인 삭제)
const LEAK_PATTERNS: RegExp[] = [
  /^작성\s*섹션\s*:/,
  /^##?\s*작성\s*가이드\s*$/,
  /^##?\s*원본\s*회의\s*내용\s*$/,
  /^##?\s*회의\s*정보\s*$/,
  /^##?\s*회의\s*요약\s*$/,
  /^##?\s*구체적\s*추출\s*가이드/,
  /^##?\s*기능\s*요구사항\s*참고\s*$/,
];

export function sanitizeSectionContent(content: string): string {
  if (!content || !content.trim()) return '';

  // 1) 프롬프트 누출 라인 제거
  const kept = content
    .split('\n')
    .filter((line) => !LEAK_PATTERNS.some((re) => re.test(line.trim())));

  let out = kept.join('\n');

  // 2) 한자 치환 (사전 우선 적용)
  for (const [hanja, korean] of Object.entries(HANJA_MAP)) {
    if (out.includes(hanja)) {
      out = out.split(hanja).join(korean);
    }
  }

  // 3) 남은 단독 한자(CJK Unified Ideographs) 제거
  //    - 일본어 가나(ぁ-ヿ)도 함께 제거 (GLM이 드물게 섞음)
  //    - 한글/영문/숫자/마크다운 기호는 보존
  out = out.replace(/[一-鿿぀-ヿ]+/g, '');

  // 3-1) 한자 제거로 생긴 이중 공백 정리 (줄 앞 들여쓰기·표 정렬은 보존하려고
  //      "글자 사이" 이중 공백만 단일 공백으로, 구두점 앞 공백 제거)
  out = out.replace(/(\S) {2,}(\S)/g, '$1 $2').replace(/ +([,.)\]}])/g, '$1');

  // 4) 앞뒤 공백 라인 정리 (중간 빈 줄은 마크다운 단락 구분이라 보존)
  return out.replace(/^\s*\n/g, '').replace(/\n\s*$/g, '').trim();
}
