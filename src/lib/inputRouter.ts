// 업로드 파일을 입력 종류로 분류한다. page.tsx가 음성↔텍스트를 올바른 API로 보내는 근거.
// 규칙: MIME(audio/*) 우선 → 확장자(음성) → 확장자(텍스트) → unsupported.

export type InputKind = 'audio' | 'text' | 'unsupported';

const AUDIO_EXT = new Set(['mp3', 'wav', 'webm', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'mp4']);
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'pdf']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function routeInputFile(file: { name: string; type: string }): InputKind {
  const type = (file.type || '').toLowerCase();
  // MIME 우선 (확장자가 엉뚱해도 실제 콘텐츠 타입을 신뢰)
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || type.startsWith('text/')) return 'text';

  const ext = extOf(file.name || '');
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'unsupported';
}
