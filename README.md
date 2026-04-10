# MeetingAutoDocs

회의 녹음 → 텍스트 변환 → AI 요약 → PRD 자동 생성 플랫폼

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-blue)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38bdf8)](https://tailwindcss.com/)

## 📋 개요

MeetingAutoDocs는 회의 녹음을 자동으로 텍스트로 변환하고, AI가 요약과 기획서(PRD)를 생성해주는 웹 애플리케이션입니다.

### 주요 기능

- 🎙️ **브라우저 녹음**: 마이크로 실시간 회의 녹음
- 🔄 **STT 변환**: OpenAI Whisper API를 사용한 음성-텍스트 변환
- ✨ **AI 요약**: Claude API를 활용한 회의 내용 요약
- 📄 **PRD 생성**: 회의 내용을 바탕으로 자동 기획서 작성
- 💾 **저장소**: 로컬 스토리지를 통한 회의 기록 영구 저장

## 🚀 빠른 시작

### 1. 리포지토리 클론

```bash
git clone <repository-url>
cd meeting-auto-docs
```

### 2. 의존성 설치

```bash
npm install
# 또는
yarn install
# 또는
pnpm install
```

### 3. 환경 변수 설정

`.env.local` 파일을 프로젝트 루트에 생성하고 다음 내용을 추가하세요:

```bash
# .env.local

# Z.ai 코딩 플랜 (Coding Plan) API
ZAI_API_KEY=your-zai-api-key-here
ZAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4

# 또는 OpenAI API (대안 - Whisper STT)
OPENAI_API_KEY=sk-your-openai-api-key-here
```

**API 키 가져오기:**
- **Z.ai 코딩 플랜**: [https://z.ai/chat](https://z.ai/chat) - 추천 (코딩 플랜 구독 필요)
- **OpenAI**: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys) - Whisper STT용

> 💡 **참고**: 코딩 플랜 구독 시 잔액 기반이 아닌 구독 기반으로 GLM 모델을 무제한 사용할 수 있습니다.
> 지원 모델: glm-5, glm-5.1, glm-5-turbo, glm-4.7 (현재 glm-5 사용)

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인합니다.

## 📖 사용 방법

### 회의 녹음 흐름

1. **새 회의 시작**
   - 회의 제목을 입력 (선택사항)
   - "회의 시작하기" 버튼 클릭

2. **녹음**
   - 마이크 아이콘을 클릭하여 녹음 시작
   - 일시정지/재개 가능
   - 정지 버튼으로 녹음 완료

3. **텍스트 변환**
   - 녹음된 오디오 확인
   - "텍스트 변환하기" 클릭
   - Whisper API가 음성을 텍스트로 변환
   - 필요한 경우 텍스트 수정 가능

4. **AI 요약**
   - "AI 요약 생성" 버튼 클릭
   - Claude API가 회의 내용을 분석
   - 핵심 사항, 의사결정, Action Items 추출

5. **PRD 생성**
   - "PRD 생성하기" 버튼 클릭
   - 요약 내용을 바탕으로 구조화된 기획서 자동 생성
   - 마크다운 형식으로 다운로드 가능

## 🏗️ 프로젝트 구조

```
meeting-auto-docs/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API Routes
│   │   │   ├── transcribe/    # Whisper STT
│   │   │   ├── summarize/     # Claude 요약
│   │   │   └── generate-prd/  # Claude PRD 생성
│   │   ├── layout.tsx
│   │   └── page.tsx           # 메인 페이지
│   ├── components/            # React 컴포넌트
│   │   ├── ui/               # shadcn/ui 컴포넌트
│   │   ├── MeetingRecorder.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── SummaryViewer.tsx
│   │   └── PrdViewer.tsx
│   ├── hooks/                # React Hooks
│   │   └── useRecorder.ts    # 녹음 로직
│   ├── store/                # Zustand 상태 관리
│   │   └── meetingStore.ts
│   └── types/                # TypeScript 타입 정의
│       └── index.ts
├── public/                   # 정적 리소스
├── .env.local.example        # 환경 변수 예시
└── package.json
```

## 🛠️ 기술 스택

### 프론트엔드
- **Next.js 16.2** - React 프레임워크 (App Router)
- **React 19.2** - UI 라이브러리
- **TypeScript 5.0** - 타입 안전성
- **Tailwind CSS 4.0** - 스타일링
- **shadcn/ui** - UI 컴포넌트 라이브러리
- **Zustand** - 상태 관리
- **Lucide React** - 아이콘 라이브러리

### 백엔드
- **Next.js API Routes** - 서버리스 API
- **Z.ai 코딩 플랜 GLM API** - AI 요약 및 문서 생성 (구독 기반)
  - 지원 모델: glm-5.1, glm-5-turbo, glm-4.7, glm-4.5-air
- **OpenAI Whisper API** - 음성-텍스트 변환 (대안)

### 브라우저 API
- **MediaRecorder API** - 오디오 녹음
- **Web Audio API** - 오디오 처리

## 🔧 API 명세

### POST /api/transcribe
녹음된 오디오를 텍스트로 변환합니다.

**Request:**
- `audioFile`: File (audio/webm)
- `language`: string (기본값: 'ko')

**Response:**
```json
{
  "text": "변환된 텍스트",
  "duration": 120.5
}
```

### POST /api/summarize
텍스트를 요약합니다.

**Request:**
```json
{
  "text": "회의 텍스트",
  "context": "회의 제목"
}
```

**Response:**
```json
{
  "summary": {
    "overview": "회의 개요",
    "keyPoints": ["핵심 사항 1", "핵심 사항 2"],
    "decisions": ["의사결정 1"],
    "actionItems": [
      {
        "task": "작업 내용",
        "assignee": "담당자",
        "priority": "high",
        "deadline": "기한"
      }
    ]
  }
}
```

### POST /api/generate-prd
요약을 바탕으로 PRD를 생성합니다.

**Request:**
```json
{
  "summary": { ... },
  "meetingInfo": {
    "title": "회의 제목",
    "date": "2024-01-01",
    "attendees": ["참여자1", "참여자2"]
  }
}
```

**Response:**
```json
{
  "prd": "# PRD: 회의 제목\n\n..."
}
```

## 🧪 개발 및 테스트

### 빌드
```bash
npm run build
```

### 프로덕션 실행
```bash
npm start
```

### 린트
```bash
npm run lint
```

## 📝 환경 변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `ZAI_API_KEY` | Z.ai 코딩 플랜 API 키 | 선택* |
| `ZAI_BASE_URL` | 코딩 플랜 API 베이스 URL (/api/coding/paas/v4) | 선택 |
| `OPENAI_API_KEY` | OpenAI API 키 (Whisper용) | 선택* |

*선택사항이지만, 실제 AI 기능을 사용하려면 필요합니다. 없으면 모의 응답이 반환됩니다. 코딩 플랜 구독을 추천합니다.*

## 🎯 향후 계획

- [ ] 회의 기록 검색 기능
- [ ] 여러 언어 지원
- [ ] 화자 분리 (Speaker Diarization)
- [ ] 회의 참여자 관리
- [ ] 이메일/Slack 공유 기능
- [ ] 마크다운/PDF 내보내기
- [ ] 다크 모드 개선
- [ ] PWA 지원

## 🤝 기여

기여를 환영합니다! 이슈를 열거나 PR을 제출해주세요.

## 📄 라이선스

MIT License

## 🙋 자주 묻는 질문

### Q: API 키가 없으면 작동하지 않나요?
A: API 키 없이도 앱을 실행하고 UI를 테스트할 수 있습니다. 다만 실제 AI 기능 대신 모의 응답이 반환됩니다.

### Q: 브라우저에서 녹음이 안 돼요.
A: 브라우저가 마이크 접근 권한을 요청할 때 "허용"을 선택해주세요. HTTPS 환경이 필요할 수 있습니다.

### Q: Z.ai와 OpenAI 중 뭐를 써야 하나요?
A: Z.ai **코딩 플랜** 구독을 추천합니다. 구독 기반으로 GLM 모델(glm-5.1, glm-4.7 등)을 무제한 사용할 수 있어 가성비가 우수합니다.

### Q: 지원되는 브라우저는 무엇인가요?
A: Chrome, Firefox, Safari, Edge의 최신 버전을 지원합니다. MediaRecorder API를 지원하는 브라우저라면 작동합니다.

### Q: 녹음 파일은 어디에 저장되나요?
A: 녹음 파일은 서버에 전송되어 텍스트로 변환된 후 즉시 삭제됩니다. 회의 데이터는 브라우저의 로컬 스토리지에만 저장됩니다.

## 📞 지원

문제가 있거나 도움이 필요하시면 [이슈](https://github.com/your-repo/issues)를 등록해주세요.

---

Made with ❤️ using Next.js and AI
# AutoMeetingWriteDocument
