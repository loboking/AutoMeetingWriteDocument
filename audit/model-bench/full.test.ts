// 회의 1건 → 요약 → 14종 문서 전체를 실제 모델로 생성해 비용·시간·잘림을 실측한다.
// 실행: FULL_OUT=audit/model-bench/full-<label> LLM_PROVIDER=openai OPENAI_MODEL=gpt-6-luna npx vitest run --config audit/model-bench/vitest.bench.config.ts
import fs from 'node:fs';
import path from 'node:path';
import { it, vi, expect } from 'vitest';
import { NextRequest } from 'next/server';

const OUT = path.resolve(process.env.FULL_OUT!);
const usageLog: { docType: string; model: string; inputTokens: number; outputTokens: number }[] = [];
vi.mock('@/lib/apiAuth', () => ({ requireUser: vi.fn(async () => ({ user: { id: 'user-bench' } })) }));
vi.mock('@/lib/tokenUsage', () => ({
  recordTokenUsage: vi.fn(async (r: { docType?: string; op?: string; model: string; usage?: { inputTokens: number; outputTokens: number } }) => {
    usageLog.push({ docType: r.docType || r.op || '?', model: r.model, inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 });
  }),
}));
vi.mock('@/lib/usageMetering', () => ({
  ENFORCE_LIMIT: false, getCurrentPeriod: () => '2026-10', recordUsage: vi.fn(async () => {}),
  isProjectCounted: vi.fn(async () => true), countThisPeriod: vi.fn(async () => 0), getMonthlyLimit: vi.fn(async () => 999),
}));

import { POST as generateDoc } from '@/app/api/generate-doc/route';
import { POST as summarize } from '@/app/api/summarize/route';
import { llmComplete } from '@/lib/llm';
import { DEPENDENCIES, topoSortLevels, type DocType } from '@/lib/documentUtils';

const req = (p: string, body: unknown) =>
  new NextRequest('http://localhost' + p, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

// 1시간 분량 가상 회의록. 한 번 만들면 audit/model-bench/transcript.txt에 캐시 → 모델 간 동일 입력 보장.
async function makeTranscript(): Promise<string> {
  const cached = path.resolve('audit/model-bench/transcript.txt');
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
  const halves: string[] = [];
  for (const part of ['전반부(0~30분)', '후반부(30~60분)']) {
    const r = await llmComplete({
      prompt: `신규 모바일 식단 기록 앱 킥오프 회의의 ${part} 녹취록을 작성하세요. 참석자 4명(김PM, 이대표, 박디자이너, 최개발). 실제 STT 결과처럼 "이름: 발화" 형식, 구어체, 서로 끼어들고 되묻고 숫자·일정·우려를 구체적으로 말합니다. MVP 범위·화면·DB·외부 API·일정 8주·요금·개인정보·리포트 푸시·테스트 계획을 폭넓게 논의합니다. 길이는 한국어 12,000자 이상. 제목·요약·설명 없이 발화만 출력.`,
      maxTokens: 16384, temperature: 0.8, timeoutMs: 600_000,
    });
    usageLog.push({ docType: '_transcript', model: r.model, inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 });
    halves.push(r.text.trim());
  }
  const t = halves.join('\n');
  fs.writeFileSync(cached, t);
  return t;
}

it('full', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const transcript = await makeTranscript();
  const timing: Record<string, number> = {};
  const docs: Record<string, string> = {};
  const status: Record<string, string> = {};

  const ts = Date.now();
  const sres = await summarize(req('/api/summarize', { text: transcript }));
  const sjson = await sres.json();
  timing.summarize = (Date.now() - ts) / 1000;
  if (!sjson.summary) throw new Error('요약 실패: ' + JSON.stringify(sjson).slice(0, 300));
  const summary = sjson.summary;
  fs.writeFileSync(OUT + '/summary.json', JSON.stringify(summary, null, 2));
  const meetingInfo = { title: '신규 모바일 식단 기록 앱 킥오프', date: '2026-10-01' };

  // 앱과 동일: 의존 레벨 순, 레벨 안에서 동시 2개.
  for (const level of topoSortLevels()) {
    for (let i = 0; i < level.length; i += 2) {
      await Promise.all(level.slice(i, i + 2).map(async (docType: DocType) => {
        const contextDocs: Record<string, string> = {};
        for (const dep of DEPENDENCIES[docType] || []) if (docs[dep]) contextDocs[dep] = docs[dep];
        const td = Date.now();
        try {
          const res = await generateDoc(req('/api/generate-doc', { docType, summary, transcript, meetingInfo, contextDocs, review: false, meetingId: 'bench' }));
          const j = await res.json();
          timing[docType] = (Date.now() - td) / 1000;
          if (res.status !== 200 || !j.content) { status[docType] = `HTTP ${res.status} ${JSON.stringify(j).slice(0, 120)}`; return; }
          docs[docType] = j.content; status[docType] = j.partial ? `partial(${j.partial.missing})` : 'ok';
          fs.writeFileSync(`${OUT}/${docType}.md`, j.content);
        } catch (e) { timing[docType] = (Date.now() - td) / 1000; status[docType] = 'throw ' + (e as Error).message.slice(0, 120); }
        fs.writeFileSync(OUT + '/result.json', JSON.stringify({ totalSec: (Date.now() - t0) / 1000, transcriptChars: transcript.length, timing, status, usageLog, chars: Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.length])) }, null, 2));
      }));
    }
  }
  // HTTP 응답이 왔다는 이유만으로 전체 검증을 성공 처리하지 않는다.
  expect(Object.keys(status)).toHaveLength(14);
  expect(Object.entries(status).filter(([, value]) => value !== 'ok'), '실패 또는 부분 생성 문서').toEqual([]);
}, 3_600_000);
