# STT 아키텍처 개선 설계 (모바일 백그라운드 + 긴 회의 대응)

> 작성: 2026-06-18 / 상태: 설계(미구현) / 결정: "풀 설계: Blob 업로드 + 청크 분할"

## 1. 문제 정의

| # | 문제 | 근거 |
|---|------|------|
| P1 | 모바일에서 STT 중 화면 꺼짐/앱 전환 시 변환 동결 | 현재 키 주석처리 → 브라우저 STT(transformers.js)가 기기에서 추론. STT 단계엔 WakeLock 없음(`GenerationGuard`는 `isGenerating`만). |
| P2 | 서버 Whisper로 전환해도 긴 회의는 413 실패 | Vercel 함수 바디 **4.5MB**(~음성 5~8분) 한계. `transcribe/route.ts`는 직접 POST 구조. |
| P3 | 회의 길이 편차 큼(5분~수 시간) | 단일 방법으로 커버 불가. Whisper 파일당 25MB, Supabase Storage 무료 50MB/총 1GB. |

## 2. 확정된 환경 제약 (리서치 완료)

- **Vercel 함수 바디**: 4.5MB 초과 → `413 FUNCTION_PAYLOAD_TOO_LARGE`. 우회 = 클라가 스토리지에 직접 업로드 후 URL/경로만 서버 전달.
- **Vercel maxDuration**: Fluid compute로 Hobby/Pro 기본 300초. (현재 `transcribe`엔 설정 누락 → 추가 필요)
- **Whisper(whisper-1)**: $0.006/분(시간당 약 50원), 파일당 25MB(~30분).
- **Supabase Storage 무료 플랜**: 파일당 50MB, 총 1GB. → 긴 회의 = 청크 + 변환 후 원본 삭제 필수.
- **이미 보유**: `@supabase/supabase-js`, 인증 세션(RLS), `@huggingface/transformers`, `openai`. → 신규 스토리지 SDK 불필요.

## 3. 목표 아키텍처 (길이 적응형 2-트랙)

```
                       ┌─ 녹음(MediaRecorder)
[클라이언트] ──────────┤
                       └─ 파일 업로드(기존 오디오 파일)

  ─ 짧음(≤ ~24MB / ~25분):
      Supabase Storage 직접 업로드(1파일) → /api/transcribe 가 storagePath 받아
      서명 URL로 다운로드 → Whisper 1회 → 텍스트 반환 → 원본 삭제

  ─ 긺(> 24MB / 수 시간):
      [녹음] 처음부터 N분(기본 10분) 단위로 MediaRecorder stop→start 재시작
             → 자연스러운 조각 생성(사후분할/ffmpeg.wasm/padding 회피)
      [파일] WebAudio 디코딩 → PCM N분 슬라이스(메모리 가드: 스트리밍 디코딩 한계 시 브라우저STT 폴백 안내)
      각 조각 → Storage 업로드 → /api/transcribe 청크모드 → 텍스트 누적 → 원본 삭제
      진행률 = (완료 청크 / 총 청크)

  ─ 키 없음(폴백): 기존 브라우저 STT(짧은 회의 한정, 경고 표시)
```

### 왜 "사후 분할" 대신 "녹음 시 분할"인가
- webm/opus는 컨테이너 레벨 무손실 분할이 어렵고(packet boundary, discard padding) Whisper에 먹이려면 어차피 디코딩 필요.
- 녹음을 처음부터 타이머로 끊으면 각 조각이 독립적으로 유효한 webm → 디코딩/재인코딩 없이 그대로 업로드 가능. 가장 견고하고 메모리 안전.

## 4. 단계별 구현 계획 (독립 배포 가능 단위)

### Phase 0 — 서버 Whisper 활성화 + 안전망 (즉시, 작음)
- [ ] `.env.local` `OPENAI_API_KEY` 주석 해제(사용자 작업) / Vercel 환경변수 설정
- [ ] `transcribe/route.ts`에 `export const maxDuration = 300` 추가
- [ ] 모델 선택: `whisper-1` 유지(또는 `gpt-4o-mini-transcribe` 비용 절반 검토)
- 효과: 5~8분 이내 회의는 즉시 서버 변환(백그라운드 안전). **단 긴 회의는 아직 413.**

