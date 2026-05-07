// 데이터베이스 설계서 템플릿
export function getDatabasePrompt(baseInfo: string, transcript: string): string {
  return `당신은 10년 경력의 데이터베이스 아키텍트입니다. 다음 회의 내용을 바탕으로 **매우 상세하고 전문적인 데이터베이스 설계서**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드 (반드시 준수하세요)

1. **모든 섹션 작성**: 아래 DB 설계서 구조의 모든 섹션을 빠짐없이 작성하세요.
2. **상세성**: 각 테이블은 컬럼, 타입, 제약조건, 인덱스를 포함해야 합니다.
3. **구체성**: 실제 DDL(Create Table) 문을 작성하세요.
4. **정규화**: 제3정규형까지 정규화를 수행하세요.
5. **성능 고려**: 인덱스 전략과 파티셔닝을 포함하세요.

---

## 데이터베이스 설계서 구조 (모든 섹션 필수 작성)

### 1. 문서 정보

- **문서 버전**: v1.0
- **작성일**: [날짜]
- **작성자**: 데이터팀
- **문서 상태**: 초안/검토 중/승인 완료

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | [날짜] | 초기 작성 | 데이터팀 |

### 2. 데이터베이스 개요

| 항목 | 내용 |
|------|------|
| **DBMS** | PostgreSQL 15.x / MySQL 8.x / MongoDB 6.x |
| **목적** | 회의에서 논의된 기능을 위한 데이터 저장 |
| **특징** | ACID 보장, 확장성, 높은 가용성 |
| **문자셋** | UTF-8 (utf8mb4) |
| **타임존** | Asia/Seoul |

**선정 이유**:
- **PostgreSQL**: 복잡한 쿼리, JSON 지원, 확장성
- **MySQL**: 간단한 스키마, 널리 사용됨
- **MongoDB**: 유연한 스키마, 빠른 개발

### 3. ERD (Entity Relationship Diagram)

**회의에서 논의된 엔티티 간의 관계를 Mermaid로 표현하세요:**

\`\`\`mermaid
erDiagram
    USERS ||--o{ WIDGETS : "owns"
    USERS ||--o{ REPORTS : "creates"
    USERS ||--o{ NOTIFICATIONS : "receives"
    USERS ||--o{ ACTIVITY_LOGS : "generates"
    REPORTS ||--o{ REPORT_DATA : "contains"
    WIDGETS }o--|| DATASOURCES : "uses"

    USERS {
        uuid id PK
        string email UK
        string password_hash
        string name
        enum role
        timestamp created_at
    }

    WIDGETS {
        uuid id PK
        uuid user_id FK
        enum type
        string title
        json position
        json config
    }

    REPORTS {
        uuid id PK
        uuid user_id FK
        string title
        enum type
        enum status
        timestamp published_at
    }

    DATASOURCES {
        uuid id PK
        string name
        string endpoint
        json schema
    }

    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        string message
        enum type
        boolean is_read
    }

    ACTIVITY_LOGS {
        uuid id PK
        uuid user_id FK
        string action
        json metadata
    }
\`\`\`

### 4. 테이블 상세 설계

#### 4.1 users (사용자)

| 컬럼명 | 타입 | NULL | KEY | 기본값 | 설명 | 제약조건 |
|--------|------|------|-----|--------|------|----------|
| id | UUID | X | PK | gen_random_uuid() | 사용자 ID | - |
| email | VARCHAR(255) | X | UK | - | 이메일 | 이메일 형식 |
| password_hash | VARCHAR(255) | X | - | - | 비밀번호 해시 | bcrypt |
| name | VARCHAR(100) | X | - | - | 이름 | 2-50자 |
| avatar_url | VARCHAR(500) | O | - | - | 프로필 이미지 | URL 형식 |
| role | VARCHAR(20) | X | - | 'user' | 역할 | user, admin |
| email_verified | BOOLEAN | O | - | FALSE | 이메일 인증 여부 | - |
| last_login_at | TIMESTAMP | O | - | - | 마지막 로그인 | - |
| created_at | TIMESTAMP | X | - | CURRENT_TIMESTAMP | 생성일시 | - |
| updated_at | TIMESTAMP | O | - | CURRENT_TIMESTAMP | 수정일시 | - |

**DDL**:
\`\`\`sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    email_verified BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 이메일 인덱스
CREATE INDEX idx_users_email ON users(email);

-- 역할 인덱스
CREATE INDEX idx_users_role ON users(role);

-- 생성일 인덱스
CREATE INDEX idx_users_created_at ON users(created_at);

-- 트리거: updated_at 자동 업데이트
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
\`\`\`

---

#### 4.2 widgets (위젯)

| 컬럼명 | 타입 | NULL | KEY | 기본값 | 설명 | 제약조건 |
|--------|------|------|-----|--------|------|----------|
| id | UUID | X | PK | gen_random_uuid() | 위젯 ID | - |
| user_id | UUID | X | FK | - | 소유자 ID | users.id 참조 |
| type | VARCHAR(20) | X | - | - | 위젯 타입 | chart, table, card |
| title | VARCHAR(100) | X | - | - | 위젯 제목 | - |
| data_source_id | UUID | O | FK | - | 데이터 소스 ID | datasources.id 참조 |
| position | JSONB | O | - | - | 위치 정보 | {x, y, w, h} |
| config | JSONB | O | - | - | 추가 설정 | - |
| is_active | BOOLEAN | O | - | TRUE | 활성 상태 | - |
| created_at | TIMESTAMP | X | - | CURRENT_TIMESTAMP | 생성일시 | - |
| updated_at | TIMESTAMP | O | - | CURRENT_TIMESTAMP | 수정일시 | - |

**DDL**:
\`\`\`sql
CREATE TABLE widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('chart', 'table', 'card', 'number')),
    title VARCHAR(100) NOT NULL,
    data_source_id UUID REFERENCES datasources(id) ON DELETE SET NULL,
    position JSONB,
    config JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_widgets_user_id ON widgets(user_id);
CREATE INDEX idx_widgets_type ON widgets(type);
CREATE INDEX idx_widgets_position ON widgets USING GIN(position);

-- GIN 인덱스 (JSONB 쿼리 최적화)
CREATE INDEX idx_widgets_config ON widgets USING GIN(config);
\`\`\`

---

#### 4.3 reports (리포트)

| 컬럼명 | 타입 | NULL | KEY | 기본값 | 설명 | 제약조건 |
|--------|------|------|-----|--------|------|----------|
| id | UUID | X | PK | gen_random_uuid() | 리포트 ID | - |
| user_id | UUID | X | FK | - | 생성자 ID | users.id 참조 |
| title | VARCHAR(200) | X | - | - | 리포트 제목 | - |
| description | TEXT | O | - | - | 설명 | - |
| type | VARCHAR(20) | X | - | - | 리포트 타입 | daily, weekly, monthly |
| status | VARCHAR(20) | X | - | 'draft' | 상태 | draft, published |
| data | JSONB | O | - | - | 리포트 데이터 | - |
| published_at | TIMESTAMP | O | - | - | 발행일시 | - |
| created_at | TIMESTAMP | X | - | CURRENT_TIMESTAMP | 생성일시 | - |
| updated_at | TIMESTAMP | O | - | CURRENT_TIMESTAMP | 수정일시 | - |

**DDL**:
\`\`\`sql
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'custom')),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    data JSONB,
    published_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_reports_user_id ON reports(user_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_type ON reports(type);
CREATE INDEX idx_reports_published_at ON reports(published_at);
CREATE INDEX idx_reports_data ON reports USING GIN(data);
\`\`\`

---

#### 4.4 notifications (알림)

| 컬럼명 | 타입 | NULL | KEY | 기본값 | 설명 | 제약조건 |
|--------|------|------|-----|--------|------|----------|
| id | UUID | X | PK | gen_random_uuid() | 알림 ID | - |
| user_id | UUID | X | FK | - | 수신자 ID | users.id 참조 |
| type | VARCHAR(20) | X | - | - | 알림 타입 | info, success, warning, error |
| title | VARCHAR(100) | X | - | - | 제목 | - |
| message | TEXT | X | - | - | 메시지 | - |
| action_url | VARCHAR(500) | O | - | - | 액션 URL | - |
| is_read | BOOLEAN | O | - | FALSE | 읽음 여부 | - |
| read_at | TIMESTAMP | O | - | - | 읽은 시간 | - |
| expires_at | TIMESTAMP | O | - | - | 만료 시간 | - |
| created_at | TIMESTAMP | X | - | CURRENT_TIMESTAMP | 생성일시 | - |

**DDL**:
\`\`\`sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    action_url VARCHAR(500),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);

-- 읽지 않은 알림 빠른 조회
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
\`\`\`

---

#### 4.5 activity_logs (활동 로그)

| 컬럼명 | 타입 | NULL | KEY | 기본값 | 설명 | 제약조건 |
|--------|------|------|-----|--------|------|----------|
| id | UUID | X | PK | gen_random_uuid() | 로그 ID | - |
| user_id | UUID | O | FK | - | 사용자 ID | users.id 참조 |
| action | VARCHAR(50) | X | - | - | 액션 | login, create, update, delete |
| entity_type | VARCHAR(50) | O | - | - | 엔티티 타입 | user, report, widget |
| entity_id | UUID | O | - | - | 엔티티 ID | - |
| metadata | JSONB | O | - | - | 추가 정보 | - |
| ip_address | INET | O | - | - | IP 주소 | - |
| user_agent | TEXT | O | - | - | User Agent | - |
| created_at | TIMESTAMP | X | - | CURRENT_TIMESTAMP | 생성일시 | - |

**DDL**:
\`\`\`sql
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 파티셔닝 (날짜별, 대량 로그 관리)
CREATE TABLE activity_logs_y2024m01 PARTITION OF activity_logs
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- 인덱스
CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_action ON activity_logs(action);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_metadata ON activity_logs USING GIN(metadata);
\`\`\`

### 5. 인덱스 전략

#### 5.1 인덱스 목록

| 인덱스명 | 테이블 | 컬럼 | 유형 | 목적 | 중요도 |
|----------|--------|------|------|------|--------|
| idx_users_email | users | email | B-Tree | 로그인 조회 | 높음 |
| idx_widgets_user_id | widgets | user_id | B-Tree | 사용자 위젯 조회 | 높음 |
| idx_reports_status | reports | status | B-Tree | 상태별 필터 | 높음 |
| idx_notifications_unread | notifications | (user_id, is_read) | B-Tree | 읽지 않은 알림 | 높음 |
| idx_widgets_position | widgets | position | GIN | 위치 검색 | 중간 |
| idx_reports_data | reports | data | GIN | JSONB 쿼리 | 중간 |

#### 5.2 인덱스 설계 원칙

1. **기본 키**: 항상 인덱스됨
2. **외래 키**: 인덱스 생성 권장
3. **자주 조회하는 컬럼**: 인덱스 고려
4. **정렬 기준**: 인덱스 고려
5. **JSONB**: GIN 인덱스로 쿼리 최적화

### 6. 제약조건 (Constraints)

#### 6.1 PK (Primary Key)

- 모든 테이블은 PK를 가져야 함
- PK는 UUID 또는 Auto Increment ID
- UUID: 분산 환경, 보안
- Auto Increment: 단순, 성능

#### 6.2 FK (Foreign Key)

| FK | 자식 테이블 | 부모 테이블 | ON DELETE | ON UPDATE |
|----|-----------|-----------|-----------|-----------|
| fk_widgets_user_id | widgets | users | CASCADE | CASCADE |
| fk_reports_user_id | reports | users | CASCADE | CASCADE |
| fk_notifications_user_id | notifications | users | CASCADE | CASCADE |

#### 6.3 UNIQUE

| 테이블 | 컬럼 | 설명 |
|--------|------|------|
| users | email | 이메일 중복 방지 |
| users | (email, deleted_at) | 소프트 삭제 고려 |

#### 6.4 CHECK

| 테이블 | 조건 | 설명 |
|--------|------|------|
| users | role IN ('user', 'admin') | 역할 제한 |
| widgets | type IN ('chart', 'table', 'card') | 타입 제한 |
| reports | status IN ('draft', 'published') | 상태 제한 |

### 7. 뷰 (Views)

#### 7.1 사용자 통계 뷰

\`\`\`sql
CREATE VIEW user_stats AS
SELECT
    u.id,
    u.name,
    u.email,
    COUNT(DISTINCT w.id) AS widget_count,
    COUNT(DISTINCT r.id) AS report_count,
    MAX(r.published_at) AS last_report_date
FROM users u
LEFT JOIN widgets w ON w.user_id = u.id AND w.is_active = TRUE
LEFT JOIN reports r ON r.user_id = u.id AND r.status = 'published'
GROUP BY u.id, u.name, u.email;
\`\`\`

#### 7.2 최근 활동 뷰

\`\`\`sql
CREATE VIEW recent_activities AS
SELECT
    user_id,
    action,
    entity_type,
    entity_id,
    created_at
FROM activity_logs
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
ORDER BY created_at DESC;
\`\`\`

### 8. 트리거 (Triggers)

#### 8.1 updated_at 자동 업데이트

\`\`\`sql
-- 함수는 이미 4.1에서 정의됨
-- 테이블별 트리거 생성
CREATE TRIGGER update_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
\`\`\`

#### 8.2 소프트 삭제

\`\`\`sql
-- 함수
CREATE OR REPLACE FUNCTION soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    NEW.deleted_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
\`\`\`

### 9. 데이터 마이그레이션

#### 9.1 마이그레이션 도구

| 도구 | 설명 |
|------|------|
| Prisma | ORM + 마이그레이션 |
| Flyway | Java 기반 마이그레이션 |
| Alembic | Python 기반 마이그레이션 |
| node-pg-migrate | Node.js 기반 |

#### 9.2 마이그레이션 파일 예시

\`\`\`bash
migrations/
├── 001_initial_schema.sql
├── 002_add_widgets_table.sql
├── 003_add_reports_table.sql
├── 004_add_notifications_table.sql
└── 005_add_activity_logs_table.sql
\`\`\`

#### 9.3 롤백 계획

- **마이그레이션 전**: 백업 필수
- **마이그레이션 실패시**: 롤백 스크립트 실행
- **데이터 손실 방지**: 트랜잭션 사용

### 10. 백업 및 복구

#### 10.1 백업 전략

| 유형 | 주기 | 보관 기간 | 방법 |
|------|------|-----------|------|
| 전체 백업 | 매일 새벽 2시 | 30일 | pg_dump |
| 증분 백업 | 매시간 | 7일 | WAL 아카이브 |
| 로그 백업 | 실시간 | 1일 | S3에 업로드 |

**백업 스크립트**:
\`\`\`bash
#!/bin/bash
# daily_backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup"
DB_NAME="myapp"
S3_BUCKET="s3://my-backup-bucket"

# 로컬 백업
pg_dump -U postgres -d $DB_NAME -F c -b -v -f "$BACKUP_DIR/$DB_NAME_$DATE.backup"

# S3 업로드
aws s3 cp "$BACKUP_DIR/$DB_NAME_$DATE.backup" "$S3_BUCKET/backups/"

# 30일 이상 된 백업 삭제
find $BACKUP_DIR -name "*.backup" -mtime +30 -delete
\`\`\`

#### 10.2 복구 절차

\`\`\`bash
# 복구
pg_restore -U postgres -d mydb -v /backup/myapp_20240101_020000.backup

# 또는 psql
psql -U postgres -d mydb < /backup/myapp_backup.sql
\`\`\`

### 11. 성능 최적화

#### 11.1 쿼리 최적화

| 항목 | 방법 | 효과 |
|------|------|------|
| SELECT | 컬럼 명시 | 메모리 절약 |
| JOIN | 인덱스 활용 | 조인 속도 향상 |
| LIMIT/OFFSET | 커서 기반 페이징 | 대량 데이터 효율 |
| JSONB | GIN 인덱스 | JSON 쿼리 향상 |

#### 11.2 파티셔닝

- **대상 테이블**: activity_logs (대량 로그)
- **방식**: 날짜별 범위 파티셔닝
- **효과**: 쿼리 범위 축소, 관리 용이

---

## 작성 완료 후 확인사항

- [ ] 모든 테이블에 DDL이 있는가?
- [ ] ERD가 시각화되었는가?
- [ ] 인덱스 전략이 수립되었는가?
- [ ] 제약조건이 정의되었는가?
- [ ] 뷰와 트리거가 포함되었는가?
- [ ] 백업 및 복구 절차가 있는가?
- [ ] 회의에서 논의된 데이터 구조가 모두 반영되었는가?
`;
}
