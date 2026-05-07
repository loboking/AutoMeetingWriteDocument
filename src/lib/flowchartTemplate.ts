// 플로우차트 템플릿
export function getFlowchartPrompt(baseInfo: string, transcript: string): string {
  return `당신은 15년 경력의 프로세스 디자이너입니다. 다음 회의 내용을 바탕으로 **매우 상세하고 전문적인 플로우차트 문서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드 (반드시 준수하세요)

1. **모든 섹션 작성**: 아래 플로우차트 구조의 모든 섹션을 빠짐없이 작성하세요.
2. **시각화**: 모든 프로세스는 Mermaid 다이어그램으로 시각화하세요.
3. **구체성**: 각 단계별 입력/출력/결정 포인트를 명확히 하세요.
4. **예외 처리**: 모든 가능한 예외 상황과 에러 처리를 포함하세요.
5. **상세 설명**: 각 프로세스에 대해 3-5문단 이상의 상세 설명을 작성하세요.

---

## 플로우차트 문서 구조 (모든 섹션 필수 작성)

### 1. 문서 정보

| 항목 | 내용 |
|------|------|
| **문서명** | 플로우차트 (Process Flowchart) |
| **버전** | v1.0 |
| **작성일** | [날짜] |
| **작성자** | 프로세스 설계팀 |
| **승인자** | - |

### 2. 프로세스 개요 (Process Overview)

#### 2.1 프로세스 정보
**최소 3문단 이상 작성하세요:**
- 프로세스의 목적과 중요성
- 프로세스의 범위와 한계
- 관련 시스템과의 연관관계

| 항목 | 내용 |
|------|------|
| **프로세스 명** | [프로세스명] |
| **프로세스 ID** | P-001 |
| **목적** | [프로세스의 목적] |
| **소유자** | [담당 부서/역할] |
| **관련 시스템** | [연동 시스템 목록] |
| **선행 프로세스** | [선행 프로세스명] |
| **후행 프로세스** | [후행 프로세스명] |

#### 2.2 프로세스 목표
- [ ] 목표 1
- [ ] 목표 2
- [ ] 목표 3

### 3. 주요 시나리오 플로우

#### 3.1 회원가입 플로우

**최소 3문단 작성하세요:**
- 프로세스의 시작과 종료 조건
- 주요 참여자와 their 역할
- 완료 기준

**단계별 상세:**

| 단계 | 활동 | 담당 | 입력 | 출력 | 완료 기준 |
|------|------|------|------|------|-----------|
| 1 | 회원가입 버튼 클릭 | 사용자 | - | 가입 화면 | 화면 전환 |
| 2 | 이메일 입력 | 사용자 | - | 이메일 값 | 유효성 통과 |
| 3 | 비밀번호 입력 | 사용자 | - | 비밀번호 값 | 복잡도 통과 |
| 4 | 약관 동의 | 사용자 | 약관 내용 | 동의 여부 | 필수 항목 동의 |
| 5 | 가입 요청 전송 | 프론트엔드 | 가입 정보 | API 요청 | 요청 전송 |
| 6 | 이메일 중복 검사 | 백엔드 | 이메일 | 중복 여부 | 검증 완료 |
| 7 | 인증 이메일 전송 | 백엔드 | 이메일 | 전송 완료 | 메일 발송 |
| 8 | 이메일 인증 확인 | 사용자 | 인증 링크 | 인증 완료 | 토큰 검증 |
| 9 | 회원가입 완료 | 백엔드 | 인증 정보 | 사용자 생성 | DB 저장 |

**Mermaid 다이어그램:**

\`\`\`mermaid
flowchart TD
    Start([Start / 시작]) --> A["Click Signup Button / 회원가입 버튼 클릭"]
    A --> B["Input Email / 이메일 입력"]
    B --> C{"Email Valid? / 이메일 유효성 검사"}
    C -->|Fail / 실패| B
    C -->|Pass / 성공| D["Input Password / 비밀번호 입력"]
    D --> E{"Password Complexity? / 비밀번호 복잡도 검사"}
    E -->|Fail / 실패| D
    E -->|Pass / 성공| F["Agree to Terms / 약관 동의"]
    F --> G{"Required Terms? / 필수 약관 동의?"}
    G -->|No / 아니오| F
    G -->|Yes / 예| H["Send Signup Request / 가입 요청 전송"]
    H --> I{"Email Duplicate? / 이메일 중복 검사"}
    I -->|Duplicate / 중복| J["Duplicate Alert / 중복 안내"]
    J --> B
    I -->|가능| K[인증 이메일 전송]
    K --> L{이메일 전송 성공?}
    L -->|실패| M[재시도 옵션]
    M --> K
    L -->|성공| N[인증 대기 화면]
    N --> O[이메일 인증 링크 클릭]
    O --> P{토큰 유효성 검사}
    P -->|만료| Q[만료 안내]
    Q --> R[재전송]
    R --> K
    P -->|유효| S[회원가입 완료]
    S --> T([종료])

    style Start fill:#e1f5fe
    style T fill:#c8e6c9
    style J fill:#ffcdd2
    style Q fill:#ffcdd2
    style S fill:#c8e6c9
\`\`\`

**상세 설명:**
1. **이메일 유효성 검사**: 이메일 형식(@ 포함, 도메인 존재) 검증
2. **비밀번호 복잡도**: 최소 8자, 영문+숫자+특수문자 조합
3. **약관 동의**: 서비스 이용약관, 개인정보 처리방침 필수 동의
4. **이메일 중복 검사**: DB에서 동일 이메일 조회
5. **인증 메일**: 24시간 유효한 인증 토큰 포함

#### 3.2 로그인 플로우

**단계별 상세:**

| 단계 | 활동 | 담당 | 입력 | 출력 | 완료 기준 |
|------|------|------|------|------|-----------|
| 1 | 로그인 화면 진입 | 사용자 | - | 로그인 폼 | 화면 표시 |
| 2 | 이메일/비밀번호 입력 | 사용자 | - | 로그인 정보 | 값 입력 |
| 3 | 로그인 요청 | 프론트엔드 | 로그인 정보 | API 요청 | 요청 전송 |
| 4 | 인증 확인 | 백엔드 | 로그인 정보 | 검증 결과 | DB 조회 |
| 5 | 토큰 발급 | 백엔드 | 사용자 정보 | JWT 토큰 | 토큰 생성 |
| 6 | 대시보드 이동 | 프론트엔드 | 토큰 | 리다이렉트 | 화면 전환 |

**Mermaid 다이어그램:**

\`\`\`mermaid
flowchart TD
    Start([Start / 시작]) --> A["Login Screen / 로그인 화면 진입"]
    A --> B["Input ID/PW / 이메일/비밀번호 입력"]
    B --> C["Login Request / 로그인 요청"]
    C --> D{"Account Exists? / 계정 존재 여부"}
    D -->|No / 없음| E["No Account Alert / 계정 없음 안내"]
    E --> F["Prompt Signup / 회원가입 유도"]
    D -->|Yes / 있음| G{"Password Match? / 비밀번호 일치?"}
    G -->|No Match / 불일치| H["PW Mismatch Alert / 비밀번호 불일치 안내"]
    H --> B
    G -->|Match / 일치| I{"Account Status? / 계정 상태 확인"}
    I -->|Withdrawn / 탈퇴| J["Withdrawn Alert / 탈퇴 계정 안내"]
    I -->|Suspended / 정지| K["Suspended Alert / 계정 정지 안내"]
    I -->|Active / 활성| L["Issue JWT Token / JWT 토큰 발급"]
    L --> M["Save Token / 토큰 저장"]
    M --> N["Go to Dashboard / 대시보드 이동"]
    N --> End([End / 종료])

    style Start fill:#e1f5fe
    style End fill:#c8e6c9
    style E fill:#ffcdd2
    style H fill:#fff9c4
    style J fill:#ffcdd2
    style K fill:#ffcdd2
    style N fill:#c8e6c9
\`\`\`

#### 3.3 비밀번호 찾기 플로우

**단계별 상세:**

| 단계 | 활동 | 담당 | 입력 | 출력 | 완료 기준 |
|------|------|------|------|------|-----------|
| 1 | 비밀번호 찾기 클릭 | 사용자 | - | 찾기 화면 | 화면 전환 |
| 2 | 이메일 입력 | 사용자 | - | 이메일 값 | 유효성 통과 |
| 3 | 임시 비밀번호 발송 | 백엔드 | 이메일 | 전송 완료 | 메일 발송 |
| 4 | 임시 비밀번호 수신 | 사용자 | 이메일 | 임시 비번 | 메일 확인 |
| 5 | 새 비밀번호 설정 | 사용자 | 임시 비번 | 새 비밀번호 | 변경 완료 |

**Mermaid 다이어그램:**

\`\`\`mermaid
flowchart TD
    Start([Start / 시작]) --> A["Click Find PW / 비밀번호 찾기 클릭"]
    A --> B["Input Email / 이메일 입력"]
    B --> C{"Email Exists? / 이메일 존재?"}
    C -->|No / 없음| D["No Account Alert / 계정 없음 안내"]
    C -->|Yes / 있음| E["Send Temp PW / 임시 비밀번호 발송"]
    E --> F{"Send Success? / 전송 성공?"}
    F -->|Fail / 실패| G["Retry Option / 재시도 옵션"]
    G --> E
    F -->|Pass / 성공| H["Sent Alert / 전송 완료 안내"]
    H --> I["Check Email / 이메일 확인"]
    I --> J["Input Temp PW / 임시 비밀번호 입력"]
    J --> K{"Temp PW Valid? / 임시 비번 유효?"}
    K -->|Expired/Invalid / 만료/불일치| L["Error Alert / 에러 안내"]
    L --> J
    K -->|Valid / 유효| M["Input New PW / 새 비밀번호 입력"]
    M --> N{"PW Complexity? / 비밀번호 복잡도"}
    N -->|Fail / 실패| M
    N -->|성공| O[비밀번호 변경 완료]
    O --> P[로그인 유도]
    P --> End([종료])

    style Start fill:#e1f5fe
    style End fill:#c8e6c9
    style D fill:#ffcdd2
    style L fill:#ffcdd2
    style O fill:#c8e6c9
\`\`\`

### 4. 예외 처리 플로우 (Exception Handling)

#### 4.1 인증 실패 시나리오

**최소 3문단 작성하세요:**
- 예외 상황의 원인과 빈도
- 사용자에게 제공되는 피드백
- 복구 절차와 예방 조치

| 예외 상황 | 원인 | 빈도 | 처리 방법 | 사용자 피드백 | 복구 절차 |
|-----------|------|------|-----------|----------------|-----------|
| 이메일 중복 | 동일 이메일 존재 | 높음 | 중복 안내 + 재입력 요청 | "이미 사용 중인 이메일입니다" | 다른 이메일 입력 |
| 비밀번호 불일치 | 잘못된 비밀번호 | 높음 | 불일치 안내 + 재입력 요청 | "비밀번호가 일치하지 않습니다" | 재입력 또는 찾기 |
| 약관 미동의 | 필수 약관 미체크 | 중간 | 동의 유도 | "필수 약관에 동의해주세요" | 체크박 선택 |
| 인증 메일 미수신 | 스팸 처리 등 | 낮음 | 재전송 버튼 | "이메일을 받지 못하셨나요?" | 재전송 또는 이메일 변경 |

#### 4.2 네트워크 에러 처리

**Mermaid 다이어그램:**

\`\`\`mermaid
flowchart TD
    A["API Request / API 요청"] --> B{"Response Received? / 응답 수신"}
    B -->|Success / 성공| C["Normal Processing / 정상 처리"]
    B -->|Network Error / 네트워크 에러| D["Retry Popup / 재시도 팝업"]
    D --> E{"User Choice? / 사용자 선택"}
    E -->|Retry / 재시도| F["Check Retry Count / 재시도 카운트 확인"]
    F --> G{"Less than 3? / 3회 미만?"}
    G -->|Yes / 예| A
    G -->|No / 아니오| H["Retry Exceeded / 재시도 초과 안내"]
    E -->|Cancel / 취소| I["Go to Error Page / 에러 페이지로 이동"]
    B -->|Server Error 500 / 서버 에러| J["Server Error Alert / 서버 에러 안내"]
    J --> K["Try Again Later / 잠시 후 다시 시도"]
    B -->|Timeout / 타임아웃| L["Timeout Alert / 요청 시간 초과 안내"]
    L --> M["Check Network / 네트워크 상태 확인"]

    style C fill:#c8e6c9
    style H fill:#ffcdd2
    style I fill:#ffcdd2
    style J fill:#fff9c4
    style L fill:#fff9c4
\`\`\`

#### 4.3 에러 코드 매핑

| 에러 코드 | HTTP 상태 | 설명 | 사용자 메시지 | 조치 |
|-----------|-----------|------|----------------|------|
| AUTH_001 | 401 | 이메일 없음 | "등록되지 않은 이메일입니다" | 회원가입 유도 |
| AUTH_002 | 401 | 비밀번호 불일치 | "비밀번호가 올바르지 않습니다" | 재입력 |
| AUTH_003 | 409 | 이메일 중복 | "이미 사용 중인 이메일입니다" | 다른 이메일 |
| NET_001 | 503 | 서버 점검 중 | "현재 서버 점검 중입니다" | 잠시 후 재시도 |
| NET_002 | 408 | 요청 타임아웃 | "요청 시간이 초과되었습니다" | 재시도 |

### 5. 시스템 간 연동 플로우 (System Integration)

#### 5.1 인증 연동

**최소 2문단 작성하세요:**
- 시스템 간 통신 프로토콜과 데이터 형식
- 장애 발생 시 영향 범위

**Sequence Diagram:**

\`\`\`mermaid
sequenceDiagram
    participant U as User / 사용자
    participant F as Frontend / 프론트엔드
    participant B as Backend / 백엔드
    participant A as Auth Server / 인증 서버
    participant D as Database / 데이터베이스
    participant E as Email Server / 이메일 서버

    U->>F: Login Request / 로그인 요청
    Note over U,F: Email/Password Input / 이메일/비밀번호 입력
    F->>B: POST /api/auth/login
    Note over F,B: HTTPS + JSON
    B->>A: Token Verify Request / 토큰 검증 요청
    Note over B,A: gRPC Call / gRPC 호출
    A->>D: User Lookup / 사용자 조회
    D-->>A: User Info / 사용자 정보
    A->>A: Password Verify / 비밀번호 검증
    A-->>B: Issue Token / 토큰 발급
    Note over A,B: JWT (expires 1hr) / JWT (유효기간 1시간)
    B->>D: Update Last Login / 마지막 로그인 업데이트
    B-->>F: Login Success + Token / 로그인 성공 + 토큰
    F->>F: Save Token / 토큰 저장
    F-->>U: Go to Dashboard / 대시보드 이동

    rect rgb(255, 230, 230)
        Note over U,E: On Error / 에러 발생 시
        B--xF: 401 Unauthorized
        F-->>U: Login Failed Alert / 로그인 실패 안내
    end
\`\`\`

#### 5.2 데이터 연동

**Mermaid 다이어그램:**

\`\`\`mermaid
graph LR
    A["User / 사용자"] --> B["Frontend / 프론트엔드"]
    B --> C["API Gateway"]
    C --> D["Auth Middleware / 인증 미들웨어"]
    D --> E{"Token Valid? / 토큰 유효?"}
    E -->|No / 아니오| F["401 Response"]
    E -->|Yes / 예| G["Business Service / 비즈니스 서비스"]
    G --> H[("Database / 데이터베이스")]
    G --> I["External API / 외부 API"]
    H --> J["Data Transform / 데이터 변환"]
    I --> J
    J --> C
    C --> B
    B --> A

    style F fill:#ffcdd2
    style E fill:#fff9c4
    style J fill:#e1f5fe
\`\`\`

### 6. 비즈니스 로직 플로우

#### 6.1 데이터 처리 플로우

**최소 3문단 작성하세요:**
- 데이터의 수집, 검증, 변환, 저장 과정
- 각 단계별 데이터 형식과 검증 규칙

**Mermaid 다이어그램:**

\`\`\`mermaid
flowchart LR
    A["Data Collection / 데이터 수집"] --> B["Format Validation / 형식 검증"]
    B --> C{"Validation Pass? / 검증 통과?"}
    C -->|No / 아니오| D["Validation Error / 검증 에러 응답"]
    C -->|Yes / 예| E["Duplicate Check / 중복 검사"]
    E --> F{"Is Duplicate? / 중복 여부"}
    F -->|Duplicate / 중복| G["Duplicate Error / 중복 에러 응답"]
    F -->|New Data / 새로운 데이터| H["Data Transform / 데이터 변환"]
    H --> I["Apply Business Logic / 비즈니스 로직 적용"]
    I --> J[("DB Save / 데이터베이스 저장")]
    J --> K["Send Notification / 알림 발송"]
    K --> L["Success Response / 성공 응답"]

    style D fill:#ffcdd2
    style G fill:#ffcdd2
    style L fill:#c8e6c9
\`\`\`

#### 6.2 상태 전이 다이어그램

**Mermaid 다이어그램:**

\`\`\`mermaid
stateDiagram-v2
    [*] --> NotSignedUp: Start Signup / 회원가입 시작
    NotSignedUp --> EmailInput: Click Button / 버튼 클릭
    EmailInput --> EmailInput: Validation Fail / 유효성 실패
    EmailInput --> PasswordInput: Validation Pass / 유효성 성공
    PasswordInput --> PasswordInput: Complexity Fail / 복잡도 실패
    PasswordInput --> TermsAgree: Complexity Pass / 복잡도 성공
    TermsAgree --> TermsAgree: Disagree / 미동의
    TermsAgree --> EmailSending: Agree Complete / 동의 완료
    EmailSending --> PendingAuth: Send Success / 전송 성공
    PendingAuth --> NotSignedUp: Send Fail / 전송 실패
    PendingAuth --> SignedUp: Auth Success / 인증 성공
    SignedUp --> LoggedIn: Login Attempt / 로그인 시도
    LoggedIn --> Inactive: 1 Year No Login / 1년 미접속
    LoggedIn --> Withdrawn: Withdraw Request / 탈퇴 요청
    Inactive --> [*]
    Withdrawn --> [*]

    note right of SignedUp
        Onboarding Provided / 온보딩 제공
    end note

    %% State labels with English/Korean
    classDef stateLabel fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class NotSignedUp,EmailInput,PasswordInput,TermsAgree,EmailSending,PendingAuth,SignedUp,LoggedIn,Inactive,Withdrawn stateLabel
\`\`\`

### 7. 성능 및 볼륨 고려사항

| 항목 | 내용 | 대응 방안 |
|------|------|-----------|
| 동시 요청 | 최대 1000 req/s | 로드 밸런싱, 캐싱 |
| 응답 시간 | 200ms 이하 | 캐싱, 쿼리 최적화 |
| 데이터 볼륨 | 일일 10만 가입 | 슬레이브 DB, 배치 처리 |

---

## 작성 완료 후 확인사항

- [ ] 모든 프로세스가 Mermaid 다이어그램으로 시각화되었는가?
- [ ] 각 단계별 입력/출력이 명확한가?
- [ ] 모든 예외 상황과 에러 처리가 포함되었는가?
- [ ] 시스템 간 연동이 명확히 정의되었는가?
- [ ] 회의에서 논의된 프로세스가 모두 포함되었는가?
`;
}
