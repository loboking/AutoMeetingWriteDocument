// 완성된 /about 랜딩페이지 전체를 캡처해 눈으로 검증
import { chromium } from 'playwright';

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && console.log('[err]', m.text().slice(0, 150)));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 150)));

  const res = await page.goto('http://localhost:12001/about', { waitUntil: 'networkidle' });
  console.log('status:', res.status());
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'public/landing/_preview-top.png' });
  await page.screenshot({ path: 'public/landing/_preview-full.png', fullPage: true });
  console.log('captured preview');
  await browser.close();
};
run().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
