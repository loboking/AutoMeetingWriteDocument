// 데이터베이스 설계서 템플릿
export function getDatabasePrompt(baseInfo: string, transcript: string): string {
  return `당신은 데이터베이스 아키텍트입니다. 다음 회의 내용을 바탕으로 **데이터베이스 설계서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 데이터, 엔티티를 **추출**하여 DB를 설계하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 데이터를 바탕으로 스키마를 구조화하세요.

## 데이터베이스 설계서 구조

### 1. 데이터베이스 개요
- **DBMS**: PostgreSQL / MySQL / MongoDB (회의 내용 반영)
- **목적**: 회의에서 논의된 기능을 위한 데이터 저장
- **특징**: ACID 보장, 확장성 고려

### 2. ERD (Entity Relationship Diagram)
회의에서 논의된 엔티티 간의 관계를 Mermaid로 표현:

\`\`\`mermaid
erDiagram
    USER ||--o\u007B ORDER : places
    ORDER ||--|\u007B ORDER_ITEM : contains
\`\`\`

### 3. 테이블 상세 설계

#### 3.1 users (사용자)
| 컬럼명 | 타입 | NULL | KEY | 설명 | 기본값 |
|--------|------|------|-----|------|--------|
| id | BIGINT | X | PK | 사용자 ID | AUTO_INCREMENT |
| email | VARCHAR(255) | X | UK | 이메일 | - |
| password_hash | VARCHAR(255) | X | - | 비밀번호 해시 | - |
| name | VARCHAR(100) | X | - | 이름 | - |
| created_at | TIMESTAMP | X | - | 생성일시 | CURRENT_TIMESTAMP |
| updated_at | TIMESTAMP | O | - | 수정일시 | CURRENT_TIMESTAMP |

**제약조건**:
- **PK (Primary Key)**: 각 테이블의 고유 식별자
- **FK (Foreign Key)**: 외래키 제약조건으로 참조 무결성 보장
- **UNIQUE**: 중복 방지 (이메일, 사용자명 등)
- **CHECK**: 데이터 유효성 검사
- **NOT NULL**: 필수 값 보장

### 4. 인덱스 전략
| 인덱스명 | 테이블 | 컬럼 | 유형 | 목적 |
|----------|--------|------|------|------|
| idx_users_email | users | email | B-Tree | 로그인 조회 최적화 |

### 5. 데이터 마이그레이션
- **초기 데이터**: 시드 데이터 정의
- **마이그레이션 스크립트**: 버전 관리
- **롤백 계획**: 마이그레이션 실패 시 복구

### 6. 백업 및 복구
- **백업 주기**: 매일 새벽 2시
- **백업 보관 기간**: 30일
- **복구 절차**: [복구 스크립트 경로]

회의에서 논의된 실제 데이터 구조와 엔티티를 바탕으로 작성하세요.`;
}