### Phase 1 — 저장소 추상화 + Supabase Storage 직접 업로드 ✅ (구현 완료 2026-06-18)
- [x] 저장소 추상화: `src/lib/storage/{types,supabaseStorage,index}.ts`
      RecordingStorage 인터페이스(upload/getReadableUrl/delete) + 팩토리 getRecordingStorage()
      → STT provider 패턴과 동일. **컴포넌트/라우트는 팩토리만 의존(직접 import 금지).**
- [x] 공용 헬퍼 `src/lib/transcribeAudio.ts`: 업로드→서명URL(300s)→/api/transcribe(JSON)
      →(503이면 브라우저 STT 폴백)→finally에서 delete(ref)로 임시 사본 정리(고아 방지).
      저장소 업로드 실패 시 ≤4MB는 multipart 직접 POST 폴백(안전망).
- [x] `transcribe/route.ts`: JSON `{ signedUrl }` 경로 추가(SSRF 가드=Supabase 호스트만,
      50MB 가드 유지) + 기존 multipart 하위호환.
- [x] FileUploader/VoiceRecorder/page.tsx 3곳 모두 transcribeAudio 헬퍼 경유로 통일.
      audioUrl(로컬 재생)·transcriptSegments·duration 보존.
- 수동작업(배포 전 필수): `supabase/recordings-storage.sql`을 대시보드 SQL Editor에 실행
  (recordings 버킷 private 50MB + storage.objects RLS 본인폴더 INSERT/SELECT/DELETE).

#### ── 추후 Google Drive 확장 지점 ──
- `getRecordingStorage()`(storage/index.ts)에서 분기: Drive 연결 시 GoogleDriveRecordingStorage 반환.
- 컴포넌트/라우트/transcribeAudio는 **변경 불필요**(RecordingStorage 인터페이스만 의존).
- Drive 구현 시 필요: Google OAuth(Supabase provider + drive scope) + upload/getReadableUrl/delete 구현.

### Phase 2 — 청크 분할 (긴 회의 = 수 시간 대응)
- [ ] 녹음: `useRecorder`에 `chunkMinutes` 옵션 → 타이머로 stop/start 재시작, 조각 배열 관리
- [ ] 파일: WebAudio 디코딩 + PCM 슬라이스(wav 인코딩) — 메모리 한계 초과 시 명확한 안내
- [ ] 서버: 청크별 Whisper 후 텍스트 순서 보장 누적(segments 타임오프셋 보정)
- [ ] 진행률: 청크 단위 실제 진행률(시뮬레이션 대체)
- [ ] WakeLock을 STT 단계에도 확장(`isTranscribing || isGenerating`)

### Phase 3 — 정리/하드닝
- [ ] 브라우저 STT 폴백은 "키 없음 + 짧은 회의"로 한정, 긴 회의는 안내
- [ ] 고아 원본 청소(실패 잔류분) — 베스트에포트
- [ ] E2E: 5분/30분/2시간 시나리오 실측

## 5. 비용/쿼터 영향
- Whisper: 1시간 ≈ 50원, 3시간 ≈ 150원. 부담 낮음.
- Supabase Storage: 변환 후 즉시 삭제 → 정상 사용 시 1GB 충분. 동시 업로드 피크만 주의.

## 6. 범위 밖 (과설계 방지)
- 화자분리(현 MVP `speaker:'Unknown'` 유지)
- 실시간 스트리밍 STT(gpt-realtime-whisper)
- 자체 호스팅 Whisper / GPU
- Supabase Pro 업그레이드(무료 한계 내 설계)
- ffmpeg.wasm 도입(녹음시 분할로 회피)

## 7. 롤백/안전
- Phase별 독립 배포. 각 단계 실패 시 직전 단계로 폴백(키 없으면 브라우저 STT까지).
- 기존 multipart `/api/transcribe` 경로 유지 → 하위호환.
