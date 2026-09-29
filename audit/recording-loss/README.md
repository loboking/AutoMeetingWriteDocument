# 녹음 유실 경로 수정 검증 (2026-09-29)

가짜 마이크(Chrome `--use-fake-device-for-media-stream`)로 실제 MediaRecorder·IndexedDB 경로를 돌린다. 유료 AI·실계정·운영 DB 없음. 업로드/전사 API는 503으로 고정해 "전사 실패 → 오디오 보존" 분기를 재현한다.

## 실행

```bash
NEXT_PUBLIC_SUPABASE_URL=https://sync-test.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon TURBOPACK=0 npx next dev -p 12003
node audit/recording-loss/record-check.mjs
```

## 검증 항목 (9/9 통과)

| 항목 | 수정 전 문제 |
|---|---|
| 녹음 중 다른 탭("파일 업로드") 전환 후에도 녹음 계속 | VoiceRecorder 언마운트로 마이크 종료, 경고 없음 |
| IndexedDB v2 + `sessionId` 인덱스 | 복구/삭제가 전체 `getAll()` → 장시간 녹음에서 폰 메모리 초과 |
| 전사 실패 후 백업 보존 | (기존 동작 유지 확인) |
| "녹음 파일 저장" 버튼·다운로드 | 원본을 기기로 꺼낼 방법 없음 |
| 이어서 녹음 → 파트 1로 저장, 파트 0 보존 | seq 재시작으로 기존 청크 덮어씀 + webm 헤더 이어붙임 |
| 새로고침 → 복구 → 이어서 녹음 → 파트 2 | 복구 후 `seq=1`부터 덮어씀 |
| 페이지 오류 0 | |

## 수정 파일

- `src/lib/recordingBackup.ts` — 파트 단위 키, sessionId 인덱스, `storage.persist()`
- `src/hooks/useRecorder.ts` — 파트 관리, 마이크 끊김/오류 감지(`track.onended`, `onerror`), 1초 청크
- `src/components/MeetingRecorder.tsx` — 파트별 전사 후 텍스트 결합, 중단 배너, 저장 버튼, 음성 탭 `keepMounted`

## 남은 한계

- 화면 잠금·백그라운드 중 계속 녹음은 웹 한계(네이티브 foreground service 필요). 잠금 전까지 분량은 백업됨.
- 마이크 끊김 감지는 실기기에서 확인 필요(가짜 장치로는 `onended` 유발 불가).
- 파트가 2개 이상이면 화자/타임스탬프 세그먼트는 전달하지 않음(파트 간 오프셋 미상).
