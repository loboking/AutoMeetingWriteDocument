# PRD: 데이터 저장 및 관리 구조 개편

## 1. 개요 (Overview)

회의 자동화 문서 생성 앱(MeetingAutoDocs)의 데이터 영속성 및 프로젝트 관리 기능을 강화하여, 사용자가 생성한 모든 문서를 안전하게 저장하고 추후 수정할 수 있도록 한다.

### 배경
- 현재 `currentMeeting`만 존재하며, 완료된 프로젝트가 `meetings` 배열에 자동 저장되지 않음
- 11개 문서 타입이 Meeting 타입에 정의되지 않아 데이터 누락 위험
- 새로고침 시 AI로 생성한 문서가 소실되는 문제

---

## 2. 핵심 사항 (Key Points)

### 2.1 현재 문제점

| 문제 | 상세 | 영향 |
|------|------|------|
| `currentMeeting` 미저장 | persist에서 제외됨 | 새로고침 시 진행 중인 회의 데이터 소실 |
| 문서 타입 미정의 | 11개 문서 필드 없음 | 타입 안전성 보장 안 됨 |
| 자동 저장 부재 | meetings 배열에 추가 로직 없음 | 완료 프로젝트 관리 불가 |
| 프로젝트 목록 부재 | UI가 없음 | 과거 프로젝트 접근 불가 |

### 2.2 요구사항

1. **11개 문서 타입 정의**: PRD, 기능목록, 화면목록, IA, 와이어프레임, 스토리보드, 사용자스토리, WBS, API명세, 테스트계획, 배포가이드
2. **자동 저장**: 문서 생성 시 meetings 배열에 자동 추가
3. **프로젝트 목록 UI**: 완료된 프로젝트 조회 및 선택
4. **데이터 영속성**: localStorage에 모든 데이터 저장

---

## 3. 의사결정 (Decisions)

### 3.1 기술 결정

| 항목 | 결정 | 이유 |
|------|------|------|
| 저장소 | localStorage (유지) | 클라이언트 사이드 앱, 별도 백엔드 없음 |
| 상태 관리 | Zustand + persist (유지) | 기존 코드와 호환 |
| 11개 문서 저장 | Optional 필드로 추가 | 모든 문서가 필수는 아님 |
| currentMeeting 저장 | persist에 포함 | 새로고침 방지 |

### 3.2 데이터 모델

```typescript
interface Meeting {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt?: Date;
  duration?: number;
  audioUrl?: string;
  transcript?: string;
  summary?: MeetingSummary;
  step: MeetingStep;

  // 11개 문서 타입
  prd?: string;
  featureList?: string;
  screenList?: string;
  ia?: string;
  wireframe?: string;
  storyboard?: string;
  userStory?: string;
  wbs?: string;
  apiSpec?: string;
  testPlan?: string;
  deployment?: string;

  // 메타데이터
  isCompleted?: boolean;
  tags?: string[];
}
```

### 3.3 persist 설정 변경

```typescript
// 기존
{
  name: 'meeting-storage',
  partialize: (state) => ({ meetings: state.meetings }),
}

// 변경
{
  name: 'meeting-storage',
  partialize: (state) => ({
    meetings: state.meetings,
    currentMeeting: state.currentMeeting, // 추가
  }),
}
```

---

## 4. Action Items

| 작업 | 담당 | 우선순위 | 기한 |
|------|------|----------|------|
| Meeting 타입에 11개 문서 필드 추가 | 개발 | high | v1.0 |
| persist 설정에 currentMeeting 추가 | 개발 | high | v1.0 |
| saveCurrentMeeting() 액션 구현 | 개발 | high | v1.0 |
| 문서 생성 시 자동 저장 로직 추가 | 개발 | high | v1.0 |
| 프로젝트 목록 UI 컴포넌트 개발 | 개발 | medium | v1.1 |
| 프로젝트 복사/삭제 기능 | 개발 | low | v1.2 |

---

## 5. UI/UX 흐름

### 5.1 프로젝트 목록 화면

```
┌─────────────────────────────────────────┐
│  MeetingAutoDocs                        │
├─────────────────────────────────────────┤
│  [새 회의]  [완료된 프로젝트 ▼]         │
├─────────────────────────────────────────┤
│  완료된 프로젝트                        │
│                                         │
│  📋 A 프로젝트      2026-04-09  [보기]  │
│  📋 B 프로젝트      2026-04-08  [보기]  │
│  📋 C 프로젝트      2026-04-07  [보기]  │
│                                         │
│  [총 3개 프로젝트]                     │
└─────────────────────────────────────────┘
```

### 5.2 데이터 흐름

```
1. 회의 생성
   ↓ createMeeting(title)
   currentMeeting 설정

2. 문서 생성
   ↓ generateDocument()
   updateCurrentMeeting({ prd: "..." })
   ↓ saveCurrentMeeting() [NEW]
   meetings 배열에 추가

3. 프로젝트 완료
   ↓ completeMeeting()
   currentMeeting 초기화
   meetings에서 확인 가능
```

---

## 6. 구현 우선순위

### Phase 1: 데이터 영속성 (v1.0)

1. Meeting 타입 확장 (11개 문서 필드)
2. persist 설정 수정
3. saveCurrentMeeting 액션 구현
4. PrdViewer에서 자동 저장 호출

### Phase 2: 프로젝트 관리 (v1.1)

1. ProjectList 컴포넌트 개발
2. 프로젝트 선택/로드 기능
3. 프로젝트 삭제 기능

### Phase 3: 고급 기능 (v1.2)

1. 프로젝트 복사 (템플릿화)
2. 태그/필터 기능
3. 내보내기/가져오기 (JSON)

---

## 7. 성공 지표

- [ ] 새로고침 후에도 currentMeeting 유지
- [ ] 11개 모든 문서가 정상 저장됨
- [ ] 완료된 프로젝트 목록에서 과거 회의 조회 가능
- [ ] localStorage 크기가 5MB 이내로 유지됨

---

## 8. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| localStorage 크기 초과 | 문서 저장 실패 | audioUrl은 별도 처리, 큰 텍스트는 압축 고려 |
| 타입 호환성 깨짐 | 기존 데이터 소실 가능 | 마이그레이션 로직 필요 |
| 날짜 직렬화 문제 | Date → string 변환 | zustand persist 자동 처리 확인 |

---

## 9. 참고 파일

- `src/types/index.ts` - 타입 정의
- `src/store/meetingStore.ts` - 상태 관리
- `src/components/PrdViewer.tsx` - 문서 생성 UI
