import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60; // 대용량 파일 추출 여유

async function extractFromTxt(buffer: Buffer): Promise<string> {
  return buffer.toString('utf-8');
}

// unpdf: native 의존성 0개(PDF.js 자체 번들) → Vercel/Turbopack 안전.
async function extractFromPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const { text } = await extractText(pdf, { mergePages: true }); // string 반환
    return text;
  } finally {
    await pdf.destroy(); // 함수 인스턴스 메모리 해제
  }
}

// mammoth: 순수 JS. 표/이미지/서식은 버리고 순수 텍스트만 추출.
async function extractFromDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

// xlsx(SheetJS): 모든 시트를 "## 시트명 + CSV"로 직렬화 → LLM이 시트 경계 파악 용이.
function extractFromXlsx(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer' }); // cellDates 미설정 → 날짜 타임존 밀림 회피
  return wb.SheetNames
    .map((name) => {
      const ws = wb.Sheets[name];
      if (!ws || !ws['!ref']) return `## ${name}\n(빈 시트)`;
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      return `## ${name}\n${csv.trim()}`;
    })
    .join('\n\n---\n\n');
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const document = formData.get('document') as File;

    if (!document) {
      return NextResponse.json({ error: '파일이 필요합니다.' }, { status: 400 });
    }

    const name = document.name.toLowerCase();
    const type = (document.type || '').toLowerCase();

    // PPTX 명확 거부 (텍스트로 폴백돼 깨진 바이너리가 읽히는 것 방지)
    if (name.endsWith('.pptx') || type.includes('presentationml')) {
      return NextResponse.json(
        { error: 'PPTX(파워포인트)는 지원하지 않습니다. PDF·DOCX·XLSX·TXT·MD로 변환 후 업로드하세요.' },
        { status: 415 }
      );
    }
    // 구형 .doc(OLE)도 거부 (mammoth가 의미불명 에러를 던지므로 사전 차단)
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      return NextResponse.json(
        { error: '.doc(Word 97-2003)는 지원하지 않습니다. .docx로 변환 후 업로드하세요.' },
        { status: 415 }
      );
    }

    const arrayBuffer = await document.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let text = '';

    try {
      if (type === 'application/pdf' || name.endsWith('.pdf')) {
        text = await extractFromPdf(buffer);
        if (!text.trim()) {
          return NextResponse.json(
            { error: 'PDF에서 텍스트를 찾지 못했습니다. 스캔(이미지) PDF는 지원하지 않습니다. 텍스트 기반 PDF를 업로드하세요.' },
            { status: 422 }
          );
        }
      } else if (
        name.endsWith('.docx') ||
        type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        text = await extractFromDocx(buffer);
      } else if (
        name.endsWith('.xlsx') ||
        type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) {
        text = extractFromXlsx(buffer);
      } else if (type === 'text/plain' || name.endsWith('.txt') || name.endsWith('.md')) {
        text = await extractFromTxt(buffer);
      } else {
        return NextResponse.json({ error: '지원하지 않는 파일 형식입니다.' }, { status: 415 });
      }
    } catch (parseErr) {
      // 암호화/손상 파일 등 라이브러리 throw
      console.error('Extract parse error:', parseErr);
      return NextResponse.json(
        { error: '파일을 읽지 못했습니다. 손상되었거나 암호화된 파일일 수 있습니다.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('Extract text error:', error);
    return NextResponse.json({ error: '텍스트 추출에 실패했습니다.' }, { status: 500 });
  }
}
