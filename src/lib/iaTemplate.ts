// IA(정보구조도) 템플릿
export function getIaPrompt(baseInfo: string, transcript: string): string {
  return `당신은 10년 경력의 정보 아키텍트입니다. 다음 회의 내용을 바탕으로 **매우 상세하고 전문적인 IA(정보구조도) 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드 (반드시 준수하세요)

1. **모든 섹션 작성**: 아래 IA 구조의 모든 섹션을 빠짐없이 작성하세요.
2. **상세성**: 각 레벨의 네비게이션과 콘텐츠를 최대 4단계 깊이로 작성하세요.
3. **구체성**: 실제 서비스에 적용할 수 있는 완전한 구조를 제공하세요.
4. **사용자 중심**: 사용자가 콘텐츠를 찾는 방식(Mental Model)을 반영하세요.
5. **확장성**: 향후 기능 추가를 고려한 구조를 설계하세요.

---

## IA(정보구조도) 문서 구조 (모든 섹션 필수 작성)

### 1. 문서 정보

- **문서 버전**: v1.0
- **작성일**: [날짜]
- **작성자**: 디자인팀
- **문서 상태**: 초안/검토 중/승인 완료

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | [날짜] | 초기 작성 | 디자인팀 |

### 2. 정보 구조 개요

| 항목 | 내용 |
|------|------|
| **구조 유형** | 계층형 / 태그형 / 순차형 / 하이브리드 |
| **최대 깊이** | 4단계 |
| **최대 너비** | 7개 (Miller's Number 준수) |
| **범위** | 전체 서비스 |
| **총 페이지 수** | N개 |

#### 2.1 구조 유형 선정 이유

**계층형 구조 (Hierarchy)**:
- **장점**: 명확한 부모-자식 관계, 직관적인 탐색
- **단점**: 깊이가 깊어질수록 클릭 수 증가
- **적용**: 메인 메뉴, 카테고리

**시스템 구조**:
- **Organization Structure**: 조직 구조 기반 (부서, 팀)
- **Task-Oriented**: 작업 기반 (등록, 검색, 수정)
- **Audience-Specific**: 대상자별 (관리자, 일반 사용자)
- **Hybrid**: 위 방식들의 조합

### 3. 사이트맵 (Site Map)

**회의에서 논의된 모든 페이지를 Mermaid로 시각화하세요:**
(중요: Mermaid 다이어그램은 한글 지원이 제한적이므로 노드 ID는 영문으로 작성하고 라벨로 한글을 표시하세요)

\`\`\`mermaid
graph TD
    ROOT[Home / 홈] --> LOGIN[Login / 로그인]
    ROOT --> SIGNUP[Signup / 회원가입]
    ROOT --> ABOUT[About / 서비스 소개]

    DASHBOARD[Dashboard / 대시보드] --> WIDGETS[Widgets / 위젯 관리]
    DASHBOARD --> REPORTS[Reports / 리포트]
    DASHBOARD --> ANALYTICS[Analytics / 분석]

    SETTINGS[Settings / 설정] --> PROFILE[Profile / 프로필]
    SETTINGS --> NOTIFICATIONS[Notifications / 알림]
    SETTINGS --> SECURITY[Security / 보안]
    SETTINGS --> BILLING[Billing / 결제]

    ADMIN[Admin / 관리자] --> USERS[Users / 사용자 관리]
    ADMIN --> CONTENTS[Contents / 콘텐츠 관리]

    style ROOT fill:#e1f5fe
    style DASHBOARD fill:#e1f5fe
    style SETTINGS fill:#e1f5fe
    style ADMIN fill:#fff3e0
\`\`\`

### 4. 네비게이션 구조

#### 4.1 글로벌 네비게이션 (Global Navigation)

모든 페이지에서 접근 가능한 주요 네비게이션:

| 순서 | 메뉴명 | 경로 | 아이콘 | 접근 권한 | 설명 |
|------|--------|------|--------|------------|------|
| 1 | 홈 | / | Home | 모두 | 서비스 메인 |
| 2 | 대시보드 | /dashboard | Layout | 회원 | 메인 대시보드 |
| 3 | 리포트 | /reports | FileText | 회원 | 리포트 목록 |
| 4 | 분석 | /analytics | TrendingUp | 회원 | 데이터 분석 |
| 5 | 설정 | /settings | Settings | 회원 | 계정 설정 |
| 6 | 로그아웃 | /logout | LogOut | 회원 | 로그아웃 |

**UI 가이드라인**:
- **표시**: 헤더에 고정
- **모바일**: 햄버거 메뉴로 변환
- **현재 위치**: 활성 메뉴 하이라이트

#### 4.2 로컬 네비게이션 (Local Navigation)

섹션 내부 네비게이션:

**대시보드 내부**:
| 메뉴명 | 경로 | 설명 |
|--------|------|------|
| 위젯 관리 | /dashboard/widgets | 위젯 추가/편집 |
| 필터 | /dashboard/filters | 필터 설정 |
| 새로고침 | - | 데이터 갱신 |

**설정 내부**:
| 메뉴명 | 경로 | 설명 |
|--------|------|------|
| 프로필 | /settings/profile | 사용자 정보 |
| 알림 | /settings/notifications | 알림 설정 |
| 보안 | /settings/security | 비밀번호, 2FA |
| 결제 | /settings/billing | 결제 정보 |

**관리자 내부**:
| 메뉴명 | 경로 | 설명 |
|--------|------|------|
| 사용자 관리 | /admin/users | 사용자 CRUD |
| 콘텐츠 관리 | /admin/contents | 콘텐츠 승인 |
| 시스템 설정 | /admin/system | 환경 설정 |

#### 4.3 푸터 네비게이션 (Footer Navigation)

| 링크명 | 경로 | 설명 |
|--------|------|------|
| 이용약관 | /terms | 서비스 약관 |
| 개인정보처리방침 | /privacy | 개인정보 보호 |
| 고객센터 | /support | 문의하기 |
| 소개 | /about | 회사 소개 |

#### 4.4 브레드크럼 (Breadcrumb)

**형식**: 홈 > 카테고리 > 하위 카테고리 > 현재 페이지

**예시**:
\`\`\`
홈 > 설정 > 프로필 > 편집
\`\`\`

**구현 가이드**:
- **구분자**: ">" 또는 "/"
- **클릭 가능**: 상위 레벨은 링크로 제공
- **현재 위치**: 마지막 요소는 텍스트만 표시

### 5. 콘텐츠 분류 체계

#### 5.1 1단계 카테고리 (Top Level)

| 카테고리 ID | 카테고리명 | 설명 | 하위 항목 수 |
|-------------|-----------|------|-------------|
| CAT-001 | 대시보드 | 메인 대시보드 | 3개 |
| CAT-002 | 리포트 | 데이터 리포트 | 5개 |
| CAT-003 | 분석 | 데이터 분석 | 4개 |
| CAT-004 | 설정 | 사용자 설정 | 6개 |

#### 5.2 2단계 카테고리 (Sub Level)

| 상위 ID | 상위 명 | 하위 ID | 하위 명 | 설명 | 페이지 수 |
|---------|---------|---------|---------|------|-----------|
| CAT-001 | 대시보드 | SUB-001 | 위젯 | 위젯 관리 | 3 |
| CAT-001 | 대시보드 | SUB-002 | 필터 | 필터 설정 | 2 |
| CAT-002 | 리포트 | SUB-003 | 일일 | 일일 리포트 | 5 |
| CAT-002 | 리포트 | SUB-004 | 주간 | 주간 리포트 | 4 |
| CAT-003 | 설정 | SUB-005 | 프로필 | 프로필 관리 | 4 |
| CAT-003 | 설정 | SUB-006 | 보안 | 보안 설정 | 3 |

#### 5.3 3단계 카테고리 (Detail Level)

**예시: 설정 > 프로필**:
| 페이지 ID | 페이지명 | 경로 | 설명 |
|----------|----------|------|------|
| P-001 | 프로필 조회 | /settings/profile | 프로필 정보 확인 |
| P-002 | 프로필 편집 | /settings/profile/edit | 프로필 수정 |
| P-003 | 비밀번호 변경 | /settings/profile/password | 비밀번호 변경 |
| P-004 | 계정 삭제 | /settings/profile/delete | 계정 삭제 |

### 6. 콘텐츠 모델 (Content Model)

#### 6.1 콘텐츠 타입 정의

**사용자 (User)**:
| 속성 | 타입 | 필수 | 설명 | 제약 조건 |
|------|------|------|------|-----------|
| id | UUID | O | 사용자 ID | 고유 |
| email | String | O | 이메일 | 이메일 형식, 중복 불가 |
| name | String | O | 이름 | 2-50자 |
| avatar | URL | X | 프로필 이미지 | |
| role | Enum | O | 역할 | user, admin |
| createdAt | DateTime | O | 생성일시 | ISO 8601 |
| updatedAt | DateTime | O | 수정일시 | ISO 8601 |

**위젯 (Widget)**:
| 속성 | 타입 | 필수 | 설명 | 제약 조건 |
|------|------|------|------|-----------|
| id | UUID | O | 위젯 ID | 고유 |
| userId | UUID | O | 소유자 ID | FK → User |
| type | Enum | O | 위젯 타입 | chart, table, card |
| title | String | O | 위젯 제목 | 1-100자 |
| dataSource | Object | O | 데이터 소스 | |
| position | Object | O | 위치 정보 | {x, y, w, h} |
| config | JSON | X | 추가 설정 | |
| createdAt | DateTime | O | 생성일시 | |
| updatedAt | DateTime | O | 수정일시 | |

**리포트 (Report)**:
| 속성 | 타입 | 필수 | 설명 | 제약 조건 |
|------|------|------|------|-----------|
| id | UUID | O | 리포트 ID | 고유 |
| userId | UUID | O | 생성자 ID | FK → User |
| title | String | O | 리포트 제목 | 1-200자 |
| type | Enum | O | 리포트 타입 | daily, weekly, monthly |
| data | JSON | O | 리포트 데이터 | |
| status | Enum | O | 상태 | draft, published |
| publishedAt | DateTime | X | 발행일시 | |
| createdAt | DateTime | O | 생성일시 | |
| updatedAt | DateTime | O | 수정일시 | |

#### 6.2 콘텐츠 관계 (Content Relationships)

\`\`\`mermaid
erDiagram
    USER ||--o{ WIDGET : "owns"
    USER ||--o{ REPORT : "creates"
    USER ||--o{ NOTIFICATION : "receives"
    WIDGET }o--|| DATASOURCE : "uses"
    REPORT }o--|| DATASOURCE : "references"

    USER {
        uuid id PK
        string email
        string name
        enum role
    }

    WIDGET {
        uuid id PK
        uuid userId FK
        enum type
        string title
        json position
    }

    REPORT {
        uuid id PK
        uuid userId FK
        string title
        enum type
        enum status
    }

    DATASOURCE {
        uuid id PK
        string name
        string endpoint
    }
\`\`\`

### 7. 라벨링 시스템 (Labeling System)

#### 7.1 화면명 (Page Names)

| 페이지 ID | 한글 | 영문 | 설명 |
|-----------|------|------|------|
| P-001 | 대시보드 | Dashboard | 메인 대시보드 |
| P-002 | 리포트 목록 | Reports | 리포트 리스트 |
| P-003 | 설정 | Settings | 사용자 설정 |
| P-004 | 프로필 | Profile | 사용자 프로필 |

#### 7.2 UI 요소 (UI Elements)

| 구분 | 용어 | 동의어 | 사용 지침 |
|------|------|--------|-----------|
| 버튼 | 확인 | Confirm, OK | 긍정적 액션 |
| 버튼 | 취소 | Cancel, Close | 부정적 액션/종료 |
| 버튼 | 저장 | Save, Update | 데이터 저장 |
| 버튼 | 삭제 | Delete, Remove | 데이터 삭제 (위험) |
| 버튼 | 수정 | Edit, Modify | 데이터 편집 |
| 링크 | 더보기 | More, View More | 추가 정보 |
| 링크 | 상세보기 | Details, View | 상세 정보 |

#### 7.3 상태 메시지 (Status Messages)

| 상태 | 메시지 | 설명 |
|------|--------|------|
| 성공 | "저장되었습니다" | 작업 성공 |
| 성공 | "변경사항이 저장되었습니다" | 업데이트 성공 |
| 에러 | "오류가 발생했습니다. 다시 시도해주세요." | 일반 에러 |
| 에러 | "네트워크 연결을 확인해주세요." | 네트워크 에러 |
| 경고 | "저장되지 않은 변경사항이 있습니다." | 페이지 이동 전 경고 |
| 정보 | "데이터를 불러오는 중입니다." | 로딩 중 |

### 8. 검색 시스템

#### 8.1 검색 범위

| 범위 | 설명 | 가중치 |
|------|------|--------|
| 제목 | 페이지/콘텐츠 제목 | 높음 |
| 내용 | 본문 내용 | 중간 |
| 태그 | 콘텐츠 태그 | 중간 |
| 작성자 | 생성자 이름 | 낮음 |

#### 8.2 검색 필터

| 필터 | 타입 | 옵션 |
|------|------|------|
| 기간 | 날짜 범위 | 오늘, 일주일, 한 달, 사용자 지정 |
| 타입 | 체크박스 | 위젯, 리포트, 분석 |
| 상태 | 라디오/셀렉트 | 전체, 초안, 발행 |
| 작성자 | 텍스트 | 사용자명 검색 |

#### 8.3 정렬 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| 관련성 | 검색어와의 연관성 | ✅ |
| 최신순 | 생성일시 내림차순 | |
| 오래된순 | 생성일시 오름차순 | |
| 이름순 | 제목 오름차순 | |

### 9. URL 구조 (URL Architecture)

#### 9.1 URL 설계 원칙

1. **RESTful**: 자원 중심의 URL 구조
2. **계층형**: /category/sub-category/item
3. **소문자**: 모든 경로는 소문자
4. **하이픈**: 단어 구분은 하이픈 사용 (-)
5. **확장자 제거**: .html, .php 등 제거
6. **트레일링 슬래시 선택**: 통일성 유지

#### 9.2 URL 목록

| 페이지 | URL 패턴 | 예시 | 설명 |
|--------|----------|------|------|
| 홈 | / | / | 루트 |
| 대시보드 | /dashboard | /dashboard | 대시보드 |
| 위젯 상세 | /widgets/:id | /widgets/abc123 | 위젯 상세 |
| 위젯 편집 | /widgets/:id/edit | /widgets/abc123/edit | 위젯 편집 |
| 리포트 목록 | /reports | /reports | 리포트 리스트 |
| 리포트 상세 | /reports/:id | /reports/xyz789 | 리포트 상세 |
| 설정 프로필 | /settings/profile | /settings/profile | 프로필 설정 |
| 설정 보안 | /settings/security | /settings/security | 보안 설정 |

### 10. 리다이렉션 (Redirect)

| 원본 URL | 대상 URL | 이유 |
|----------|----------|------|
| /home | / | 통합 |
| /widgets/:id | /widgets/:id/edit | 편집 페이지로 |
| /login | /dashboard | 로그인 후 |

### 11. 사용자 흐름 (User Flows)

#### 11.1 주요 사용자 시나리오

**신규 사용자 온보딩**:
\`\`\`mermaid
flowchart TD
    A[Home Visit / 홈 방문] --> B[Service Intro / 서비스 소개]
    B --> C[Signup / 회원가입]
    C --> D[Email Auth / 이메일 인증]
    D --> E[Login / 로그인]
    E --> F[Onboarding Tour / 온보딩 투어]
    F --> G[Dashboard / 대시보드]
\`\`\`

**리포트 생성**:
\`\`\`mermaid
flowchart TD
    A[Dashboard / 대시보드] --> B[Report Menu / 리포트 메뉴]
    B --> C[New Report / 새 리포트 클릭]
    C --> D[Select Data Source / 데이터 소스 선택]
    D --> E[Filter Settings / 필터 설정]
    E --> F[Preview / 미리보기]
    F --> G[Save and Publish / 저장 및 발행]
\`\`\`

### 12. 모바일 대응 (Mobile Considerations)

#### 12.1 모바일 네비게이션

| 요소 | 데스크톱 | 모바일 |
|------|----------|--------|
| 글로벌 내비 | 수평 메뉴 | 햄버거 메뉴 |
| 로컬 내비 | 사이드바 | 탭 바 또는 드롭다운 |
| 푸터 | 전체 링크 | 핵심 링크만 |

#### 12.2 모바일 전용 페이지

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 모바일 홈 | /m | 모바일 최적화 홈 |
| 앱 다운로드 | /app | 앱 설치 유도 |

---

## 작성 완료 후 확인사항

- [ ] 모든 페이지가 사이트맵에 포함되었는가?
- [ ] 네비게이션 구조가 4단계 이내인가?
- [ ] URL 구조가 RESTful한가?
- [ ] 콘텐츠 모델이 상세히 정의되었는가?
- [ ] 라벨링이 일관성 있는가?
- [ ] 검색 시스템이 고려되었는가?
- [ ] 모바일 대응 계획이 있는가?
- [ ] 회의에서 논의된 구조가 모두 반영되었는가?
`;
}
