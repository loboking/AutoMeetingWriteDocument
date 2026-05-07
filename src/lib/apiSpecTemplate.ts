// API Spec 템플릿
export function getApiSpecPrompt(baseInfo: string, transcript: string): string {
  return `당신은 10년 경력의 백엔드 아키텍트입니다. 다음 회의 내용을 바탕으로 **매우 상세하고 전문적인 API 명세서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드 (반드시 준수하세요)

1. **모든 섹션 작성**: 아래 API 명세서 구조의 모든 섹션을 빠짐없이 작성하세요.
2. **상세성**: 각 엔드포인트는 최소 3-5개의 케이스를 포함해야 합니다.
3. **구체성**: 실제 사용할 수 있는 완전한 예시를 제공하세요.
4. **RESTful 원칙**: HTTP 메서드와 상태 코드를 올바르게 사용하세요.
5. **보안 고려**: 인증, 인가, 검증을 포함하세요.

---

## API 명세서 구조 (모든 섹션 필수 작성)

### 1. 문서 정보

- **API 버전**: v1.0
- **작성일**: [날짜]
- **작성자**: 백엔드팀
- **문서 상태**: 초안/검토 중/승인 완료

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | [날짜] | 초기 작성 | 백엔드팀 |

### 2. 개요 (Overview)

#### 2.1 API 정보
**최소 2문단 이상 작성하세요:**
- API의 목적과 사용처
- 주요 기능과 제공 서비스

| 항목 | 값 |
|------|-----|
| **Base URL** | \`https://api.example.com/v1\` |
| **프로토콜** | HTTPS only |
| **데이터 포맷** | JSON (application/json) |
| **문자 인코딩** | UTF-8 |
| **인증 방식** | Bearer Token (JWT) |
| **Rate Limiting** | 1000 requests/hour |

#### 2.2 버전 관리
URL 기반 버전관리를 사용합니다:
- \`/v1/\` - 현재 안정화 버전
- \`/v2/\` - 차기 버전 (테스트 중)

### 3. 인증 (Authentication)

#### 3.1 인증 방식
**Bearer Token (JWT)**

\`\`\`http
GET /api/users/me HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
\`\`\`

#### 3.2 토큰 발급
**POST** \`/api/auth/login\`

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "password": "password123"
}
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
\`\`\`

#### 3.3 토큰 갱신
**POST** \`/api/auth/refresh\`

**Request Body:**
\`\`\`json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
\`\`\`

### 4. 공통 규약 (Common Conventions)

#### 4.1 요청 규약
- **Content-Type**: \`application/json\`
- **Accept**: \`application/json\`
- **User-Agent**: 필수 (예: \`MyApp/1.0\`)

#### 4.2 응답 규약
- **성공 응답**: 항상 \`success: true\` 포함
- **에러 응답**: 항상 \`success: false\` 포함

**성공 응답 예시:**
\`\`\`json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z",
    "requestId": "req_abc123"
  }
}
\`\`\`

**에러 응답 예시:**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청 데이터가 유효하지 않습니다",
    "details": [
      {
        "field": "email",
        "message": "이메일 형식이 올바르지 않습니다"
      }
    ]
  }
}
\`\`\`

#### 4.3 HTTP 상태 코드
| 코드 | 설명 | 사용 예시 |
|------|------|-----------|
| 200 | OK | 요청 성공 |
| 201 | Created | 리소스 생성 성공 |
| 204 | No Content | 삭제 성공 |
| 400 | Bad Request | 요청 파라미터 오류 |
| 401 | Unauthorized | 인증 실패 |
| 403 | Forbidden | 권한 없음 |
| 404 | Not Found | 리소스 없음 |
| 409 | Conflict | 중복 리소스 |
| 422 | Unprocessable Entity | 검증 실패 |
| 429 | Too Many Requests | Rate Limit 초과 |
| 500 | Internal Server Error | 서버 오류 |

### 5. 엔드포인트 목록

**최소 10개 이상의 엔드포인트를 작성하세요:**

| Method | Path | 설명 | 인증 | Rate Limit |
|--------|------|------|------|------------|
| GET | /api/users | 사용자 목록 조회 | O | 100/hour |
| POST | /api/users | 사용자 생성 | O | 20/hour |
| GET | /api/users/:id | 사용자 상세 조회 | O | 200/hour |
| PUT | /api/users/:id | 사용자 수정 | O | 50/hour |
| DELETE | /api/users/:id | 사용자 삭제 | O | 10/hour |

### 6. 상세 명세

#### 6.1 사용자 목록 조회
**GET** \`/api/users\`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 기본값 | 설명 | 제약 조건 |
|---------|------|------|--------|------|-----------|
| page | number | X | 1 | 페이지 번호 | 1 이상 |
| limit | number | X | 20 | 페이지 크기 | 1-100 |
| sort | string | X | createdAt | 정렬 기준 | createdAt,name,email |
| order | string | X | desc | 정렬 순서 | asc,desc |
| search | string | X | - | 검색어 | 최소 2자 |

**Request Example:**
\`\`\`bash
curl -X GET "https://api.example.com/v1/users?page=1&limit=20&sort=createdAt" \\
  -H "Authorization: Bearer <token>"
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "email": "user1@example.com",
      "name": "김철수",
      "status": "active",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": 2,
      "email": "user2@example.com",
      "name": "이영희",
      "status": "active",
      "createdAt": "2024-01-02T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z",
    "requestId": "req_abc123"
  }
}
\`\`\`

**Response (400 Bad Request):**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "쿼리 파라미터가 유효하지 않습니다",
    "details": [
      {
        "field": "limit",
        "message": "limit은 100 이하여야 합니다"
      }
    ]
  }
}
\`\`\`

**Response (401 Unauthorized):**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "인증이 필요합니다"
  }
}
\`\`\`

#### 6.2 사용자 생성
**POST** \`/api/users\`

**Request Body:**
\`\`\`json
{
  "email": "newuser@example.com",
  "password": "password123!",
  "name": "홍길동",
  "phone": "010-1234-5678"
}
\`\`\`

**Request Validation:**
| 필드 | 타입 | 필수 | 제약 조건 | 설명 |
|------|------|------|-----------|------|
| email | string | O | 이메일 형식, 중복 불가 | 이메일 주소 |
| password | string | O | 최소 8자, 영문+숫자+특수문자 | 비밀번호 |
| name | string | O | 최소 2자, 최대 50자 | 이름 |
| phone | string | X | 휴대폰 번호 형식 | 연락처 |

**Response (201 Created):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 3,
    "email": "newuser@example.com",
    "name": "홍길동",
    "phone": "010-1234-5678",
    "status": "active",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z",
    "requestId": "req_def456"
  }
}
\`\`\`

**Response (409 Conflict):**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_EMAIL",
    "message": "이미 사용 중인 이메일입니다"
  }
}
\`\`\`

**Response (422 Unprocessable Entity):**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청 데이터가 유효하지 않습니다",
    "details": [
      {
        "field": "email",
        "message": "이메일 형식이 올바르지 않습니다"
      },
      {
        "field": "password",
        "message": "비밀번호는 최소 8자 이상이어야 합니다"
      }
    ]
  }
}
\`\`\`

#### 6.3 사용자 상세 조회
**GET** \`/api/users/:id\`

**Path Parameters:**
| 파라미터 | 타입 | 필수 | 설명 | 예시 |
|---------|------|------|------|------|
| id | number | O | 사용자 ID | 1 |

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "김철수",
    "phone": "010-1234-5678",
    "status": "active",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "lastLoginAt": "2024-01-05T10:30:00Z"
  }
}
\`\`\`

**Response (404 Not Found):**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "사용자를 찾을 수 없습니다"
  }
}
\`\`\`

#### 6.4 사용자 수정
**PUT** \`/api/users/:id\`

**Request Body:**
\`\`\`json
{
  "name": "수정된 이름",
  "phone": "010-9876-5432"
}
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "수정된 이름",
    "phone": "010-9876-5432",
    "status": "active",
    "updatedAt": "2024-01-05T12:00:00Z"
  }
}
\`\`\`

#### 6.5 사용자 삭제
**DELETE** \`/api/users/:id\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "message": "사용자가 삭제되었습니다",
  "data": {
    "id": 1,
    "deletedAt": "2024-01-05T12:00:00Z"
  }
}
\`\`\`

### 7. 데이터 모델 (Data Models)

#### 7.1 User (사용자)
| 필드 | 타입 | 필수 | 설명 | 제약 조건 |
|------|------|------|------|-----------|
| id | number | O | 사용자 ID | 자동 생성 |
| email | string | O | 이메일 | 유니크, 이메일 형식 |
| password | string | O | 비밀번호 | 해싱 저장 |
| name | string | O | 이름 | 2-50자 |
| phone | string | X | 연락처 | 휴대폰 형식 |
| status | string | O | 상태 | active, inactive, suspended |
| role | string | O | 역할 | user, admin |
| createdAt | string | O | 생성일시 | ISO 8601 |
| updatedAt | string | O | 수정일시 | ISO 8601 |
| lastLoginAt | string | X | 마지막 로그인 | ISO 8601 |

#### 7.2 Error (에러)
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| code | string | O | 에러 코드 |
| message | string | O | 에러 메시지 |
| details | array | X | 상세 에러 정보 |

### 8. 에러 코드 (Error Codes)

| 코드 | HTTP | 설명 | 해결 방법 |
|------|------|------|-----------|
| INVALID_PARAMS | 400 | 요청 파라미터 오류 | 파라미터를 확인하세요 |
| UNAUTHORIZED | 401 | 인증 실패 | 로그인이 필요합니다 |
| FORBIDDEN | 403 | 권한 없음 | 권한이 부족합니다 |
| USER_NOT_FOUND | 404 | 사용자 없음 | 사용자 ID를 확인하세요 |
| DUPLICATE_EMAIL | 409 | 이메일 중복 | 다른 이메일을 사용하세요 |
| VALIDATION_ERROR | 422 | 검증 실패 | 입력값을 확인하세요 |
| RATE_LIMIT_EXCEEDED | 429 | Rate Limit 초과 | 잠시 후 다시 시도하세요 |
| INTERNAL_ERROR | 500 | 서버 오류 | 관리자에게 문의하세요 |

### 9. Rate Limiting

| Tier | Limit | Time Window | Description |
|------|-------|-------------|-------------|
| Anonymous | 100 | 1 hour | 인증 없는 요청 |
| Authenticated | 1000 | 1 hour | 인증된 요청 |
| Premium | 10000 | 1 hour | 프리미엄 사용자 |

**Rate Limit 응답:**
\`\`\`http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640995200

{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "요청 한도를 초과했습니다. 1시간 후 다시 시도해주세요."
  }
}
\`\`\`

### 10. API 아키텍처

\`\`\`mermaid
graph LR
    A["Client / 클라이언트"] --> B["API Gateway"]
    B --> C["Auth Service / 인증 서비스"]
    B --> D["User API / 사용자 API"]
    B --> E["Content API / 컨텐츠 API"]
    D --> F[("PostgreSQL")]
    E --> G[("MongoDB")]
\`\`\`

### 11. 테스트 가이드

#### 11.1 Postman 컬렉션
- [Postman 컬렉션 링크]

#### 11.2 테스트 계정
\`\`\`
이메일: test@example.com
비밀번호: test123!
\`\`\`

### 12. 변경 로그

| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2024-01-01 | v1.0 | 초기 릴리스 |

---

## 작성 완료 후 확인사항

- [ ] 모든 엔드포인트에 요청/응답 예시가 있는가?
- [ ] 인증/인가 절차가 명확한가?
- [ ] 에러 코드가 모두 정의되었는가?
- [ ] 데이터 모델이 상세히 설명되었는가?
- [ ] Rate Limit 정책이 명시되었는가?
- [ ] 아키텍처 다이어그램이 포함되었는가?
- [ ] 회의에서 논의된 API가 모두 포함되었는가?
`;
}
