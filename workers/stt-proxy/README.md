# stt-proxy (Cloudflare Workers)

Gemini 오디오 STT 프록시. Vercel 함수 300s 한계를 우회해 59분 회의록 처리(301s+).

## 목적
- Vercel `maxDuration=300` 으로 Gemini generateContent가 301s+ 걸리면 타임아웃 → STT 실패.
- Workers는 HTTP-triggered에 wall clock hard limit 없음, `fetch()` 대기는 CPU time 제외.
- 클라이언트 → Workers 직접 호출(Vercel 경유 X → 300s 재발 안 함).

## 아키텍처
```
Browser  --(JWT + signedUrl)-->  Workers  --(API key)-->  Gemini File API + generateContent
   |                               |
   |   (폴백)                       +-- 401/에러 시 클라가 /api/transcribe (Vercel) 로 폴백
   |
   +-- Vercel 라우트 유지(작은 파일, Whisper, Workers 장애 시)
```

## 배포
```bash
cd workers/stt-proxy
npm install
npx wrangler login            # 최초 1회
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler deploy
```

배포 후 출력된 URL(예: `https://stt-proxy.<account>.workers.dev`)을 메인 프로젝트 `.env.local` 에:
```
NEXT_PUBLIC_WORKERS_STT_URL=https://stt-proxy.xxx.workers.dev
```

## 로컬 개발
```bash
cd workers/stt-proxy
npm install
npx wrangler dev --port 8787
# 별도 터미널에서 .dev.vars 파일에 GEMINI_API_KEY=... 등 넣고 wrangler dev 실행
```

## 제약 (Workers Free)
- **subrequest 50회/요청** → File API 폴링 3s 간격 15회(45s)로 캡. 45s 내 ACTIVE 안 되면 504.
- 응답 바디: 제한 없음(512MB CDN Free).
- CPU time: `fetch()` 대기는 제외. Gemini 프록시 코드 자체는 수 ms.

## 인증
- 클라이언트: `Authorization: Bearer <Supabase access_token>` (메인 앱 세션 토큰 그대로).
- Workers: `supabase.auth.getUser(token)` 으로 검증 → 401 또는 진행.

## 엔드포인트
- `POST /` — 본문 `{ signedUrl, language }`. 응답: `{ text, segments, duration, language, provider, hasSpeakerDiarization }`.
- `GET /health` — 상태 확인. `{ ok: true }`.
