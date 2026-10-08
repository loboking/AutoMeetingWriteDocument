import {createServer} from 'vite';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
const root=path.resolve(process.env.EXPORT_REVIEW_DIR || 'audit/download-review/files');
await mkdir(root,{recursive:true});
await writeFile('audit/download-review/folder.txt',root);
await writeFile(path.join(root,'00_먼저읽어주세요.txt'),`다운로드 파일 검토\n\n현재 코드의 실제 내보내기 함수로 생성했습니다. 추가 AI 호출은 없습니다.\n\n01_식단앱: 기존 GPT 실측 문서 13종. PRD는 9개 섹션이 실패한 미완성 원문입니다. 이 회의의 테스트계획서는 생성 실패로 존재하지 않습니다.\n02_문서관리MVP: 최근 GPT 실측 3종. PRD는 개요 섹션만 있으며, 플로우차트와 테스트계획서는 전체 문서입니다. 01과 다른 회의입니다.\n\n각 문서 폴더에서 같은 내용의 Word, PDF, PPT, Excel, Markdown, TXT를 비교할 수 있습니다.\n파일 무결성 검사 결과는 검증결과.json에 기록합니다. 생성·구조 검사와 Office 앱에서의 모든 페이지 시각 검수는 별개입니다.\n`);
if (process.platform === 'darwin' && process.env.OPEN_REVIEW_FOLDER === 'true') spawnSync('open',[root]);
const names={'prd':'PRD','user-story':'시나리오정의서','feature-list':'기능목록','screen-list':'화면목록','ia':'정보구조도','database':'DB설계','api-spec':'API명세','test-plan':'테스트계획','flowchart':'플로우차트','storyboard':'스토리보드','wireframe':'와이어프레임','wbs':'WBS','test-case':'테스트케이스','deployment':'배포가이드'};
const items=[];
for(const [key,title] of Object.entries(names)) {
 try {const content=await readFile(`audit/model-bench/full-luna/${key}.md`,'utf8');items.push({key,title:title+(key==='prd'?'_미완성9섹션':''),projectTitle:'식단 기록 앱',group:'01_식단앱_기존GPT실측',content});}catch(e){if(e.code!=='ENOENT')throw e;}
}
for(const key of ['prd','flowchart','test-plan'])items.push({key,title:names[key]+(key==='prd'?'_개요섹션만':''),projectTitle:'문서관리 MVP',group:'02_문서관리MVP_최신GPT실측',content:await readFile(`audit/generation-verification/live-${key}.md`,'utf8')});
items.sort((a,b)=>(a.key==='user-story'?-1:0)-(b.key==='user-story'?-1:0));
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:12348},resolve:{alias:{'@':`${process.cwd()}/src`}}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
const report=process.env.RETRY_EXPORTS ? JSON.parse(await readFile(path.join(root,'검증결과.json'),'utf8')) : [];
try {
 for(const [index,item] of items.entries()) {
  if(process.env.RETRY_EXPORTS && ['docx','pdf','pptx','xlsx'].every(format=>report.some(r=>r.group===item.group&&r.document===item.title&&r.format===format&&r.ok)))continue;
  const folder=path.join(root,item.group,item.title);await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,`${item.title}.md`),item.content);
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:12348/audit/download-review/preview.html');await page.waitForFunction(()=>window.ready);
  const plain=await page.evaluate(content=>window.makeExport({content,format:'txt'}),item.content);
  await writeFile(path.join(folder,`${item.title}.txt`),plain.text);
  for(const format of ['docx','pdf','pptx','xlsx']) {
   if(process.env.RETRY_EXPORTS && report.some(r=>r.group===item.group&&r.document===item.title&&r.format===format&&r.ok))continue;
   const row={group:item.group,document:item.title,format};
   try {
    const result=await page.evaluate(input=>window.makeExport(input),{...item,format});const bytes=Buffer.from(result.bytes);
    const file=path.join(folder,`${item.title}.${format}`);await writeFile(file,bytes);
    Object.assign(row,{bytes:bytes.length,sourceDiagrams:result.diagrams});
    if(format==='pdf') {
     const info=spawnSync('pdfinfo',[file],{encoding:'utf8'});
     if(info.status!==0)throw new Error('PDF 읽기 실패');row.pages=Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
     if(bytes.length<10000)throw new Error('PDF 본문 비어있음 의심');
    } else {
     const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
     if(format==='docx'||format==='pptx') {
      row.images=Object.keys(zip.files).filter(name=>/media\/.*\.png$/.test(name)).length;
      if(row.images<result.diagrams)throw new Error('다이어그램 이미지 누락');
      if(format==='pptx')row.slides=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
      else row.tables=((await zip.file('word/document.xml').async('string')).match(/<w:tbl>/g)||[]).length;
     }else {const book=XLSX.read(bytes,{type:'buffer'});row.sheets=book.SheetNames;row.rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1}).length;}
    }
    row.ok=true;
   }catch(e){row.ok=false;row.error=e.message;}
   const previous=report.findIndex(r=>r.group===row.group&&r.document===row.document&&r.format===row.format);
   if(previous>=0)report[previous]=row;else report.push(row);
   await writeFile(path.join(root,'검증결과.json'),JSON.stringify(report,null,2));
   console.log(`${index+1}/${items.length} ${item.title} ${format}: ${row.ok?'OK':row.error}`);
  }
  await page.close();
 }
}finally{await browser.close();await server.close();}
console.log(JSON.stringify({folder:root,documents:items.length,exports:report.length,failed:report.filter(r=>!r.ok)},null,2));
