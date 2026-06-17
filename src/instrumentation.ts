// 서버/엣지 에러 모니터링 (Sentry 신컨벤션). DSN 미설정이면 no-op.
import * as Sentry from '@sentry/nextjs';

export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = '[scrubbed]';
      }
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;
