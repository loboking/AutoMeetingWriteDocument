import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 12347, strictPort: true, hmr: false, watch: null }, resolve: { alias: { '@': `${process.cwd()}/src` } } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu'] });
try {
 const page = await browser.newPage();
 page.on('pageerror', e => console.log('pageerror', e.message));
 page.on('console', m => { if (m.type() === 'error' || m.text().includes('TEST_RAW')) console.log('console', m.text().slice(0, 3500)); });
 let apiCalls = 0;
 page.on('request', r => { if (new URL(r.url()).origin === 'http://127.0.0.1:12347' && new URL(r.url()).pathname.startsWith('/api/')) apiCalls++; });
 await page.goto('http://127.0.0.1:12347/audit/local-summary/preview.html');
 console.log('gpu', await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())));
 const result = await page.evaluate(async () => {
   const { summarizeOnDevice } = await import('/src/lib/localSummary.ts');
   const start = Date.now();
   try {
     const summary = await summarizeOnDevice('민수: 다음 주 금요일까지 로그인 오류를 수정하겠습니다.\n지영: 담당자는 민수로 확정하고 기한은 10월 16일로 합시다.\n민수: 네, 동의합니다.\n지영: 결제 기능 추가는 다음 회의에서 논의하고 오늘은 보류합니다.', message => document.body.textContent = message);
     return { ok: true, summary, ms: Date.now() - start };
   } catch(e) { return { ok: false, error: e.message, ms: Date.now() - start }; }
 });
 console.log(JSON.stringify({ ...result, apiCalls }));
 await writeFile('audit/local-summary/result.json', JSON.stringify({ ...result, apiCalls }, null, 2));
} finally { await browser.close(); await server.close(); }
