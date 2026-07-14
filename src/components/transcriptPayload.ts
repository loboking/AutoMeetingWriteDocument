// 회의록 모드(②)에서 입력 컴포넌트(VoiceRecorder/FileUploader/TextInput)가
// 부모(MeetingRecorder)로 올려보내는 전사 결과 페이로드.
// Meeting store를 거치지 않고 부모가 직접 MeetingNote로 확정 — ① 기획서 currentMeeting 오염 방지.
import type { TranscriptSegment } from '@/lib/stt/types';

export interface TranscriptPayload {
  text: string;
  segments?: TranscriptSegment[];
  duration?: number;
  audioUrl?: string;
}
