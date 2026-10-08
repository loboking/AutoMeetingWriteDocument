import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 12346 }, resolve: { alias: { '@': `${process.cwd()}/src` } } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
 const page = await browser.newPage();
 page.on('pageerror', e => console.error(e.message));
 await page.goto('http://127.0.0.1:12346/audit/export-template/preview.html');
 await page.waitForFunction(() => window.sampleReady, { timeout: 60000 });
 await mkdir('audit/export-template/output', { recursive: true });
 await page.pdf({ path: 'audit/export-template/output/reference-print.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
 for (const format of ['docx', 'pdf']) {
   const bytes = await page.evaluate(format => window.exportSample(format), format);
   await writeFile(`audit/export-template/output/reference.${format}`, Buffer.from(bytes));
   console.log(format, bytes.length);
 }
 console.log('overflow', await page.locator('.document-export').evaluate(el => el.scrollWidth > el.clientWidth));
} finally { await browser.close(); await server.close(); }
