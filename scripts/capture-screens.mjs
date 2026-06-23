// 랜딩페이지용 실제 앱 스크린샷 캡처
// 회원가입 자동 진행 후 주요 화면 캡처. 결과: public/landing/*.png
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { DEMO_MEETING } from './demo-meeting.mjs';

const BASE = 'http://localhost:12001';
const OUT = 'public/landing';
// 고정 계정(데모용). 이미 가입돼 있으면 로그인으로 폴백.
const EMAIL = `demo+landing@meetingautodocs.app`;
const PASSWORD = 'demo-landing-2026';

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('captured:', name);
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // 레티나 선명도
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('  [page-err]', m.text().slice(0, 120)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 로그인 폼 감지
  const hasAuth = await page.getByPlaceholder('이메일').count();
  if (hasAuth) {
    console.log('auth form detected — 로그인 시도');
    await page.getByPlaceholder('이메일').fill(EMAIL);
    await page.getByPlaceholder(/비밀번호/).fill(PASSWORD);
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForTimeout(2500);

    // 여전히 폼이면 회원가입으로 전환
    if (await page.getByPlaceholder('이메일').count()) {
      console.log('로그인 실패 → 회원가입 전환');
      await page.getByText('계정이 없으신가요? 회원가입').click();
      await page.waitForTimeout(500);
      await page.getByPlaceholder('이메일').fill(EMAIL);
      await page.getByPlaceholder(/비밀번호/).fill(PASSWORD);
      // 약관 동의 체크박스
      const cb = page.locator('input[type="checkbox"]');
      if (await cb.count()) await cb.first().check();
      await page.getByRole('button', { name: '가입하기' }).click();
      await page.waitForTimeout(3000);
      // 회원가입 결과 안내문/에러 출력
      const bodyText = await page.locator('body').innerText();
      console.log('signup-result:', bodyText.replace(/\s+/g, ' ').slice(0, 300));
    }
  }

  // 로그인 성공 후 메인 화면
  await page.waitForTimeout(1500);
  await shot(page, '01-main');

  // ── 데모 회의 주입: 완성된 회의를 store(persist)에 넣고 새로고침 ──
  console.log('데모 회의 주입');
  await page.evaluate((meeting) => {
    const KEY = 'meeting-storage';
    let parsed = { state: {}, version: 0 };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch { /* 초기화 */ }
    parsed.state = parsed.state || {};
    parsed.state.meetings = [meeting];
    parsed.state.currentMeeting = meeting;
    parsed.state.activeJob = null;
    localStorage.setItem(KEY, JSON.stringify(parsed));
  }, DEMO_MEETING);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // 내부 탭 이동 (aria-label: "요약 탭", "문서 탭")
  const goTab = async (ariaLabel) => {
    const tab = page.locator(`[aria-label="${ariaLabel}"]`).first();
    if (!(await tab.count())) return false;
    if (await tab.isDisabled().catch(() => false)) {
      console.log(`  탭 비활성: ${ariaLabel}`);
      return false;
    }
    await tab.click();
    await page.waitForTimeout(1500);
    return true;
  };

  await shot(page, '03-summary-default');
  if (await goTab('요약 탭')) await shot(page, '03-summary');
  if (await goTab('문서 탭')) {
    await page.waitForTimeout(2000);
    await shot(page, '04-documents');

    // 실제 PRD 본문 펼치기: "문서 보기" 버튼 클릭
    const viewBtn = page.getByText('문서 보기', { exact: false }).first();
    if (await viewBtn.count()) {
      await viewBtn.click();
      await page.waitForTimeout(2000);
      await shot(page, '05-doc-content');
    }
  }

  // 전체 페이지(스크롤 포함) 한 장 — 문서 화면 기준
  await page.screenshot({ path: `${OUT}/04-documents-full.png`, fullPage: true });
  console.log('captured: 04-documents-full');

  // 모바일 뷰
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mpage = await mob.newPage();
  await mpage.goto(BASE, { waitUntil: 'networkidle' });
  await mpage.waitForTimeout(1500);
  // 모바일도 동일 세션 아님 → 로그인 한번 더 시도
  if (await mpage.getByPlaceholder('이메일').count()) {
    await mpage.getByPlaceholder('이메일').fill(EMAIL);
    await mpage.getByPlaceholder(/비밀번호/).fill(PASSWORD);
    await mpage.getByRole('button', { name: '로그인' }).click();
    await mpage.waitForTimeout(2500);
  }
  await mpage.screenshot({ path: `${OUT}/02-mobile.png` });
  console.log('captured: 02-mobile');

  await browser.close();
  console.log('DONE');
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
