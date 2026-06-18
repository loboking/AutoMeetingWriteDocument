'use client';

// 다이어그램/이미지 개별 다운로드 유틸 (라이트박스용).
// - mermaid: 코드 재렌더(htmlLabels:false)로 PNG/SVG. 화면 SVG 직렬화 금지(foreignObject 라벨 소실/taint).
// - HTML 뷰어(ScreenDiagram 등): html2canvas로 PNG. Tailwind v4 oklch 미지원 → onclone에서 rgb로 평탄화.
// - 본문 이미지: 원본 포맷 그대로 다운로드.
import { saveAs } from 'file-saver';
import { mermaidToPng } from '@/lib/mermaidExport';
import mermaid from 'mermaid';

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// mermaid 코드 → PNG (htmlLabels:false 파이프라인 재사용). 실패 시 false.
export async function downloadMermaidPng(code: string, filename: string): Promise<boolean> {
  const r = await mermaidToPng(code, 3); // null 가능 → 가드
  if (!r) return false;
  saveAs(dataUrlToBlob(r.dataUrl), filename);
  return true;
}

// mermaid 코드 → SVG (export용 재렌더, htmlLabels:false). 화면 SVG 직렬화 안 함.
let svgInit = false;
export async function downloadMermaidSvg(code: string, filename: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!svgInit) {
    mermaid.initialize({
      startOnLoad: false, theme: 'default', securityLevel: 'loose', logLevel: 'fatal',
      flowchart: { useMaxWidth: false, htmlLabels: false },
      themeVariables: { fontFamily: 'NanumGothic, Arial, sans-serif' },
    });
    svgInit = true;
  }
  try {
    const { svg } = await mermaid.render(`exp-svg-${Date.now()}-${code.length}`, code);
    saveAs(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
    return true;
  } catch (e) {
    console.warn('mermaid svg export failed:', e);
    return false;
  }
}

// ── oklch/oklab → sRGB 변환 ──
// 일부 브라우저는 getComputedStyle이 oklch를 rgb로 변환하지 않고 원문 그대로 반환한다.
// html2canvas 1.4.1은 oklch/oklab/color-mix 미지원 → 캡처 실패. 직접 sRGB로 변환해 치환한다.
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  // OKLCH → OKLab
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  // OKLab → LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  // LMS → linear sRGB
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  // linear → gamma sRGB
  const gamma = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  r = gamma(r); g = gamma(g); bl = gamma(bl);
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return [clamp(r), clamp(g), clamp(bl)];
}

// 문자열 내 모든 oklch(...) 토큰을 rgb(...)로 치환. 알파(/ a) 지원.
function replaceOklch(value: string): string {
  if (!value || (!value.includes('oklch') && !value.includes('oklab'))) return value;
  return value.replace(/okl(?:ch|ab)\(([^)]+)\)/gi, (full, inner: string) => {
    try {
      const isLab = /^oklab/i.test(full);
      const slash = inner.split('/');
      const parts = slash[0].trim().split(/[\s,]+/).map((p) => p.trim());
      const alpha = slash[1]?.trim();
      const num = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p));
      let rgb: [number, number, number];
      if (isLab) {
        // oklab(L a b) → 근사: C/H로 환산
        const L = num(parts[0]), a = parseFloat(parts[1]), b = parseFloat(parts[2]);
        const C = Math.hypot(a, b);
        const H = (Math.atan2(b, a) * 180) / Math.PI;
        rgb = oklchToRgb(L, C, H);
      } else {
        rgb = oklchToRgb(num(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
      }
      const a = alpha != null ? (alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha)) : undefined;
      return a != null && a < 1 ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    } catch {
      return 'rgb(128,128,128)'; // 변환 실패 시 회색 폴백
    }
  });
}

// clone된 doc의 모든 노드에서 oklch/oklab 색을 sRGB로 변환해 inline 고정.
// gradient(color-mix in oklab 포함)는 변환 실패 가능성 높아 단색 배경으로 평탄화. 화면 영향 없음(clone 대상).
function neutralizeOklch(doc: Document) {
  const view = doc.defaultView;
  if (!view) return;
  const COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color'];
  doc.querySelectorAll<HTMLElement>('*').forEach((node) => {
    const cs = view.getComputedStyle(node);
    for (const prop of COLOR_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && (v.includes('oklch') || v.includes('oklab'))) {
        node.style.setProperty(prop, replaceOklch(v));
      }
    }
    // gradient/color-mix는 평탄화 (변환 어려움). 단색 배경으로.
    const bgImg = cs.backgroundImage;
    if (bgImg && bgImg !== 'none' && (bgImg.includes('oklab') || bgImg.includes('oklch') || bgImg.includes('color-mix') || bgImg.includes('gradient'))) {
      node.style.backgroundImage = 'none';
      const bg = cs.backgroundColor;
      if (bg && (bg.includes('oklch') || bg.includes('oklab'))) node.style.backgroundColor = replaceOklch(bg);
    }
    // box-shadow에 oklch가 있으면 제거(캡처 실패 방지)
    if (cs.boxShadow && (cs.boxShadow.includes('oklch') || cs.boxShadow.includes('oklab'))) {
      node.style.boxShadow = 'none';
    }
  });
}

// HTML 뷰어 DOM → PNG. 전체 폭(scrollWidth) 캡처로 가로 스크롤 잘림 방지.
export async function downloadElementPng(el: HTMLElement, filename: string): Promise<boolean> {
  if (!el) return false;
  const mod = await import('html2canvas');
  const html2canvas = mod.default;
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      width: el.scrollWidth,
      height: el.scrollHeight,
      windowWidth: el.scrollWidth,
      onclone: (cloned: Document) => neutralizeOklch(cloned),
    });
    await new Promise<void>((resolve) => {
      canvas.toBlob((b) => {
        if (b) saveAs(b, filename);
        resolve();
      }, 'image/png');
    });
    return true;
  } catch (e) {
    console.warn('element png export failed:', e);
    return false;
  }
}

// 본문 이미지: 원본 포맷 그대로 다운로드. CORS 실패 시 새 탭 폴백.
export async function downloadImageOriginal(src: string, fallbackName = 'image'): Promise<boolean> {
  try {
    const res = await fetch(src, { mode: 'cors' });
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').split('+')[0]; // image/svg+xml → svg
    const fromUrl = src.split('/').pop()?.split('?')[0] || '';
    const name = fromUrl.includes('.') ? fromUrl : `${fallbackName}.${ext}`;
    saveAs(blob, name);
    return true;
  } catch {
    window.open(src, '_blank', 'noopener');
    return false;
  }
}
