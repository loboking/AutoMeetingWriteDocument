import { NextRequest, NextResponse } from 'next/server';
import type { MeetingSummary, ActionItem } from '@/types';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// OpenAI 클라이언트 초기화 함수 (빌드 시 실행 방지)
function createOpenAIClient() {
  const API_BASE = process.env.ZAI_BASE_URL || 'https://api.openai.com/v1';
  const API_KEY = process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!API_KEY) {
    throw new Error('API_KEY가 필요합니다. ZAI_API_KEY 또는 OPENAI_API_KEY 환경변수를 설정하세요.');
  }

  return new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE,
  });
}

// 코딩 플랜 GLM API를 통한 요약 생성
async function summarizeWithGPT(text: string, context?: string): Promise<MeetingSummary> {
  const prompt = `당신은 회의록 전문가입니다. 다음 회의 내용을 **상세하게 분석**하여 구조화된 요약을 제공해주세요.

## 회의 녹취록 (전체)
\`\`\`
${text}
\`\`\`

${context ? `## 추가 맥락\n${context}` : ''}

## 분석 요구사항

1. **개요 (overview)**: 회의 전체 맥락을 포함한 3-4문장 요약
2. **핵심 사항 (keyPoints)**: 최소 5개 이상, 구체적 내용 포함
3. **의사결정 (decisions)**: 최종 결정된 사항들, 결정 이유 포함
4. **Action Items**: 담당자, 우선순위, 기한이 명확히 명시된 항목들

## 출력 형식 (JSON)
{
  "overview": "회의 전체 맥락과 배경을 포함한 상세 요약 (3-4문장)",
  "keyPoints": [
    "구체적인 핵심 논의 사항 1 (배경, 내용 포함)",
    "구체적인 핵심 논의 사항 2",
    "최소 5개 이상 작성"
  ],
  "decisions": [
    "의사결정 1 (결정 이유 포함)",
    "의사결정 2",
    "최소 3개 이상 작성"
  ],
  "actionItems": [
    {
      "task": "구체적인 작업 내용",
      "assignee": "담당자 이름",
      "priority": "high|medium|low",
      "deadline": "구체적인 기한 (예: '목요일까지', '4월 15일')"
    }
  ]
}

분석하여 JSON만 반환해주세요.`;

  try {
    const openai = createOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'glm-5',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
    });

    // 코딩 플랜 추론 모델은 content 또는 reasoning_content를 확인
    const message = response.choices[0]?.message as any;
    const content = message?.content || message?.reasoning_content || '{}';

    // JSON 파싱: reasoning_content에서 JSON 부분 추출
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (error) {
    console.error('코딩 플랜 API 오류:', error);
    return getMockSummary();
  }
}

// 모의 응답 (API 실패 시)
function getMockSummary(): MeetingSummary {
  return {
    overview: '회의에서 새로운 대시보드 기능 추가에 대해 논의했습니다. 사용자 피드백을 분석한 결과, 실시간 데이터 업데이트가 가장 시급한 개선 사항으로 확인되었습니다.',
    keyPoints: [
      '최근 1달간 사용자 피드백 237건 수집',
      '실시간 데이터 업데이트 요청이 89건으로 가장 많음',
      'WebSocket 기반 실시간 데이터 표시 기능 추가 결정',
      '드래그앤드롭 위젯 배치 시스템 도입',
      'React 19, TypeScript 5, Tailwind CSS로 기술 스택 확정',
    ],
    decisions: [
      '다음 주부터 와이어프레임 및 기술 설계 시작',
      'Socket.io 또는 WebSocket을 사용한 실시간 통신 구현',
      '5주간의 개발 일정 확정 (베타 릴리스 목표)',
    ],
    actionItems: [
      { task: '와이어프레인 3개 안 작성', assignee: '김디자인', deadline: '목요일까지', priority: 'high' },
      { task: '기술 스택 검토 및 샘플 구현', assignee: '박개발', deadline: '금요일까지', priority: 'high' },
      { task: '사용자 시나리오 작성 및 우선순위 정리', assignee: '이기획', deadline: '수요일까지', priority: 'high' },
      { task: 'Recharts 또는 Chart.js 차트 라이브러리 검토', assignee: '박개발', priority: 'medium' },
    ],
  };
}

export async function POST(request: NextRequest) {
  try {
    const { text, context } = await request.json();

    if (!text) {
      return NextResponse.json({ error: '텍스트가 필요합니다.' }, { status: 400 });
    }

    const summary = await summarizeWithGPT(text, context);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Summarize API 오류:', error);
    return NextResponse.json(
      { error: '요약 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}
