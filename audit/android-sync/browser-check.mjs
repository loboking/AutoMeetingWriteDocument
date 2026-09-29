// Local Android Chrome emulation with a controlled Supabase response.
// No real accounts, production data, or paid AI calls are used.
import { chromium, devices } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const phase = process.argv[2] || 'after';
if (!['before', 'after', 'device'].includes(phase)) throw new Error('Use before, after or device');
const physical = phase === 'device';
const endpoint = process.env.ANDROID_CDP_URL;
if (physical && !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || '')) throw new Error('Set ANDROID_CDP_URL to the local adb forwarding port');
const browser = physical
  ? await chromium.connectOverCDP(endpoint)
  : await chromium.launch({ channel: 'chrome', headless: true });
const context = physical ? browser.contexts()[0] : await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', serviceWorkers: 'block' });
// Physical mode uses only the local test tab opened for this audit.
const page = physical
  ? context.pages().find(p => p.url().startsWith('http://localhost:12003/'))
  : await context.newPage();
if (!page) throw new Error('Open the local test URL in Android Chrome first');
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'sync-test@example.invalid' };
const expiry = Math.floor(Date.now() / 1000) + 7200;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expiry, role: user.role })}.test-signature`;
await page.addInitScript(({ user, token, expiry }) => {
  localStorage.setItem('sb-sync-test-auth-token', JSON.stringify({
    access_token: token, refresh_token: 'local-test-refresh', token_type: 'bearer',
    expires_in: 7200, expires_at: expiry, user,
  }));
}, { user, token, expiry });

const now = new Date().toISOString();
const note = {
  id: 'android-sync-note', title: '안드로이드 동기화 검증 회의록', createdAt: now, updatedAt: now,
  transcript: '원문 검증: 예약 취소는 사람이 승인한다.',
  summary: { overview: '빈 문서 대신 보여야 하는 원본 요약', keyPoints: ['취소 승인'], decisions: [], actionItems: [] },
};
const row = { id: 'row-note', client_id: note.id, title: note.title, data: note, created_at: now, updated_at: now };
let notes = [];
let meetings = [];
let failReads = false;
let noteReads = 0;
let meetingReads = 0;
let writes = 0;
await page.route('https://sync-test.supabase.co/**', async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path.startsWith('/rest/v1/')) {
    if (request.method() !== 'GET') {
      writes++;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    if (path.endsWith('/meeting_notes')) noteReads++;
    if (path.endsWith('/meetings')) meetingReads++;
    return route.fulfill({
      status: failReads ? 503 : 200, contentType: 'application/json',
      body: JSON.stringify(failReads ? { message: 'controlled sync failure' } : path.endsWith('/meeting_notes') ? notes : meetings),
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
});
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const results = [];
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('meeting-storage') || '{}').state || {});
const waitForSync = async () => {
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="서버에서 최신 데이터 동기화"]');
    return button && !button.disabled;
  }, undefined, { timeout: 30000 });
};
try {
  if (physical) await page.bringToFront();
  await page.goto('http://localhost:12003', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).waitFor({ timeout: 90000 });
  const deadline = Date.now() + 20000;
  while ((noteReads < 2 || meetingReads < 2) && Date.now() < deadline) await page.waitForTimeout(100);
  if (noteReads < 2 || meetingReads < 2) throw new Error(`Initial sync not ready: ${meetingReads}/${noteReads}`);
  notes = [row];
  const beforeReads = noteReads;
  await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).click();
  await waitForSync();
  const state = await saved();
  results.push({ name: '수동 동기화가 회의록 원문과 요약을 함께 가져온다', passed: noteReads > beforeReads && state.meetingNotes?.some(n => n.id === note.id && n.transcript === note.transcript && n.summary.overview === note.summary.overview) === true });
  results.push({ name: '받아온 회의록 제목이 Android 화면에 표시된다', passed: await page.getByText(note.title, { exact: true }).count() > 0 });

  failReads = true;
  await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).click();
  await waitForSync();
  results.push({ name: '조회 실패를 화면에 알린다', passed: await page.getByRole('alert').filter({ hasText: /동기화/ }).count() > 0 });
  results.push({ name: '조회 실패 후 받아온 원문을 보존한다', passed: (await saved()).meetingNotes?.some(n => n.id === note.id && n.transcript === note.transcript) === true });

  failReads = false;
  await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).click();
  await waitForSync();
  results.push({ name: '연결 복구 후 재시도하면 오류가 해제된다', passed: await page.getByRole('alert').filter({ hasText: /동기화/ }).count() === 0 && (await saved()).meetingNotes?.some(n => n.id === note.id) === true });

  if (phase !== 'before') {
    const fields = ['prd', 'featureList', 'userStory', 'screenList', 'ia', 'flowchart', 'wireframe', 'storyboard', 'database', 'apiSpec', 'testPlan', 'testCase', 'wbs', 'deployment'];
    const documents = Object.fromEntries(fields.map(field => [field, `# ${field}\n\n원본 문서 검증 ${field}: 예약 취소는 사람이 승인한다.`]));
    const meeting = { id: 'android-document-set', title: '동기화 기획서 14종 검증', createdAt: now, updatedAt: now, step: 'done', transcript: note.transcript, summary: note.summary, ...documents };
    meetings = [{ id: 'row-meeting', client_id: meeting.id, title: meeting.title, data: meeting, created_at: now, updated_at: now }];
    await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).click();
    await waitForSync();
    const syncedMeeting = (await saved()).meetings?.find(m => m.id === meeting.id);
    results.push({ name: '기획서 14종의 본문을 빠짐없이 동기화한다', passed: fields.every(field => syncedMeeting?.[field] === documents[field]) });
    await page.getByRole('button', { name: '내 문서 보기', exact: true }).click();
    await page.getByRole('button', { name: `${meeting.title} 회의 이어보기`, exact: true }).click();
    const bodyVisible = await page.getByText('원본 문서 검증 prd: 예약 취소는 사람이 승인한다.', { exact: true }).first().isVisible();
    results.push({ name: '회의록 탭에서 기획서를 열면 해당 문서 본문으로 이동한다', passed: bodyVisible });
    if (!physical && bodyVisible) {
      await mkdir('audit/android-sync/downloads', { recursive: true });
      for (const [format, label] of [['md', 'Markdown (.md)'], ['docx', 'Word (.docx)'], ['xlsx', 'Excel (.xlsx)'], ['pptx', 'PowerPoint (.pptx)']]) {
        await page.getByTitle('이 문서만 또는 전체를 내보내기', { exact: true }).click();
        const pendingDownload = page.waitForEvent('download', { timeout: 20000 });
        await page.getByRole('menuitem', { name: label, exact: true }).click();
        const download = await pendingDownload;
        const path = `audit/android-sync/downloads/document.${format}`;
        await download.saveAs(path);
        const bytes = await readFile(path);
        let text;
        if (format === 'md') text = bytes.toString('utf8');
        else if (format === 'xlsx') {
          const workbook = XLSX.read(bytes, { type: 'buffer' });
          text = workbook.SheetNames.map(name => XLSX.utils.sheet_to_csv(workbook.Sheets[name])).join('\n');
        } else {
          const zip = await JSZip.loadAsync(bytes);
          const files = Object.keys(zip.files).filter(name => format === 'docx' ? name === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(name));
          text = (await Promise.all(files.map(name => zip.file(name).async('string')))).join('\n');
        }
        results.push({ name: `${format.toUpperCase()} 실제 다운로드 파일이 비어 있지 않고 본문을 포함한다`, passed: bytes.length > 0 && text.includes('예약 취소는 사람이 승인한다.'), bytes: bytes.length });
      }
    }
  }

  if (phase !== 'before') {
    // A clean device must show initial read errors without migrating an empty snapshot.
    await page.evaluate(() => localStorage.removeItem('meeting-storage'));
    const writesBeforeFailure = writes;
    failReads = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).waitFor();
    await waitForSync();
    results.push({ name: '새 기기의 최초 조회 실패를 알리고 빈 내용을 업로드하지 않는다', passed: await page.getByRole('alert').filter({ hasText: /동기화/ }).count() > 0 && writes === writesBeforeFailure });
    failReads = false;
    await page.getByRole('button', { name: '서버에서 최신 데이터 동기화', exact: true }).click();
    await waitForSync();
    results.push({ name: '최초 조회가 실패해도 수동 재시도로 원문·요약을 복구한다', passed: (await saved()).meetingNotes?.some(n => n.id === note.id && n.transcript === note.transcript && n.summary.overview === note.summary.overview) === true });
  }
  await page.screenshot({ path: `audit/android-sync/browser-${phase}.png`, fullPage: true });
  const report = { phase, date: new Date().toISOString(), environment: physical ? 'Physical Android Chrome / USB adb forwarding / local app / mocked Supabase' : 'Pixel 7 emulation / local Chrome / mocked Supabase; not a physical Android device', userAgent: await page.evaluate(() => navigator.userAgent), results, noteReads, meetingReads, writes, pageErrors };
  await writeFile(`audit/android-sync/browser-${phase}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (results.some(r => !r.passed) || pageErrors.length) process.exitCode = 1;
} catch (error) {
  await writeFile(`audit/android-sync/browser-${phase}-failed.json`, JSON.stringify({
    phase, date: new Date().toISOString(), status: 'incomplete',
    error: error instanceof Error ? error.message : String(error),
    results, noteReads, meetingReads, writes, pageErrors,
  }, null, 2) + '\n');
  throw error;
} finally {
  if (physical) {
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key === 'meeting-storage' || key === 'sb-sync-test-auth-token' || key.startsWith('mad:')) localStorage.removeItem(key);
      }
    }).catch(() => {});
    await page.close();
  } else await context.close();
  await browser.close();
}
