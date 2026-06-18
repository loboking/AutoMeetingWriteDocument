'use client';

// 내보내기(PDF/PPTX/DOCX) 전용 mermaid 래스터화 유틸.
// 화면 MermaidDiagram의 SVG는 비동기 DOM 주입이라 export가 재사용 불가 →
// export 직전에 별도로 mermaid.render → SVG → PNG dataURL로 변환해 주입한다.
//
// 검증된 함정 회피:
// - htmlLabels:false : 라벨을 <foreignObject>(HTML) 대신 SVG <text>로 → canvas 래스터화 시 라벨 보존
// - useMaxWidth:false : SVG에 고정 px width/height 부여 → canvas 크기 0 방지
// - Blob URL : 한글 SVG를 btoa()하면 throw → Blob URL로 Image 로드
// - 흰 배경 fillRect : mermaid SVG 배경 투명 → 일부 변환기에서 검게 나오는 것 방지
import mermaid from 'mermaid';

export interface RenderedDiagram {
  dataUrl: string; // image/png
  w: number;
  h: number;
}

let exportInit = false;
function initForExport() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    logLevel: 'fatal',
    flowchart: { useMaxWidth: false, htmlLabels: false },
    themeVariables: { fontFamily: 'NanumGothic, Arial, sans-serif' },
  });
  exportInit = true;
}

function decodeEntities(code: string): string {
  return code
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/--&gt;/g, '-->');
}

// 본문의 모든 ```mermaid 블록 추출 (extractMermaidCode는 첫 1개만 → 여기선 전체).
export function extractAllMermaid(content: string): { raw: string; code: string }[] {
  const out: { raw: string; code: string }[] = [];
  const re = /```mermaid\n([\s\S]+?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({ raw: m[0], code: decodeEntities(m[1].trim()) });
  }
  return out;
}

// mermaid code → PNG dataURL. 실패 시 null(호출부는 코드 텍스트로 폴백).
export async function mermaidToPng(code: string, scale = 2): Promise<RenderedDiagram | null> {
  if (typeof window === 'undefined') return null;
  if (!exportInit) initForExport();
  try {
    const id = `exp-${Date.now()}-${Math.floor(performance.now())}-${code.length}`;
    const { svg } = await mermaid.render(id, code);

    // 픽셀 크기 산출: width/height 속성 우선, 없으면 viewBox
    let w = 800;
    let h = 600;
    const vb = svg.match(/viewBox="([\d.\s-]+)"/);
    if (vb) {
      const p = vb[1].trim().split(/\s+/).map(Number);
      if (p.length === 4) {
        w = p[2];
        h = p[3];
      }
    }
    const wMatch = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/);
    const hMatch = svg.match(/<svg[^>]*\bheight="([\d.]+)"/);
    if (wMatch) w = parseFloat(wMatch[1]);
    if (hMatch) h = parseFloat(hMatch[1]);
    if (!w || !h) {
      w = 800;
      h = 600;
    }

    // SVG → Image (Blob URL — 한글 안전)
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.width = w;
      img.height = h;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('svg image load failed'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * scale);
      canvas.height = Math.ceil(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);

      return { dataUrl: canvas.toDataURL('image/png'), w, h };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.warn('mermaidToPng failed:', e);
    return null;
  }
}

// 본문의 모든 mermaid 블록을 미리 PNG화 → code(정규화) 기준 맵.
// 순차 처리(동시 render 충돌 회피). raw도 키로 함께 넣어 조회 유연성 확보.
export interface PrerenderResult {
  byCode: Map<string, RenderedDiagram | null>;
  byRaw: Map<string, RenderedDiagram | null>;
}

function normalizeCode(code: string): string {
  return decodeEntities(code)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .join('\n')
    .trim();
}

export async function prerenderMermaid(content: string): Promise<PrerenderResult> {
  const blocks = extractAllMermaid(content);
  const byCode = new Map<string, RenderedDiagram | null>();
  const byRaw = new Map<string, RenderedDiagram | null>();
  for (const b of blocks) {
    const png = await mermaidToPng(b.code);
    byCode.set(normalizeCode(b.code), png);
    byRaw.set(b.raw, png);
  }
  return { byCode, byRaw };
}

// 파서가 재조립한 fence 본문으로 사전 렌더 결과를 조회.
export function lookupDiagram(pre: PrerenderResult, fenceBody: string): RenderedDiagram | null {
  return pre.byCode.get(normalizeCode(fenceBody)) ?? null;
}
