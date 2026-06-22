// 업로드 파일을 입력 종류로 분류한다. page.tsx가 음성↔텍스트를 올바른 API로 보내는 근거.
// 규칙: MIME(audio/*) 우선 → 확장자(음성) → 확장자(텍스트) → unsupported.

export type InputKind = 'audio' | 'text' | 'unsupported';

// <input accept> 힌트(파일 선택창 필터용). 실제 분류는 routeInputFile이 담당하므로
// 이 문자열은 UX 편의일 뿐 보안/정합성 기준이 아니다. 업로드 입력창 전체가 공유.
export const FILE_ACCEPT_TYPES =
  'audio/*,.mp3,.wav,.webm,.m4a,.ogg,.oga,.flac,.aac,.mp4,.txt,.md,.markdown,.pdf,.docx,.xlsx,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const AUDIO_EXT = new Set(['mp3', 'wav', 'webm', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'mp4']);
// 서버 extract-text가 실제 추출하는 문서 확장자. pptx/doc/xls는 미포함 → unsupported.
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'pdf', 'docx', 'xlsx']);

// 문서 MIME (확장자가 엉뚱해도 콘텐츠 타입을 신뢰). pptx MIME은 의도적으로 제외.
const DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
]);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function routeInputFile(file: { name: string; type: string }): InputKind {
  const type = (file.type || '').toLowerCase();
  // MIME 우선 (확장자가 엉뚱해도 실제 콘텐츠 타입을 신뢰)
  if (type.startsWith('audio/')) return 'audio';
  if (DOC_MIME.has(type) || type.startsWith('text/')) return 'text';

  const ext = extOf(file.name || '');
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unsupported'; // pptx/doc/xls 등은 여기로
}
