import {createServer} from 'vite';
import {chromium} from 'playwright';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:12347},resolve:{alias:{'@':`${process.cwd()}/src`}}});
await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(); page.on('pageerror',e=>console.log('pageerror',e.message));
 await page.goto('http://127.0.0.1:12347/audit/generation-verification/preview.html'); await page.waitForFunction(()=>window.ready);
 const docs={}; for(const name of await readdir('audit/model-bench/full-luna')) if(name.endsWith('.md')) docs[name]=await readFile(`audit/model-bench/full-luna/${name}`,'utf8');
 for(const name of await readdir('audit/generation-verification')) if(/^live-.*\.md$/.test(name)) docs[name]=await readFile(`audit/generation-verification/${name}`,'utf8');
 const results=await page.evaluate(docs=>window.checkDiagrams(docs),docs);
 const screen={};for(const [name,code] of Object.entries({TB:'flowchart TB\n A[시작] --> B[완료]',BT:'graph BT\n A[시작] --> B[완료]',invalid:'flowchart TD\n A[broken'}))screen[name]=await page.evaluate(c=>window.checkScreen(c),code);
 const document=await page.evaluate(c=>window.checkDocument(c),docs['flowchart.md']);
 await page.screenshot({path:'audit/generation-verification/diagrams.png'});
 const report={diagrams:results,screen,document};await writeFile(`audit/generation-verification/${process.argv[2]||'baseline'}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({total:results.length,failed:results.filter(r=>!r.parse||!r.png),screen,document},null,2));
 if(results.some(r=>!r.parse||!r.png)||!screen.TB.outcome?.ok||!screen.BT.outcome?.ok||document.screen.svg!==10||document.files.docx.images!==10||document.files.pptx.images!==10||document.htmlImages!==10||document.files.pdf.bytes<10000) throw new Error('다이어그램 검증 실패');
}finally{await browser.close();await server.close();}
