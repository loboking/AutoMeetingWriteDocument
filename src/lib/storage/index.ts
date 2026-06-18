// 녹음 임시 저장소 팩토리. 컴포넌트/라우트는 구현체를 직접 import하지 말고 이 팩토리만 쓴다
// (STT의 getServerProvider와 동일 컨벤션). 추후 Google Drive는 여기서 분기해 추가한다.
import { SupabaseRecordingStorage } from './supabaseStorage';
import type { RecordingStorage } from './types';

export type { RecordingStorage, UploadResult, RecordingStorageName } from './types';
export { NO_RECORDING_STORAGE } from './types';

// 클라이언트 기본 저장소. 현재 Supabase 고정.
// ── 추후 Drive 확장 지점 ──
//   사용자가 Drive 연결을 켜면 GoogleDriveRecordingStorage를 반환하도록 분기.
//   예) if (await isDriveLinked()) return new GoogleDriveRecordingStorage();
export function getRecordingStorage(): RecordingStorage {
  return new SupabaseRecordingStorage();
}
