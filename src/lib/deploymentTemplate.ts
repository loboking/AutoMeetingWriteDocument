// 배포 가이드 템플릿
export function getDeploymentPrompt(baseInfo: string, transcript: string): string {
  return `당신은 DevOps 엔지니어입니다. 다음 회의 내용을 바탕으로 **배포 가이드**를 작성해주세요.

${baseInfo}

## 원본 회의 내용 (분석 대상)
${transcript}

---

## 작성 가이드

**중요**: 위 회의 내용에서 실제 논의된 인프라, 배포 환경을 **추출**하여 가이드를 작성하세요.
회의 내용에 없는 내용을 지어내지 말고, 논의된 배포 방법을 바탕으로 구조화하세요.

## 배포 가이드 구조

### 1. 배포 환경
- **Staging**: staging.example.com
- **Production**: app.example.com

### 2. 사전 요구사항
- **Node.js**: v18 이상
- **메모리**: 2GB 이상
- **디스크**: 20GB 이상

### 3. 환경 변수
\`\`\`bash
NODE_ENV=production
API_URL=https://api.example.com
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
\`\`\`

### 4. 빌드 절차
\`\`\`bash
# 1. 의존성 설치
npm ci

# 2. 빌드
npm run build

# 3. 빌드 결과 확인
ls -la .next
\`\`\`

### 5. 배포 절차 (Vercel)
\`\`\`bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel --prod
\`\`\`

### 6. 배포 후 점검
- [ ] 서비스 상태 확인
- [ ] 헬스 체크: \`curl https://app.example.com/api/health\`
- [ ] 로그 확인: \`vercel logs\`

### 7. 롤백 절차
\`\`\`bash
# 이전 버전으로 롤백
vercel rollback
\`\`\`

### 8. 모니터링
- Vercel Analytics
- Sentry (에러 추적)

회의에서 논의된 실제 배포 환경과 절차를 바탕으로 작성하세요.`;
}
