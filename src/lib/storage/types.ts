// 녹음 임시 저장소 추상화.
// 변환(STT) 목적으로 오디오를 잠깐 올렸다 → 서버가 읽을 URL을 만들고 → 변환 후 삭제한다.
// STT provider 패턴(stt/types.ts)과 동일하게 구현체를 갈아끼울 수 있게 한다.
// 현재 구현: Supabase Storage. 추후: Google Drive 등(구현체만 추가).

export type RecordingStorageName = 'supabase' | 'google-drive';

export interface UploadResult {
  ref: string; // 저장소 내부 참조(Supabase=object path, Drive=fileId 등). 삭제/URL생성에 사용.
}

// 변환용 임시 저장소. 영구 보관이 아니라 "올림 → 읽을URL → 삭제" 라이프사이클만 책임진다.
export interface RecordingStorage {
  readonly name: RecordingStorageName;
  // 오디오 Blob/File을 업로드하고 내부 참조(ref)를 반환.
  upload(blob: Blob, opts?: { contentType?: string }): Promise<UploadResult>;
  // 서버가 fetch할 수 있는 임시 읽기 URL(서명 URL 등). ttlSec=수명(초).
  getReadableUrl(ref: string, ttlSec: number): Promise<string>;
  // 변환용 임시 사본 삭제(베스트에포트 — 실패해도 throw 안 함, 호출부가 결정).
  delete(ref: string): Promise<void>;
}

// 저장소 부재/미설정 시 에러 코드(키 없는 STT의 NO_STT_PROVIDER와 동일 컨벤션).
export const NO_RECORDING_STORAGE = 'NO_RECORDING_STORAGE';
