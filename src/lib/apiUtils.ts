/**
 * API 관련 유틸리티 함수
 */

/**
 * OpenAI API 키가 누락된 경우 사용자에게 알림
 */
export function showApiKeyMissingAlert(): void {
  alert(
    '⚠️ OPENAI_API_KEY가 설정되지 않았습니다!\n\n' +
      '.env.local 파일에 다음 내용을 추가하세요:\n' +
      'OPENAI_API_KEY=sk-your-key-here\n\n' +
      'API 키는 https://platform.openai.com/api-keys 에서 받을 수 있습니다.'
  );
}

/**
 * API 응답에서 오류를 처리하고 메시지를 반환
 * @param response - Fetch 응답 객체
 * @param defaultErrorMessage - 기본 오류 메시지
 * @throws 오류가 포함된 Error 객체
 */
export async function handleApiError(
  response: Response,
  defaultErrorMessage: string = '요청 처리 실패'
): Promise<never> {
  const errorData = await response.json().catch(() => ({ error: defaultErrorMessage }));

  // API 키 누락 특별 처리
  if (errorData.error === 'OPENAI_API_KEY_MISSING') {
    showApiKeyMissingAlert();
    throw new Error('API 키 누락');
  }

  throw new Error(errorData.error || defaultErrorMessage);
}

/**
 * OpenAI API 키 누락 여부 확인
 */
export function isApiKeyMissing(errorData: { error?: string }): boolean {
  return errorData.error === 'OPENAI_API_KEY_MISSING';
}
