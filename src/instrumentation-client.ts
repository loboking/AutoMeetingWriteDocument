// 클라이언트 에러 모니터링 (Sentry 신컨벤션). DSN 미설정이면 사실상 no-op.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0, // 트레이싱 끔 (베타: 에러만)
    sendDefaultPii: false,
    // 회의 본문/녹취록 등 민감정보가 에러 컨텍스트로 새지 않게 스크럽
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = '[scrubbed]';
      }
      return event;
    },
  });
}

// 라우터 네비게이션 계측 (Sentry 권장)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
