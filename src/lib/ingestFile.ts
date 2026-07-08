// 파일 → 텍스트 변환 공통 로직. page.tsx와 FileUploader.tsx 양쪽에서 사용.
// 분류(routeInputFile) → 검증(validateAudio) → 변환(audio|document) 까지.
// UI 상태·회의 생성 등 각 호출처의 고유 처리는 여기에 포함하지 않는다.
import { routeInputFile } from '@/lib/inputRouter';
import { validateAudio } from '@/lib/stt/audioValidation';
import { transcribeAudio, type TranscribeDeps, type TranscribeResult } from '@/lib/transcribeAudio';
import { authedFetch } from '@/lib/authFetch';

const MAX_DOC_SIZE = 50 * 1024 * 1024; // 50MB (텍스트 문서 업로드 상한)

export type FileKind = 'audio' | 'document';

export interface IngestResult extends TranscribeResult {
  kind: FileKind;
  /** audio 파일 로컬 재생 URL. audio일 때만 반환, 사용 후 revokeObjectURL 필수. */
  audioObjectUrl?: string;
}

/**
 * 파일 하나를 받아 텍스트와 메타데이터를 반환한다.
 * 실패 시 Error를 throw한다 (호출처에서 catch하여 UI 처리).
 */
export async function ingestFile(file: File, deps: TranscribeDeps): Promise<IngestResult> {
  const kind = routeInputFile({ name: file.name, type: file.type });

  if (kind === 'unsupported') {
    throw new Error('지원하지 않는 파일 형식입니다. (음성: mp3/wav/webm/m4a, 문서: txt/md/pdf/docx/xlsx) — pptx/doc/xls는 미지원');
  }

  if (kind === 'audio') {
    const v = validateAudio({ name: file.name, type: file.type, size: file.size });
    if (!v.ok) throw new Error(v.error || '오디오 파일을 처리할 수 없습니다.');

    const result = await transcribeAudio(file, 'ko', deps);
    return {
      kind: 'audio',
      text: result.text,
      segments: result.segments,
      duration: result.duration,
      audioObjectUrl: URL.createObjectURL(file),
    };
  }

  // document
  if (file.size > MAX_DOC_SIZE) {
    throw new Error(`파일 크기는 ${MAX_DOC_SIZE / 1024 / 1024}MB 이하여야 합니다.`);
  }

  const formData = new FormData();
  formData.append('document', file);
  const response = await authedFetch('/api/extract-text', { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '파일 처리 실패' }));
    throw new Error(err.error || '파일 처리 실패');
  }
  const { text } = await response.json();
  if (!text || !text.trim()) throw new Error('추출된 텍스트가 비어 있습니다.');

  return { kind: 'document', text };
}
