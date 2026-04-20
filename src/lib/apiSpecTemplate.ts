// API Spec 템플릿
export function getApiSpecPrompt(baseInfo: string, transcript: string): string {
  return `당신은 백엔드 아키텍트입니다. 다음 회의 내용을 바탕으로 **API 명세서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 API, 엔드포인트, 데이터를 **추출**하여 구조화하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 API를 바탕으로 명세를 작성하세요.

## API 명세서 구조

### 1. 개요
- **Base URL**: \`https://api.example.com/v1\`
- **인증 방식**: Bearer Token (JWT) / API Key / Session Cookie
- **데이터 포맷**: JSON

### 2. 엔드포인트 목록
회의에서 논의된 기능별로 엔드포인트 정의:

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| GET | /api/resources | 리소스 목록 조회 | O |
| POST | /api/resources | 리소스 생성 | O |
| GET | /api/resources/:id | 리소스 상세 조회 | O |
| PUT | /api/resources/:id | 리소스 수정 | O |
| DELETE | /api/resources/:id | 리소스 삭제 | O |

### 3. 상세 명세

#### 3.1 리소스 목록 조회
**GET** \`/api/resources\`

**Query Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| page | number | X | 페이지 번호 (기본값: 1) |
| limit | number | X | 페이지 크기 (기본값: 20) |
| sort | string | X | 정렬 기준 |

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
\`\`\`

**Error Response:**
\`\`\`json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "잘못된 파라미터입니다"
  }
}
\`\`\`

#### 3.2 리소스 생성
**POST** \`/api/resources\`

**Request Body:**
\`\`\`json
{
  "name": "리소스명",
  "description": "설명"
}
\`\`\`

**Response (201 Created):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "리소스명",
    "description": "설명",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
\`\`\`

#### 3.3 리소스 상세 조회
**GET** \`/api/resources/:id\`

**Path Parameters:**
| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| id | number | O | 리소스 ID |

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "리소스명",
    "description": "설명",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
\`\`\`

#### 3.4 리소스 수정
**PUT** \`/api/resources/:id\`

**Request Body:**
\`\`\`json
{
  "name": "수정된 리소스명",
  "description": "수정된 설명"
}
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "수정된 리소스명",
    "description": "수정된 설명",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
\`\`\`

#### 3.5 리소스 삭제
**DELETE** \`/api/resources/:id\`

**Response (200 OK):**
\`\`\`json
{
  "success": true,
  "message": "리소스가 삭제되었습니다"
}
\`\`\`

### 4. 데이터 모델

#### 4.1 Resource (리소스)
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | number | O | 리소스 ID |
| name | string | O | 리소스명 |
| description | string | X | 설명 |
| createdAt | string | O | 생성일시 (ISO 8601) |
| updatedAt | string | O | 수정일시 (ISO 8601) |

#### 4.2 Error (에러)
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| code | string | O | 에러 코드 |
| message | string | O | 에러 메시지 |

### 5. 인증

#### 5.1 Bearer Token
\`\`\`http
GET /api/resources HTTP/1.1
Host: api.example.com
Authorization: Bearer <token>
\`\`\`

#### 5.2 API Key
\`\`\`http
GET /api/resources HTTP/1.1
Host: api.example.com
X-API-Key: <api-key>
\`\`\`

### 6. 에러 코드
| 코드 | 설명 |
|------|------|
| 400 | 잘못된 요청 |
| 401 | 인증 실패 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 500 | 서버 오류 |

회의에서 논의된 실제 API 구조와 기능을 바탕으로 작성하세요.`;
}
