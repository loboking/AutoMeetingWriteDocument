// 배포 가이드 템플릿
export function getDeploymentPrompt(baseInfo: string, transcript: string): string {
  return `당신은 10년 경력의 DevOps 엔지니어입니다. 다음 회의 내용을 바탕으로 **매우 상세하고 전문적인 배포 가이드**를 작성해주세요.

${baseInfo}

## 구체적 추출 가이드 (Concrete Extraction Guide)

회의 내용에서 다음 정보를 **반드시 추출**하세요. 없는 경우 "추정 필요"라고 표시하세요.

### 배포 추출 체크리스트
- [ ] **환경**: 개발/스테이징/프로덕션 URL
- [ ] **리소스**: CPU, 메모리, 디스크 사양
- [ ] **배포 방식**: Vercel, Docker, Kubernetes 등
- [ ] **환경변수**: 필수 환경변수 목록
- [ ] **배포 일정**: 배포 시간대, 빈도
- [ ] **다운타임**: 허용 가능한 중단 시간
- [ ] **롤백**: 롤백 절차 및 시간
- [ ] **모니터링**: 헬스체크 URL, 알림 채널

---

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드 (반드시 준수하세요)

1. **모든 섹션 작성**: 아래 배포 가이드 구조의 모든 섹션을 빠짐없이 작성하세요.
2. **상세성**: 각 단계는 구체적인 명령어와 예상 결과를 포함해야 합니다.
3. **재현성**: 누구나 동일하게 배포할 수 있도록 작성하세요.
4. **안전성**: 롤백 절차와 모니터링 방법을 포함하세요.
5. **환경 고려**: 개발, 스테이징, 프로덕션 환경을 모두 다루세요.

---

## 배포 가이드 구조 (모든 섹션 필수 작성)

### 1. 문서 정보

- **문서 버전**: v1.0
- **작성일**: [날짜]
- **작성자**: DevOps팀
- **문서 상태**: 초안/검토 중/승인 완료

**변경 이력**:
| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| v1.0 | [날짜] | 초기 작성 | DevOps팀 |

### 2. 배포 환경

| 환경 | URL | 용도 | 데이터베이스 | 리소스 |
|------|-----|------|-------------|--------|
| Local | localhost:3000 | 개발 | SQLite (in-memory) | - |
| Dev | dev.example.com | 개발 서버 | PostgreSQL (dev-db) | 1CPU, 2GB RAM |
| Staging | staging.example.com | 스테이징 | PostgreSQL (staging-db) | 2CPU, 4GB RAM |
| Production | app.example.com | 프로덕션 | PostgreSQL (prod-db) | 4CPU, 8GB RAM |

**환경별 접근**:
\`\`\`bash
# Dev
ssh dev@dev.example.com

# Staging
ssh staging@staging.example.com

# Production
ssh prod@app.example.com
\`\`\`

### 3. 사전 요구사항

#### 3.1 로컬 개발 환경

| 항목 | 최소 사양 | 권장 사양 |
|------|----------|----------|
| Node.js | v18.x | v20.x (LTS) |
| npm | v9.x | v10.x |
| 메모리 | 2GB | 4GB |
| 디스크 | 10GB | 20GB |

**설치 확인**:
\`\`\`bash
node --version  # v18.x 이상
npm --version   # v9.x 이상
git --version   # v2.x 이상
\`\`\`

#### 3.2 서버 환경

| 항목 | Dev | Staging | Production |
|------|-----|---------|------------|
| OS | Ubuntu 22.04 | Ubuntu 22.04 | Ubuntu 22.04 |
| Docker | v24.x | v24.x | v24.x |
| Docker Compose | v2.x | v2.x | v2.x |
| Nginx | v1.24+ | v1.24+ | v1.24+ |

**서버 초기 설정**:
\`\`\`bash
# 패키지 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Docker Compose 설치
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 방화벽 설정
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
\`\`\`

### 4. 환경 변수

#### 4.1 필수 환경 변수

\`\`\`bash
# 애플리케이션
NODE_ENV=production
PORT=3000

# 데이터베이스
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# 인증
JWT_SECRET=your-super-secret-key-change-this
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_EXPIRES_IN=30d

# API
API_BASE_URL=https://api.example.com
API_KEY=your-api-key

# 외부 서비스
REDIS_URL=redis://localhost:6379
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name

# 이메일
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# 모니터링
SENTRY_DSN=https://xxx@sentry.io/xxx
GA_TRACKING_ID=G-XXXXXXXXXX

# 기타
LOG_LEVEL=info
CORS_ORIGIN=https://app.example.com
\`\`\`

#### 4.2 환경별 설정

**Dev (.env.development)**:
\`\`\`bash
NODE_ENV=development
DATABASE_URL=postgresql://dev:devpass@localhost:5432/devdb
LOG_LEVEL=debug
\`\`\`

**Staging (.env.staging)**:
\`\`\`bash
NODE_ENV=staging
DATABASE_URL=postgresql://staging:stagingpass@localhost:5432/stagingdb
LOG_LEVEL=info
\`\`\`

**Production (.env.production)**:
\`\`\`bash
NODE_ENV=production
DATABASE_URL=postgresql://prod:prodpass@localhost:5432/proddb
LOG_LEVEL=warn
\`\`\`

### 5. 빌드 절차

#### 5.1 로컬 빌드

\`\`\`bash
# 1. 의존성 설치
npm ci

# 2. 환경 변수 설정
cp .env.example .env.local
# .env.local 편집

# 3. 타입 검사 (TypeScript)
npm run type-check

# 4. 린트
npm run lint

# 5. 테스트
npm run test

# 6. 빌드
npm run build

# 7. 빌드 결과 확인
ls -la .next
\`\`\`

#### 5.2 Docker 빌드

**Dockerfile**:
\`\`\`dockerfile
# Base image
FROM node:18-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
\`\`\`

**빌드 명령어**:
\`\`\`bash
# Docker 이미지 빌드
docker build -t myapp:latest .

# 태그 지정
docker tag myapp:latest myapp:v1.0.0

# 레지스트리에 푸시
docker push myregistry/myapp:v1.0.0
\`\`\`

### 6. 배포 절차

#### 6.1 Vercel 배포 (권장)

**설치**:
\`\`\`bash
npm install -g vercel
\`\`\`

**초기 배포**:
\`\`\`bash
# 프로젝트 연결
vercel link

# 프리뷰 배포
vercel

# 프로덕션 배포
vercel --prod
\`\`\`

**환경 변수 설정**:
\`\`\`bash
# Vercel 대시보드 또는 CLI
vercel env add DATABASE_URL production
vercel env add JWT_SECRET production
\`\`\`

#### 6.2 Docker Compose 배포

**docker-compose.yml**:
\`\`\`yaml
version: '3.8'

services:
  app:
    image: myapp:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=\${DB_NAME}
      - POSTGRES_USER=\${DB_USER}
      - POSTGRES_PASSWORD=\${DB_PASSWORD}
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
\`\`\`

**배포 명령어**:
\`\`\`bash
# 서버에서 실행
docker-compose pull
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 상태 확인
docker-compose ps
\`\`\`

#### 6.3 Kubernetes 배포

**deployment.yaml**:
\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: myregistry/myapp:v1.0.0
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: myapp-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  selector:
    app: myapp
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
\`\`\`

**배포 명령어**:
\`\`\`bash
kubectl apply -f deployment.yaml
kubectl get pods
kubectl logs -f deployment/myapp
\`\`\`

### 7. 데이터베이스 마이그레이션

\`\`\`bash
# 마이그레이션 실행
npm run migrate

# 마이그레이션 롤백
npm run migrate:rollback

# 마이그레이션 상태 확인
npm run migrate:status
\`\`\`

**마이그레이션 전 체크리스트**:
- [ ] 백업 완료
- [ ] 스테이징에서 테스트 완료
- [ ] 다운타임 시간 사용자에게 통보
- [ ] 롤백 계획 준비

### 8. 배포 후 점검

#### 8.1 헬스 체크

\`\`\`bash
# 헬스 엔드포인트
curl https://app.example.com/api/health

# 예상 응답
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0"
}
\`\`\`

#### 8.2 점검 항목

| 항목 | 확인 방법 | 기대 결과 |
|------|----------|----------|
| 서비스 상태 | curl /api/health | 200 OK |
| 데이터베이스 연결 | 로그 확인 | 연결 성공 |
| 로그인 기능 | 수동 테스트 | 로그인 성공 |
| 주요 API | Postman 테스트 | 정상 응답 |
| SSL 인증서 | 브라우저 확인 | 유효함 |

**체크리스트**:
- [ ] 서비스 기동 확인
- [ ] 헬스 체크 통과
- [ ] 데이터베이스 연결 정상
- [ ] 로그인 기능 정상
- [ ] 주요 API 동작 확인
- [ ] SSL 인증서 유효
- [ ] 에러 로그 없음

### 9. 롤백 절차

#### 9.1 Vercel 롤백

\`\`\`bash
# 이전 배포로 롤백
vercel rollback

# 특정 배포로 롤백
vercel rollback <deployment-url>
\`\`\`

#### 9.2 Docker 롤백

\`\`\`bash
# 이전 이미지로 되돌리기
docker-compose pull myapp:v1.0.0
docker-compose up -d

# 또는 git reset 후 재배포
git reset --hard HEAD~1
docker-compose build
docker-compose up -d
\`\`\`

#### 9.3 Kubernetes 롤백

\`\`\`bash
# 롤백
kubectl rollout undo deployment/myapp

# 특정 리비전으로 롤백
kubectl rollout undo deployment/myapp --to-revision=2

# 롤백 상태 확인
kubectl rollout status deployment/myapp
\`\`\`

### 10. 모니터링

#### 10.1 애플리케이션 모니터링

| 도구 | 용도 | 설정 |
|------|------|------|
| Sentry | 에러 추적 | DSN 환경 변수 설정 |
| Vercel Analytics | 성능 | Vercel 대시보드 |
| Google Analytics | 사용자 분석 | GA 추적 코드 |
| New Relic | APM | 에이전트 설치 |

#### 10.2 서버 모니터링

\`\`\`bash
# CPU/메모리 모니터링
htop

# 디스크 사용량
df -h

# 로그 모니터링
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Docker 로그
docker-compose logs -f app
\`\`\`

#### 10.3 알림 설정

| 알림 유형 | 조건 | 알림 채널 |
|-----------|------|-----------|
| 서비스 다운 | 헬스 체크 실패 | Slack, 이메일 |
| 에러율 증가 | 5분간 1% 이상 | Slack |
| 응답 시간 지연 | p95 > 1초 | Slack |
| 디스크 부족 | 80% 이상 | 이메일 |

### 11. 보안 설정

#### 11.1 SSL/TLS

**Let's Encrypt 인증서**:
\`\`\`bash
# Certbot 설치
sudo apt install certbot python3-certbot-nginx

# 인증서 발급
sudo certbot --nginx -d app.example.com

# 자동 갱신
sudo certbot renew --dry-run
\`\`\`

#### 11.2 방화벽

\`\`\`bash
# UFW 설정
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
\`\`\`

#### 11.3 보안 헤더

**nginx.conf**:
\`\`\`nginx
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'" always;
\`\`\`

---

## 작성 완료 후 확인사항

- [ ] 모든 환경의 배포 절차가 있는가?
- [ ] 환경 변수가 상세히 정의되었는가?
- [ ] 롤백 절차가 명확한가?
- [ ] 모니터링 방법이 포함되었는가?
- [ ] 보안 설정이 포함되었는가?
- [ ] 헬스 체크 방법이 있는가?
- [ ] 회의에서 논의된 배포 환경이 모두 반영되었는가?
`;
}
