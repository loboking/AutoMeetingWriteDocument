// Exercise the real summary -> PRD client flow against controlled API responses.
// No production account or paid model calls.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

const phase = process.argv[2] || 'after';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const sections = ['doc-info', 'overview', 'problem', 'goals', 'target-users', 'functional-req', 'non-functional-req', 'ui-ux', 'technical-req', 'release-plan', 'cost-resources', 'saas-ops', 'risks', 'success-criteria', 'appendix'];
try {
  const page = await browser.newPage();
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'prd-test@example.invalid' };
  const expiry = Math.floor(Date.now() / 1000) + 7200;
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: expiry, role: user.role })}.test-signature`;
  await page.addInitScript(({ user, token, expiry }) => {
    localStorage.setItem('sb-sync-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'local-only', token_type: 'bearer', expires_in: 7200, expires_at: expiry, user }));
  }, { user, token, expiry });
  await page.route('https://sync-test.supabase.co/**', route => {
    const request = route.request();
    const rest = new URL(request.url()).pathname.startsWith('/rest/v1/');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rest ? (request.method() === 'GET' ? [] : {}) : user) });
  });
  await page.route('**/api/summarize', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: { overview: '예약 홀딩 중 결제를 미리 잡지 않는다.', decisions: ['예약 홀딩 중 결제 금지'], keyPoints: ['야간 요청은 익일 확인'], actionItems: [] } }) }));
  const calls = [];
  await page.route('**/api/generate-doc', route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const response = body.prdPhase === 'prepare' ? { metadata: {} }
      : { sectionId: body.prdSection, content: `## ${body.prdSection || 'legacy'}\n\n검증 본문: 예약 홀딩 중 결제 금지.` };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:12003');
  await page.getByRole('tab', { name: '기획서', exact: true }).click();
  await page.getByRole('textbox', { name: '회의 제목', exact: true }).fill('첫 PRD 생성 회귀 검증');
  await page.getByRole('tab', { name: '텍스트 입력', exact: true }).click();
  await page.getByRole('textbox', { name: '회의 내용 텍스트 입력', exact: true }).fill('야간 예약 요청은 다음 날 오전 확정 예정으로 표시합니다. 홀딩 상태에서는 결제를 미리 잡지 않습니다.');
  await page.getByRole('button', { name: '다음 단계로', exact: true }).click();
  await page.getByRole('button', { name: 'AI 요약 생성', exact: true }).click();
  await page.getByRole('button', { name: 'PRD 생성하기', exact: true }).click();
  // A successful first PRD must persist the response body. The old handler reads
  // { prd } from a { content } response and leaves the document blank.
  await page.waitForFunction(() => {
    const s = JSON.parse(localStorage.getItem('meeting-storage') || '{}').state;
    return !!s?.currentMeeting?.prd && s?.activeJob?.status !== 'running';
  }, undefined, { timeout: 5000 }).catch(() => {});
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('meeting-storage') || '{}').state);
  const meeting = state.currentMeeting;
  results.push({ name: '요약 화면에서 첫 PRD 본문을 저장한다', passed: !!meeting.prd?.includes('예약 홀딩 중 결제 금지') });
  results.push({ name: '300초 단일 PRD 요청을 보내지 않는다', passed: calls.length > 1 && calls.filter(c => c.docType === 'prd').every(c => c.prdPhase || c.prdSection) });
  results.push({ name: '15개 섹션을 모두 조립한다', passed: sections.every(id => calls.some(c => c.prdSection === id) && meeting.prd?.includes(`## ${id}`)) });
  results.push({ name: 'PRD 버튼은 다른 13종 생성을 시작하지 않는다', passed: calls.every(c => c.docType === 'prd') && !meeting.featureList && !meeting.testCase });
  results.push({ name: '모든 요청이 같은 회의 ID를 사용한다', passed: calls.every(c => c.meetingId === meeting.id && c.projectId === meeting.id) });
  results.push({ name: '생성 잡이 완료되어 중복 실행을 남기지 않는다', passed: !state.activeJob || state.activeJob.status !== 'running' });
  if (phase === 'after' && results.every(r => r.passed)) {
    const firstPrd = meeting.prd;
    const callsBeforeFull = calls.length;
    await page.getByRole('button', { name: '전체 생성', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: '생성', exact: true }).click();
    const fields = ['prd', 'userStory', 'featureList', 'screenList', 'ia', 'flowchart', 'storyboard', 'wireframe', 'database', 'apiSpec', 'testPlan', 'testCase', 'wbs', 'deployment'];
    await page.waitForFunction(fields => {
      const s = JSON.parse(localStorage.getItem('meeting-storage') || '{}').state;
      return s?.activeJob?.status !== 'running' && fields.every(f => !!s.currentMeeting?.[f]);
    }, fields, { timeout: 10000 });
    const full = await page.evaluate(() => JSON.parse(localStorage.getItem('meeting-storage')).state.currentMeeting);
    results.push({ name: '이후 전체 생성으로 14종을 모두 완성한다', passed: fields.every(f => !!full[f]) });
    results.push({ name: '완료된 PRD는 다시 호출하지 않는다', passed: calls.slice(callsBeforeFull).length === 13 && calls.slice(callsBeforeFull).every(c => c.docType !== 'prd') });
    results.push({ name: '전체 생성 후 첫 PRD 본문이 보존된다', passed: full.prd === firstPrd });
  }
  await page.screenshot({ path: `audit/android-sync/summary-prd-${phase}.png`, fullPage: true });
  await writeFile(`audit/android-sync/summary-prd-${phase}.json`, JSON.stringify({ phase, controlledApi: true, paidAi: false, calls: calls.map(c => ({ docType: c.docType, section: c.prdSection, phase: c.prdPhase })), results }, null, 2));
  console.log(JSON.stringify({ phase, passed: results.filter(r => r.passed).length, total: results.length, results }));
  assert(results.every(r => r.passed), 'Summary PRD regression checks failed');
} finally {
  await browser.close();
}
