# 테스트·문서 검토 자료

이 저장소를 내려받으면 아래 자료를 다른 컴퓨터에서도 확인할 수 있습니다. 모든 명령은 저장소 루트에서 실행합니다.

| 자료 | 위치 | 설명 |
|---|---|---|
| 단가표·비용 계산 | [model-bench/README.md](model-bench/README.md) | 이전 실측 토큰으로 환산한 금액과 전체 생성 비용 추정 구분 |
| 모델 생성 원문 | [model-bench/full-luna](model-bench/full-luna/) | 문서별 원문, 요약, 호출 기록 |
| 다운로드 검토본 96개 | [download-review/files](download-review/files/) | 16개 원문 × Word·PDF·PPT·Excel·Markdown·TXT |
| 다운로드 검사 | [download-review/final-check.json](download-review/final-check.json) | 파일 구조·다이어그램 검사 결과 |
| 문서 서식 레퍼런스 | [export-template/output](export-template/output/) | Word·PDF 예시 |
| 추가 생성·다이어그램 검증 | [generation-verification](generation-verification/) | 별도 회의 입력으로 검증한 결과 및 그림 |
| 기기 요약 시험 | [local-summary](local-summary/) | 브라우저 시험 코드와 결과. 품질 문제로 기본 비활성화 |

## 해석 시 주의할 사항

- 다운로드 폴더의 `00_먼저읽어주세요.txt`, `00_검토결과.txt`를 먼저 확인하세요.
- 식단앱 PRD는 9개 섹션이 누락됐고, 해당 회의의 테스트계획서는 생성에 실패했습니다. 문서관리 MVP의 PRD는 개요만 생성한 별도 시험입니다. 96개 검토본을 완성된 14종 한 세트로 해석하면 안 됩니다.
- 생성 시점의 `model-bench/full-luna/run.log`는 테스트 성공으로 표시되어도 문서 전체 성공을 뜻하지 않습니다. 실제 상태는 `result.json`에 기록됐으며, 현재 벤치마크는 부분 생성·실패가 있으면 실패로 판정하도록 수정됐습니다.
- 기기 요약의 `type: complete` 또는 `ok: true`는 실행·형식 검사 통과를 뜻합니다. 내용 정확성 통과가 아닙니다. 미확정을 확정으로 뒤집거나 할 일을 누락한 사례 때문에 `NEXT_PUBLIC_ENABLE_LOCAL_SUMMARY`는 기본 `false`입니다.
- 사용량 DB 확장 SQL은 `supabase/token_usage_cache_metrics.sql`입니다. Git push와 운영 DB 적용은 별개입니다.

## 재검증

```sh
npm ci
npm test
node audit/download-review/final-check.mjs
node audit/download-review/check-markers.mjs
```

다운로드 파일의 기본 위치는 저장소 내 `audit/download-review/files`입니다. 기존 검토 결과는 보존하고 새 내보내기가 필요할 때만 `export-all.mjs`를 실행하세요. 출력 위치는 `EXPORT_REVIEW_DIR`로 지정할 수 있습니다.

브라우저 검증 스크립트는 로컬 Chrome과 Playwright/Vite를 사용합니다. PDF 재생성·검사에는 `pdfinfo`가 필요합니다. 실제 모델 벤치마크 및 `generation-verification/live.test.ts`는 유료 API를 호출하므로 일반 자동 테스트와 분리되어 있습니다. 기기 요약 시험은 WebGPU 및 모델 다운로드가 필요하며, `check-built.mjs`는 먼저 생성한 `.next` 빌드를 사용합니다.
