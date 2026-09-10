// gpt-5-nano 실측: 키 유효성 · 어댑터 파라미터 호환 · 속도 · usage · 한국어 출력
import fs from 'node:fs';
import OpenAI from 'openai';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^"|"$/g,'')]}));
const key = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
console.log('key present:', !!key, 'masked:', key?.includes('SENSITIVE'));
const client = new OpenAI({ apiKey: key, timeout: 300000, maxRetries: 0 });
const system = '당신은 한국어로만 답하는 문서 작성 전문가입니다. 모든 출력은 한국어로 작성하세요.';
const summary = `회의 제목: 회의록 자동 문서화 SaaS 2차 기획
개요: 회의 녹음을 올리면 STT→요약→PRD·WBS·테스트계획 등 14종 문서를 자동 생성하는 SaaS. 현재 LLM을 GLM에서 교체 검토 중.
핵심 논의: 1) 생성 속도가 40분이라 사용자 이탈 발생, 목표 5분 이내. 2) 요금제 Free 3건/Pro 9,900원 10건/Team 49,900원 55건. 3) 기업 고객은 데이터 국외이전·학습 미사용 보장을 요구. 4) 출력 상한 8192에서 문서가 잘리는 사례 5종 확인. 5) 토큰 실측 기록이 7월 15일 이후 끊겨 있었음(컬럼 누락) → 복구 완료.
결정 사항: LLM 후보를 GPT-5 nano·Cerebras·Upstage로 압축하고 같은 회의로 실측 비교. 잘린 문서 상한 해제. privacy 페이지 문구 교체 예정.
액션 아이템: 도현-실측 스크립트(이번 주), 한나-원가율 재계산(실측 후), 서연-요금제 크레딧 재설계, 나루-provider 전환 시 어댑터 호환 점검.`;
const prompt = `다음 회의 요약을 바탕으로 "기능 목록(feature-list)" 문서를 마크다운으로 작성하세요.
요구사항: 기능을 대분류(5개 이상)→세부 기능(각 3개 이상)으로 계층화하고, 각 세부 기능에 우선순위(P0/P1/P2)·근거(회의 발언 인용)·수용 기준을 표로 정리하세요. 마지막에 미결 사항 섹션을 두세요.

[회의 요약]
${summary}`;
async function run(label, params) {
  const t0 = Date.now();
  try {
    const r = await client.chat.completions.create({ model: 'gpt-5-nano', messages: [{role:'system',content:system},{role:'user',content:prompt}], ...params });
    const ms = Date.now() - t0; const u = r.usage; const text = r.choices[0]?.message?.content || '';
    console.log(`\n[${label}] OK ${ms}ms  in=${u.prompt_tokens} out=${u.completion_tokens} (reasoning=${u.completion_tokens_details?.reasoning_tokens ?? '-'}) tok/s=${(u.completion_tokens/(ms/1000)).toFixed(0)} finish=${r.choices[0]?.finish_reason}`);
    console.log(`cost=$${((u.prompt_tokens*0.05+u.completion_tokens*0.40)/1e6).toFixed(4)}  chars=${text.length}`);
    console.log('--- head ---\n' + text.slice(0, 700) + '\n--- tail ---\n' + text.slice(-300));
  } catch (e) { console.log(`\n[${label}] FAIL ${Date.now()-t0}ms:`, e.status, (e.message||'').slice(0,300)); }
}
// 1) 현재 어댑터와 동일 파라미터 (max_tokens)
await run('adapter-identical max_tokens', { max_tokens: 8192 });
// 2) GPT-5 계열 권장 파라미터
await run('max_completion_tokens+reasoning_effort=low', { max_completion_tokens: 8192, reasoning_effort: 'low' });
