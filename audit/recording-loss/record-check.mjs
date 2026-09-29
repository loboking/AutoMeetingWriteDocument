// 녹음 유실 수정 검증 — 가짜 마이크로 실제 MediaRecorder/IndexedDB 경로를 돌린다. 유료 AI·실계정 없음.
import { chromium, devices } from 'playwright';

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', serviceWorkers: 'block', permissions: ['microphone'], acceptDownloads: true });
const page = await context.newPage();
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'rec-test@example.invalid' };
const expiry = Math.floor(Date.now() / 1000) + 7200;
const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expiry, role: user.role })}.test-signature`;
await page.addInitScript(({ user, token, expiry }) => {
  localStorage.setItem('sb-sync-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 7200, expires_at: expiry, user }));
}, { user, token, expiry });
await page.route('https://sync-test.supabase.co/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: route.request().url().includes('/rest/') ? '[]' : JSON.stringify(user) }));
// 업로드/전사 경로는 전부 503 → 전사 실패 배너(이어서 녹음 버튼)를 재현. 오디오는 보존돼야 한다.
await page.route('**/api/storage/sign', route => route.fulfill({ status: 503, body: '{"error":"controlled"}' }));
await page.route('**/api/transcribe', route => route.fulfill({ status: 503, body: '{"error":"controlled"}' }));
const errors = []; page.on('pageerror', e => errors.push(e.message));
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const idb = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('recording-backup');
  req.onsuccess = () => {
    const db = req.result; const tx = db.transaction(['chunks', 'sessions'], 'readonly');
    const store = tx.objectStore('chunks'); const hasIndex = store.indexNames.contains('sessionId');
    const chunks = store.getAll(); const sessions = tx.objectStore('sessions').getAll();
    tx.oncomplete = () => resolve({ version: db.version, hasIndex,
      sessions: sessions.result.length, chunks: chunks.result.length, parts: [...new Set(chunks.result.map(c => c.part))].sort() });
  };
  req.onerror = () => resolve(null);
}));
const timer = async () => { const t = await page.locator('[aria-label^="녹음 시간"]').first().getAttribute('aria-label'); return t; };

try {
  await page.goto('http://localhost:12003', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: /새 회의록/ }).click({ timeout: 90000 });
  await page.getByRole('button', { name: '녹음 시작', exact: true }).click({ timeout: 30000 });
  await page.waitForTimeout(3500);
  const t1 = await timer();
  check('녹음 시작 후 타이머 진행', /0[2-4]$/.test(t1 || ''), t1);

  // ① 녹음 중 다른 탭 전환 → 마이크가 끊기지 않아야 함
  await page.getByRole('tab', { name: '파일 업로드 탭' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('tab', { name: '음성 녹음 탭' }).click();
  await page.waitForTimeout(500);
  const stillRecording = await page.getByRole('button', { name: '녹음 정지' }).isVisible();
  const t2 = await timer();
  check('탭 전환 후에도 녹음 계속(정지 버튼 존재·타이머 증가)', stillRecording && t2 !== t1, `${t1} → ${t2}`);

  // ② 정지 → 자동 전사(503) 실패 → 오디오 보존 + 이어서 녹음 버튼
  await page.getByRole('button', { name: '녹음 정지' }).click();
  await page.getByRole('button', { name: '이어서 녹음' }).waitFor({ timeout: 60000 });
  const s1 = await idb();
  check('IndexedDB v2 + sessionId 인덱스', s1?.version === 2 && s1?.hasIndex, JSON.stringify(s1));
  check('전사 실패 후 백업 보존(파트 0)', s1?.sessions === 1 && s1?.chunks >= 4 && s1?.parts.join() === '0', JSON.stringify(s1));
  const saveBtn = page.locator('button[title="녹음 파일 저장"]').first();
  check('녹음 파일 저장 버튼 노출', await saveBtn.isVisible());
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), saveBtn.click()]);
  check('녹음 파일 다운로드 동작', /^recording-\d+\.(webm|m4a)$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // ③ 이어서 녹음 → 새 파트로 쌓여야 함(기존 청크 덮어쓰기 없음)
  await page.getByRole('button', { name: '이어서 녹음' }).click();
  await page.waitForTimeout(3000);
  const s2mid = await idb();
  await page.getByRole('button', { name: '녹음 정지' }).click();
  await page.getByRole('button', { name: '이어서 녹음' }).waitFor({ timeout: 60000 });
  const s2 = await idb();
  check('이어서 녹음이 파트 1로 저장되고 파트 0 청크 보존', s2?.parts.join() === '0,1' && s2.chunks > s1.chunks + 1, `${JSON.stringify(s1)} → ${JSON.stringify(s2)} (중간 ${s2mid?.chunks})`);

  // ④ 새로고침 후 복구 배너 → 복구 → 파트 2개 유지 확인은 IDB 상태로 대신(복구 후 이어서 녹음 시 파트 2)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /새 회의록/ }).click({ timeout: 60000 });
  await page.getByRole('button', { name: '복구', exact: true }).click({ timeout: 60000 });
  await page.getByRole('button', { name: '이어서 녹음' }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '이어서 녹음' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: '녹음 정지' }).click();
  await page.waitForTimeout(1500);
  const s3 = await idb();
  check('복구 후 이어서 녹음 → 파트 2 추가, 기존 파트 보존', s3?.parts.join() === '0,1,2' && s3.chunks > s2.chunks, JSON.stringify(s3));
  check('페이지 오류 0', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('시나리오 완주', false, e.message.slice(0, 300));
  await page.screenshot({ path: new URL('./record-fail.png', import.meta.url).pathname, fullPage: true }).catch(() => {});
} finally {
  console.log(JSON.stringify({ pass: results.filter(r => r.ok).length, total: results.length }));
  await browser.close();
}
