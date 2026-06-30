// DocHelper 실동작 모니터링 — 프로덕션 대상.
// 로그인 → 데모회의 주입 → DocHelper 열기 → 대화 1회 + 수정요청 1회 관찰.
// 콘솔에러/네트워크응답/스크린샷을 남겨 "지금 어떻게 되는지" 확인.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { DEMO_MEETING } from './demo-meeting.mjs';

const BASE = process.env.MON_BASE || 'https://meeting-auto-docs.vercel.app';
const OUT = 'tmp/monitor';
const EMAIL = 'demo+landing@meetingautodocs.app';
const PASSWORD = 'demo-landing-2026';

const log = (...a) => console.log(...a);
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log('  📸', name);
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  log(`\n=== DocHelper 모니터링 시작: ${BASE} ===\n`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // 콘솔 에러 + edit-doc 응답 관찰
  page.on('console', (m) => {
    if (m.type() === 'error') log('  [page-err]', m.text().slice(0, 160));
  });
  page.on('response', async (r) => {
    if (r.url().includes('/api/edit-doc')) {
      log(`  [edit-doc] HTTP ${r.status()}`);
      try {
        const j = await r.json();
        log(`  [edit-doc] mode=${j.mode} reply="${(j.reply || '').slice(0, 80)}" hasContent=${!!j.content} mock=${!!j.mock}`);
      } catch { log('  [edit-doc] (본문 파싱 실패)'); }
    }
  });

  // 1) 진입 + 로그인
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.getByPlaceholder('이메일').count()) {
    log('① 로그인 시도');
    await page.getByPlaceholder('이메일').fill(EMAIL);
    await page.getByPlaceholder(/비밀번호/).fill(PASSWORD);
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForTimeout(3000);
    if (await page.getByPlaceholder('이메일').count()) {
      log('  로그인 실패 → 회원가입');
      const sg = page.getByText('계정이 없으신가요? 회원가입');
      if (await sg.count()) {
        await sg.click();
        await page.waitForTimeout(500);
        await page.getByPlaceholder('이메일').fill(EMAIL);
        await page.getByPlaceholder(/비밀번호/).fill(PASSWORD);
        const cb = page.locator('input[type="checkbox"]');
        if (await cb.count()) await cb.first().check();
        await page.getByRole('button', { name: '가입하기' }).click();
        await page.waitForTimeout(3500);
      }
    }
  }
  const loggedIn = !(await page.getByPlaceholder('이메일').count());
  log(`  로그인 상태: ${loggedIn ? '✅ 성공' : '❌ 실패(이후 진행 의미 없음)'}`);
  await shot(page, '01-after-login');

  // 2) 데모 회의 주입
  log('② 데모 회의 주입');
  await page.evaluate((meeting) => {
    const KEY = 'meeting-storage';
    let parsed = { state: {}, version: 0 };
    try { const raw = localStorage.getItem(KEY); if (raw) parsed = JSON.parse(raw); } catch {}
    parsed.state = parsed.state || {};
    parsed.state.meetings = [meeting];
    parsed.state.currentMeeting = meeting;
    parsed.state.activeJob = null;
    localStorage.setItem(KEY, JSON.stringify(parsed));
  }, DEMO_MEETING);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 문서 탭으로 이동(DocHelper는 문서 있을 때 노출)
  const docTab = page.locator('[aria-label="문서 탭"]').first();
  if (await docTab.count() && !(await docTab.isDisabled().catch(() => false))) {
    await docTab.click();
    await page.waitForTimeout(1500);
  }
  const viewBtn = page.getByText('문서 보기', { exact: false }).first();
  if (await viewBtn.count()) { await viewBtn.click(); await page.waitForTimeout(1500); }
  await shot(page, '02-documents');

  // 3) DocHelper 플로팅 버튼 찾기
  log('③ DocHelper 버튼 탐색');
  const fab = page.getByRole('button', { name: /DocHelper 열기/ });
  const fabCount = await fab.count();
  log(`  DocHelper 버튼: ${fabCount ? '✅ 발견' : '❌ 없음(문서 미인식?)'}`);
  if (!fabCount) {
    await shot(page, '03-no-dochelper');
    await browser.close();
    log('\n=== DocHelper 버튼이 없어 중단 ===');
    return;
  }
  await fab.first().click();
  await page.waitForTimeout(1000);
  await shot(page, '03-dochelper-open');

  const textarea = page.locator('textarea').last();

  // 4) 리서치+수정 테스트 (외부정보 필요 + 명확한 수정지시 → 되묻지 말고 검색해서 edit)
  log('④ 리서치+수정: "경쟁사 분석에 실제 경쟁사 이름을 리서치해서 넣어 수정해줘"');
  await textarea.fill('이 PRD에 경쟁사 분석 섹션을 추가하는데, 식단/칼로리 기록 앱의 실제 경쟁사 이름을 리서치해서 넣어 수정해줘');
  await textarea.press('Enter');
  // web_search(thinking 유지) + 문서 전체 생성 → 최대 ~3분. diff 뜰 때까지 폴링.
  let appeared = false;
  for (let i = 0; i < 36; i++) { // 36 * 5s = 180s
    await page.waitForTimeout(5000);
    if (await page.getByText('변경 미리보기', { exact: false }).count()) { appeared = true; break; }
    // 에러 메시지 떴는지도 체크
    if (await page.getByText('⚠️', { exact: false }).count()) break;
  }
  log(`  diff 등장: ${appeared ? '✅' : '⏳/❌ (시간초과 또는 에러)'}`);
  await shot(page, '04-research-edit');

  // diff 미리보기 떴는지 확인
  const hasDiff = await page.getByText('변경 미리보기', { exact: false }).count();
  log(`  변경 미리보기(diff): ${hasDiff ? '✅ 표시됨' : '❌ 안 뜸'}`);

  await browser.close();
  log('\n=== 모니터링 완료. 스크린샷: tmp/monitor/ ===');
};

run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
