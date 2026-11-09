'use strict';
// Isolated browser fixture. All external requests are mocked; no real account or diary.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.DAY_PLAYWRIGHT_PATH || 'playwright');
const root=path.join(__dirname,'..');
const mock=`
window.mockRows=['09:00','09:30'].map(start_time=>({user_id:'test-owner',date:'2026-10-27',start_time,category:'work',note:'Synthetic note',subcategory:'Lab'}));
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test-owner'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>{
 const q={filters:[],op:'select',select(){return this},eq(k,v){this.filters.push(r=>r[k]===v);return this},in(k,v){this.filters.push(r=>v.includes(r[k]));return this},gte(k,v){this.filters.push(r=>r[k]>=v);return this},lte(k,v){this.filters.push(r=>r[k]<=v);return this},or(value){const terms=value.split(',').map(term=>term.split('.'));this.filters.push(row=>terms.some(([key,op,...rest])=>op==='eq'&&row[key]===rest.join('.')));return this},order(){return this},range(){return this},limit(){return this},maybeSingle(){this.single=true;return this},upsert(value){this.op='upsert';this.value=Array.isArray(value)?value:[value];return this},delete(){this.op='delete';return this},then(resolve,reject){try{let data=window.mockRows.filter(r=>this.filters.every(f=>f(r)));if(this.op==='upsert'){for(const value of this.value){const i=window.mockRows.findIndex(r=>r.user_id===value.user_id&&r.date===value.date&&r.start_time===value.start_time);if(i>=0)window.mockRows[i]=value;else window.mockRows.push(value);}data=[];}if(this.op==='delete')window.mockRows=window.mockRows.filter(r=>!this.filters.every(f=>f(r)));return Promise.resolve({data:this.single?data[0] || null:data,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;
}})};
`;
(async()=>{
 const server=http.createServer((req,res)=>{const file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'') || 'index.html';if(!/^[\w.-]+$/.test(file)||file.startsWith('.')||!['.html','.css','.js','.webmanifest'].includes(path.extname(file))){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.DAY_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const context=await browser.newContext({timezoneId:'Europe/London',viewport:{width:1280,height:900},serviceWorkers:'block'});const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('popup',p=>p.close());
  await page.route('**/*',route=>{const url=route.request().url();if(url.includes('supabase.min.js'))return route.fulfill({contentType:'application/javascript',body:mock});if(new URL(url).pathname==='/config.js')return route.fulfill({contentType:'application/javascript',body:'window.APP_CONFIG={SUPABASE_URL:"https://synthetic.supabase.co",SUPABASE_ANON_KEY:"synthetic"};'});if(url.startsWith('http://127.0.0.1:'))return route.continue();return route.fulfill({status:204,body:''});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!document.getElementById('app').hidden);
  await page.evaluate(()=>goto(new Date('2026-10-27T12:00:00')));await page.waitForFunction(()=>document.querySelector('.block[data-slot="09:00"]')?.classList.contains('filled'));
  await page.evaluate(()=>openSheet(['09:00','09:30']));await page.getByRole('button',{name:'Discuss selection in Telegram'}).click();
  await page.waitForFunction(()=>window.mockRows.some(r=>r.start_time==='__agent_selection__'));const selection=await page.evaluate(()=>JSON.parse(window.mockRows.find(r=>r.start_time==='__agent_selection__').note));assert.deepEqual(selection.slots,['09:00','09:30']);assert.equal(selection.date,'2026-10-27');
  await page.evaluate(()=>closeSheet());
  await page.evaluate(()=>window.mockRows.push({user_id:'test-owner',date:'2000-01-01',start_time:'__agent_history__',note:JSON.stringify([{id:'test-action',createdAt:'2026-10-27T12:00Z',summaries:['Saved synthetic idea'],undone:false}])}));
  await page.getByRole('button',{name:'Agent changes',exact:true}).click();await page.getByText('Saved synthetic idea',{exact:false}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>{window.mockRows.push({user_id:'test-owner',date:'2026-10-27',start_time:'10:00',category:'food',note:'',subcategory:''});document.activeElement?.blur();});await page.evaluate(()=>refreshAgentChanges());await page.waitForFunction(()=>document.querySelector('.block[data-slot="10:00"]')?.classList.contains('filled'));
  await page.evaluate(()=>{window.mockRows=window.mockRows.filter(r=>!(r.user_id==='test-owner'&&r.start_time==='__settings__'));window.mockRows.push(
    {user_id:'test-owner',date:'2026-10-27',start_time:'__plan__',category:'plan',note:'[ ] Existing daily objective <!--day-link:existing-link::-->\n[x] Completed daily objective'},
    {user_id:'test-owner',date:'2026-10-28',start_time:'__plan__',category:'plan',note:'[ ] Tomorrow objective'},
    {user_id:'test-owner',date:'2026-10-27',start_time:'__rough_plan__',category:'calendar_plan',note:JSON.stringify(['Existing rough plan'])},
    {user_id:'test-owner',date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({shortTermObjectives:'[ ] Existing short-term objective',longTermObjectives:'[ ] Existing long-term objective'})},
    {user_id:'someone-else',date:'2026-10-27',start_time:'__plan__',category:'plan',note:'[ ] Other account secret'}
  );});
  const before=await page.evaluate(()=>JSON.stringify(window.mockRows));
  await page.getByRole('button',{name:'Memory & plans',exact:true}).click();const overview=page.locator('#agentMemoryBody');
  await overview.getByText('○ Existing daily objective',{exact:true}).waitFor();await overview.getByText('✓ Completed daily objective',{exact:true}).waitFor();await overview.getByText('Existing rough plan',{exact:true}).waitFor();await overview.getByText('○ Existing short-term objective',{exact:true}).waitFor();await overview.getByText('○ Existing long-term objective',{exact:true}).waitFor();
  await overview.getByText('No separately tracked commitments.',{exact:false}).waitFor();assert.ok(!(await overview.innerText()).includes('Nothing remembered yet'));assert.ok(!(await overview.innerText()).includes('day-link:'));assert.ok(!(await overview.innerText()).includes('Other account secret'));
  await overview.locator('summary').click();await overview.getByText('○ Tomorrow objective',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.mockRows)),before);await page.locator('#agentMemoryClose').click();
  await page.evaluate(()=>window.mockRows.push({user_id:'test-owner',date:'2000-01-01',start_time:'__memory__fixture',category:'agent_memory',note:JSON.stringify({id:'fixture',type:'memory',title:'Afternoon preference',text:'Prefer afternoon check-ins',status:'active',basis:'explicit',createdAt:'2026-10-28T12:00Z',revision:1})}));
  await page.getByRole('button',{name:'Memory & plans',exact:true}).click();await overview.getByText('Afternoon preference',{exact:false}).waitFor();await overview.getByText('○ Existing daily objective',{exact:true}).waitFor();if(process.env.DAY_WEB_SCREENSHOT){await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));document.getElementById('agentMemoryBody').scrollTop=0;document.querySelector('#agentMemoryDialog .sheet').scrollTop=0;});await page.screenshot({path:process.env.DAY_WEB_SCREENSHOT});}await page.locator('#agentMemoryClose').click();
  assert.equal(await page.locator('#helpBtn, #helpDialog, .planner-shortcuts').count(),0);await page.keyboard.press('?');
  assert.equal(await page.locator('#gymBtn').count(),0);await page.evaluate(()=>openInsight('gym'));assert.equal(await page.locator('#insightScreen').isVisible(),false);
  const voicePlan=await page.evaluate(()=>DayVoiceDraft.plan({items:[{date:'2026-10-29',start:'11:00',end_date:'2026-10-29',end:'11:30',category:'travel',activity:'Travel',details:{modes:['Train','Bus']},note:''}],reflections:[]},DayEventRange));assert.deepEqual(voicePlan.errors,[]);assert.deepEqual(voicePlan.slots[0].block.details.modes,['Bus','Train']);
  // Structured travel and work fields must survive a real page round-trip.
  await page.evaluate(async()=>{await goto(new Date('2026-10-29T12:00:00'));openSheet(['09:00','09:30']);});
  await page.locator('#activitySearch').fill('Travel');await page.locator('#catGrid button').filter({hasText:'Travel'}).first().click();
  await page.locator('#transportModes input[value="Train"]').check();await page.locator('#transportModes input[value="Bus"]').check();await page.locator('#activityDestination').fill('London');
  await page.locator('#saveBlock').click();
  await page.waitForFunction(()=>window.mockRows.some(r=>r.date==='2026-10-29'&&r.start_time==='09:00'&&r.details?.destination==='London'));
  const journey=await page.evaluate(()=>window.mockRows.find(r=>r.date==='2026-10-29'&&r.start_time==='09:00'));assert.equal(journey.category,'travel');assert.equal(journey.subcategory,'Travel');assert.deepEqual(journey.details.modes,['Bus','Train']);
  await page.evaluate(async()=>{await pullDay('2026-10-29');openSheet(['09:00','09:30']);});
  assert.equal(await page.locator('#transportModes input:checked').count(),2);assert.equal(await page.locator('#activityDestination').inputValue(),'London');
  if(process.env.DAY_TRAVEL_SCREENSHOT){await page.setViewportSize({width:390,height:844});await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:process.env.DAY_TRAVEL_SCREENSHOT});}
  await page.evaluate(()=>closeSheet());await page.evaluate(()=>openSheet(['10:00']));
  await page.locator('#activitySearch').fill('Meeting');await page.locator('#catGrid button').filter({hasText:'Meeting'}).first().click();await page.locator('#activityProject').fill('Moeve');await page.locator('#saveBlock').click();
  await page.waitForFunction(()=>window.mockRows.some(r=>r.date==='2026-10-29'&&r.start_time==='10:00'&&r.details?.project==='Moeve'));
  await page.evaluate(async()=>{await pullDay('2026-10-29');openSheet(['10:00']);});assert.equal(await page.locator('#activityProject').inputValue(),'Moeve');await page.evaluate(()=>closeSheet());
  await page.evaluate(()=>{insightRange=0;openInsight('subs');});await page.getByText('Work by project / company',{exact:true}).waitFor();await page.locator('#insightBody').getByText('Bus + Train',{exact:true}).waitFor();await page.evaluate(()=>closeInsight());
  assert.deepEqual(errors,[]);console.log('PASS: signed-in fixture, slot selection sharing, activity view, cloud refresh, existing objectives and plans without memories, owner isolation, read-only overview, saved memories, structured multi-mode journeys, work projects, detail round-trip, breakdown reports, no browser errors.');
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
