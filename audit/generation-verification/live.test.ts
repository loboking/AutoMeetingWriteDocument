import { it, vi, expect } from 'vitest';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
vi.mock('@/lib/apiAuth', () => ({ requireUser: vi.fn(async () => ({ user: { id: 'local-audit' } })) }));
const usage: unknown[] = [];
vi.mock('@/lib/tokenUsage', () => ({ recordTokenUsage: vi.fn(async (r) => { usage.push({ model: r.model, provider: r.provider, usage: r.usage, docType: r.docType }); }) }));
vi.mock('@/lib/usageMetering', () => ({ ENFORCE_LIMIT: false, getCurrentPeriod: () => '2026-10', recordUsage: vi.fn(), isProjectCounted: vi.fn(async () => true), countThisPeriod: vi.fn(async () => 0), getMonthlyLimit: vi.fn(async () => 999) }));
import { POST } from '@/app/api/generate-doc/route';
import { resolveProvider } from '@/lib/llm';
const transcript = '김PM: 회의록 문서 관리 MVP를 4주 동안 만듭니다. 로그인, 회의록 입력, 문서 생성, Word와 PDF 다운로드를 포함합니다. 이개발: 화면을 나가면 멈출 수 있으므로 완료된 섹션을 기기에 저장하고 돌아오면 이어서 생성합니다. 박디자인: 내용은 바꾸지 않고 표지와 목차, 표 스타일만 통일합니다. 김PM: 공유 링크와 결제는 이번 범위에서 제외합니다. 성공 기준은 저장된 섹션 재사용, 취소 후 이전 응답 무시, 다운로드의 표와 다이어그램 누락 없음입니다. 담당자는 김PM과 이개발이고 예산과 사용자 수 목표는 미정입니다.';
it('현재 GPT를 실제 문서 생성 경로로 검증', async () => {
 const p=resolveProvider(); expect(p.id).toBe('openai'); expect(p.model).toBe('gpt-6-luna');
 const results: unknown[]=[];
 for(const docType of ['prd','flowchart','test-plan']) {
   const start=Date.now();
   const response=await POST(new NextRequest('http://localhost/api/generate-doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({docType, ...(docType==='prd'?{prdSection:'overview'}:{}),transcript,summary:{overview:transcript,keyPoints:['4주 MVP','기기에서 중간 저장','Word/PDF 서식 통일'],decisions:['공유 링크와 결제 제외'],actionItems:[]},meetingInfo:{title:'문서 내보내기 MVP 검증용 가상 회의',date:'2026-10-06'},review:true})}));
   const body=await response.json();
   results.push({docType,status:response.status,seconds:(Date.now()-start)/1000,chars:body.content?.length??0,partial:body.partial??null,error:body.error??null});
   if(body.content)fs.writeFileSync(`audit/generation-verification/live-${docType}.md`,body.content);
   fs.writeFileSync('audit/generation-verification/live-result.json',JSON.stringify({provider:p.id,requestedModel:p.model,results,usage},null,2));
   expect(response.status).toBe(200); expect(body.content?.length).toBeGreaterThan(300); expect(body.partial).toBeUndefined();
 }
},600_000);
