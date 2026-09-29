# 첫 PRD 생성 경로 수정 검증

요약 화면의 `PRD 생성하기`는 이전 단일 API 호출과 잘못된 `{ prd }` 응답 해석을 사용해 타임아웃 또는 빈 본문을 만들었다. 공통 생성 잡으로 전환해 PRD 15개 섹션을 조립·저장하고, 최초 생성은 PRD만 실행한다. 이후 전체 생성을 누르면 기존 PRD를 보존하며 나머지 13종을 만든다.

- 기반: origin/main `37ff95f` + 안드로이드 동기화 수정본.
- 수정 전 브라우저 재현: 6개 중 4개 실패(본문 없음, 단일 요청, 섹션 누락, 회의 ID 누락).
- 수정 후 실제 클라이언트 흐름: 9/9 통과. 제어된 API 응답을 사용했으며 유료 AI 호출은 없다.
- 전체 단위 테스트: 295/295 통과.
- 변경 파일 ESLint, 프로덕션 빌드·타입 검사 통과.
- 운영 모델 실측은 운영 배포에서 별도로 실행했다. 이 수정본은 아직 배포하지 않았다.

근거: `summary-prd-before.json`, `summary-prd-after.json`, `summary-prd-tests.json`, `summary-prd-build.log`. 재현 도구: `summary-prd-check.mjs`. 통합 수정 패치: `release-candidate.patch`.
