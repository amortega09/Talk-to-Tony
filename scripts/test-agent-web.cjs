'use strict';
// Isolated browser fixture. All external requests are mocked; no real account or diary.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.DAY_PLAYWRIGHT_PATH || 'playwright');
const root=path.join(__dirname,'..');
const mock=`
window.mockRows=['09:00','09:30'].map(start_time=>({user_id:'test-owner',date:'2026-10-27',start_time,category:'work',note:'Synthetic note',subcategory:'Lab'}));
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test-owner'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>{
 const q={filters:[],op:'select',select(){return this},eq(k,v){this.filters.push(r=>r[k]===v);return this},in(k,v){this.filters.push(r=>v.includes(r[k]));return this},gte(k,v){this.filters.push(r=>r[k]>=v);return this},lte(k,v){this.filters.push(r=>r[k]<=v);return this},order(){return this},range(){return this},limit(){return this},maybeSingle(){this.single=true;return this},upsert(value){this.op='upsert';this.value=Array.isArray(value)?value:[value];return this},delete(){this.op='delete';return this},then(resolve,reject){try{let data=window.mockRows.filter(r=>this.filters.every(f=>f(r)));if(this.op==='upsert'){for(const value of this.value){const i=window.mockRows.findIndex(r=>r.user_id===value.user_id&&r.date===value.date&&r.start_time===value.start_time);if(i>=0)window.mockRows[i]=value;else window.mockRows.push(value);}data=[];}if(this.op==='delete')window.mockRows=window.mockRows.filter(r=>!this.filters.every(f=>f(r)));return Promise.resolve({data:this.single?data[0] || null:data,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;
}})};
`;
(async()=>{
 const server=http.createServer((req,res)=>{const file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'') || 'index.html';if(!/^[\w.-]+$/.test(file)||file.startsWith('.')||!['.html','.css','.js','.webmanifest'].includes(path.extname(file))){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.DAY_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const context=await browser.newContext({timezoneId:'Europe/London',viewport:{width:1280,height:900},serviceWorkers:'block'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>p.close());
  await page.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:mock});if(new URL(url).pathname==='/config.js')return route.fulfill({contentType:'application/javascript',body:'window.APP_CONFIG={SUPABASE_URL:"https://synthetic.supabase.co",SUPABASE_ANON_KEY:"synthetic"};'});if(url.startsWith('http://127.0.0.1:'))return route.continue();return route.fulfill({status:204,body:''});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!document.getElementById('app').hidden);
  await page.evaluate(()=>goto(new Date('2026-10-27T12:00:00')));await page.waitForFunction(()=>document.querySelector('.block[data-slot="09:00"]')?.classList.contains('filled'));
  await page.evaluate(()=>openSheet(['09:00','09:30']));await page.getByRole('button',{name:'Discuss selection in Telegram'}).click();
  await page.waitForFunction(()=>window.mockRows.some(r=>r.start_time==='__agent_selection__'));const selection=await page.evaluate(()=>JSON.parse(window.mockRows.find(r=>r.start_time==='__agent_selection__').note));assert.deepEqual(selection.slots,['09:00','09:30']);assert.equal(selection.date,'2026-10-27');
  await page.evaluate(()=>closeSheet());
  await page.evaluate(()=>window.mockRows.push({user_id:'test-owner',date:'2000-01-01',start_time:'__agent_history__',note:JSON.stringify([{id:'test-action',createdAt:'2026-10-27T12:00Z',summaries:['Saved synthetic idea'],undone:false}])}));
  await page.getByRole('button',{name:'Agent changes',exact:true}).click();await page.getByText('Saved synthetic idea',{exact:false}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{window.mockRows.push({user_id:'test-owner',date:'2026-10-27',start_time:'10:00',category:'food',note:'',subcategory:''});document.activeElement?.blur();});await page.evaluate(()=>refreshAgentChanges());await page.waitForFunction(()=>document.querySelector('.block[data-slot="10:00"]')?.classList.contains('filled'));
  assert.deepEqual(errors,[]);console.log('PASS: signed-in fixture, slot selection sharing, activity view, cloud refresh, no browser errors.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
