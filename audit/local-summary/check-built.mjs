import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const files = await readdir('.next/static/chunks');
let bootstrap;
for (const file of files.filter(f => f.endsWith('.js'))) {
 const source = await readFile(`.next/static/chunks/${file}`, 'utf8');
 const match = source.match(/\.b\(\w+,"(static\/chunks\/turbopack-worker-[^"]+)",(\["static\/chunks\/[^\]]+\])/);
 if (match) { bootstrap = { path: '/_next/' + match[1], chunks: JSON.parse(match[2]).map(p => '/_next/' + p) }; break; }
}
if (!bootstrap) throw new Error('Compiled worker not found');
const server = createServer(async (req, res) => {
 try {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Built worker test</title>'); return; }
  if (!path.startsWith('/_next/static/') || path.includes('..')) { res.writeHead(404).end(); return; }
  res.setHeader('content-type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  res.end(await readFile('.next/' + path.slice('/_next/'.length)));
 } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(12348, '127.0.0.1', resolve));
const sample = process.argv[2] === 'assigned' ? '민수: 다음 주 금요일까지 로그인 오류를 수정하겠습니다.\n지영: 담당자는 민수로 확정하고 기한은 10월 16일로 합시다.\n민수: 네, 동의합니다.\n지영: 결제 기능 추가는 다음 회의에서 논의하고 오늘은 보류합니다.' : '유나: 이번 주 회의에서는 디자인 개편을 결정하지 않고 보류합니다.\n준호: 동의합니다. 추가 개발 작업도 아직 확정하지 않았습니다.';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
 const page = await browser.newPage();
 page.on('pageerror', error => console.log('pageerror', error.message));
 page.on('console', message => { if (message.text().startsWith('TEST_PROGRESS')) console.log(message.text()); });
 const requests = [];
 page.on('request', r => { if (r.url().includes('/api/summarize') || r.url().includes('/api/generate-doc')) requests.push(r.url()); });
 await page.goto('http://127.0.0.1:12348/');
 const result = await page.evaluate(async bootstrap => new Promise(resolve => {
  const start = Date.now();
  const url = bootstrap.path + '?params=' + encodeURIComponent(JSON.stringify([bootstrap.chunks, '', '', '']));
  const worker = new Worker(url);
  const finish = value => { clearTimeout(timeout); worker.terminate(); resolve({ ...value, ms: Date.now() - start }); };
  const timeout = setTimeout(() => finish({ error: 'timeout' }), 180000);
  worker.onerror = event => finish({ error: event.message });
  worker.onmessage = ({ data }) => { if (data.type !== 'progress') finish(data); else if (data.message.includes('요약 중')) console.log('TEST_PROGRESS', data.message); };
  worker.postMessage({ text: bootstrap.text });
 }), { ...bootstrap, text: sample });
 console.log(JSON.stringify({ result, apiCalls: requests.length }));
 await writeFile(`audit/local-summary/built-${process.argv[2] || 'deferred'}-result.json`, JSON.stringify({ result, apiCalls: requests.length }, null, 2));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
