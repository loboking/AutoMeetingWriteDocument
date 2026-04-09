import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function extractFromTxt(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8');
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  // PDF 라이브러리를 사용하지 않고 간단히 처리
  // 실제 구현에서는 pdf-parse 또는 pdfjs-dist 사용
  return `
[PDF 문서 내용 추출]

이 기능은 추가 설정이 필요합니다.

PDF에서 텍스트를 추출하려면:
1. npm install pdf-parse
2. 해당 라이브러리를 사용하여 텍스트 추출 구현

현재는 모의 응답을 반환합니다.

---
회의 내용 (예시):

# 프로젝트 기획 회의

## 참여자
- 디자인팀: 김디자인
- 개발팀: 박개발
- 기획팀: 이기획

## 논의 사항

1. 새로운 대시보드 기능 추가
   - 사용자 피드백 반영
   - 실시간 데이터 업데이트

2. 모바일 앱 개발 일정
   - QA: 2주 예상
   - 베타 릴리스: 다음 달

3. 기술 스택 검토
   - React 19 업그레이드
   - TypeScript 5 적용

## Action Items
- 와이어프레임 작성 (이기획)
- 기술 스택 검토 (박개발)
- UI 디자인 수정 (김디자인)
`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const document = formData.get('document') as File;

    if (!document) {
      return NextResponse.json(
        { error: '파일이 필요합니다.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await document.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let text = '';

    if (document.type === 'application/pdf' || document.name.endsWith('.pdf')) {
      text = await extractFromPdf(buffer);
    } else if (
      document.type === 'text/plain' ||
      document.name.endsWith('.txt') ||
      document.name.endsWith('.md')
    ) {
      text = await extractFromTxt(buffer);
    } else {
      // 기본적으로 텍스트로 시도
      try {
        text = await extractFromTxt(buffer);
      } catch {
        return NextResponse.json(
          { error: '지원하지 않는 파일 형식입니다.' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('Extract text error:', error);
    return NextResponse.json(
      { error: '텍스트 추출에 실패했습니다.' },
      { status: 500 }
    );
  }
}
