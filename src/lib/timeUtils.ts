/**
 * 시간 관련 유틸리티 함수
 */

/**
 * 초를 MM:SS 형식으로 변환
 * @param seconds - 변환할 초 단위 시간
 * @returns MM:SS 형식의 문자열
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 밀리초를 HH:MM:SS 형식으로 변환
 * @param ms - 변환할 밀리초 단위 시간
 * @returns HH:MM:SS 형식의 문자열
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
