// OpenAI 호환(GLM/OpenAI/Gemini) 응답에서 본문 추출.
// GLM-5: content에 한글 답변, reasoning_content에 영어 사고과정 → content 우선, 비면 reasoning fallback.
// (generate-doc/stream/summarize/refine/extract-metadata에 4중 중복됐던 로직 단일화)
export function extractContent(
  message: { content?: string | null; reasoning_content?: string | null } | undefined
): string {
  if (!message) return '';
  const content = (message.content || '').trim();
  if (content) return content;
  return (message.reasoning_content || '').trim();
}
