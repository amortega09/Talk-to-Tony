const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const vm=require('node:vm');
const D=require('../server/telegram/domain.cjs');
const {parseUpdate,preview}=require('../server/telegram/service.cjs');
const {handlers,equal}=require('../server/telegram/http.cjs');
const {opusDuration,providers}=require('../server/telegram/providers.cjs');
const A=require('../voice-actions');
const empty=()=>({reply:'Review',questions:[],items:[],reflections:[],actions:[]});
const date='2026-10-26';
const block=(start_time,category='work',note='',extra={})=>({date,start_time,category,note,subcategory:'Sample',version:'1:99',...extra});
test('contract exactly matches canonical Python interpreter without calling a provider',()=>{
  const exported=JSON.parse(execFileSync('python3',['-c',"import json,desktop;print(json.dumps(dict(version=1,system=desktop.SYSTEM,schema=desktop.SCHEMA,model=desktop.RECOMMENDED_MODEL,thinking=desktop.MODEL_THINKING)))"],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8'}));
  assert.deepEqual(D.contract,exported);
});
test('headless serializers match the actual app with metadata, checkboxes and legacy plans',()=>{
  const src=readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
  const names=['parseObjectiveLine','serializeObjectiveItem','serializeObjectiveItems','roughPlansForDay','roughPlanBlock'];
  const sandbox={ROUGH_PLAN_KEY:'__rough_plan__'};vm.createContext(sandbox);
  for(const name of names){const start=src.indexOf(`function ${name}(`),end=src.indexOf('\n}',start)+2;vm.runInContext(src.slice(start,end),sandbox);}
  for(const line of ['[x] Done','- [ ] Task','1. Plan','[X] Gym <!--day-link:abc:2026-10-24:2026-10-25-->','Bare text',''])assert.deepEqual(D.helpers.parseObjective(line),JSON.parse(JSON.stringify(sandbox.parseObjectiveLine(line))));
  const items=['[x] Done','[ ] One <!--day-link:a:2026-10-24:-->'].map(D.helpers.parseObjective);
  assert.equal(D.helpers.serializeObjectives(items),sandbox.serializeObjectiveItems(items));
  for(const note of ['["One", "Two"]','One\nTwo','', '[1," x "]'])assert.deepEqual(D.helpers.roughPlans({__rough_plan__:{note}}),JSON.parse(JSON.stringify(sandbox.roughPlansForDay({__rough_plan__:{note}}))));
  assert.deepEqual(D.helpers.roughPlanBlock(['One']),JSON.parse(JSON.stringify(sandbox.roughPlanBlock(['One']))));
});
test('spoken-time normalization parity with Python',()=>{
  const phrases=['from 830 am to 9.30 am','at 1030 this morning','12:30 am','version 1.30','from 8.30 to 10 am','13 pm','yesterday at 5 pm','at 930 p.m.'];
  const expected=JSON.parse(execFileSync('python3',['-c',`import json,desktop;print(json.dumps([desktop.normalize_spoken_times(t) for t in json.loads(${JSON.stringify(JSON.stringify(phrases))})]))`],{encoding:'utf8'}));
  assert.deepEqual(phrases.map(D.normalizeTimes),expected);
});
for(const [stamp,day,time] of [['2026-10-24T23:30:00Z','2026-10-25','00:30'],['2026-10-25T00:30:00Z','2026-10-25','01:30'],['2026-10-25T01:30:00Z','2026-10-25','01:30'],['2026-03-29T01:30:00Z','2026-03-29','02:30']])test(`London date anchor ${stamp}`,()=>{assert.deepEqual(D.anchor(Date.parse(stamp)/1000),{today:day,local_time:time,timezone:'Europe/London'});});
for(const category of D.helpers.categories)for(const [start,end] of [['00:00','00:30'],['08:30','09:30'],['23:00','24:00']])test(`new ${category} ${start}–${end}`,()=>{
  const d={...empty(),items:[{date,start,end_date:date,end,category,activity:'Sample',note:'Preserved'}]};const p=D.plan(d,[],[]);
  assert.ok(p.patches.length>=1);assert.ok(p.patches.every(p=>p.before===null&&p.after.category===category&&p.after.note==='Preserved'));
});
for(const field of ['energy','satisfaction'])for(const score of [1,2,3,4,5])test(`${field} ${score} preserves other rating`,()=>{
  const d={...empty(),actions:[{type:'checkin',date,[field]:score}]},r=[block('__checkin__','checkin',JSON.stringify({energy:3,satisfaction:4}))];const p=D.plan(d,r,[]);
  const value=p.patches[0]?JSON.parse(p.patches[0].after.note):{energy:3,satisfaction:4};assert.equal(value[field],score);assert.equal(value[field==='energy'?'satisfaction':'energy'],field==='energy'?4:3);
});
for(const score of [0,6,-1,1.5,'4',true,null])test(`invalid or missing rating ${score}`,()=>{assert.throws(()=>D.plan({...empty(),actions:[{type:'checkin',date,energy:score}]},[],[]));});
for(const status of ['holiday','travel','sick','off','clear'])test(`day status ${status}`,()=>{const p=D.plan({...empty(),actions:[{type:'day_status',date,status}]},[block('__day_status__','calendar_status','Holiday',{subcategory:'holiday'})],[]);assert.equal(p.patches.length,status==='holiday'?0:1);});
for(const [start,end] of [['09:15','10:00'],['09:00','09:00'],['10:00','09:00'],['25:00','26:00'],[null,'10:00']])test(`invalid interval ${start}/${end}`,()=>{assert.throws(()=>D.plan({...empty(),items:[{date,start,end_date:date,end,category:'work',activity:'X',note:''}]},[],[]));});
for(const day of ['2026-02-30','2026-13-01','2000-01-01','yesterday','2026-1-1'])test(`reject invalid action date ${day}`,()=>{assert.throws(()=>D.plan({...empty(),actions:[{type:'query_day',date:day}]},[],[]));});
test('overnight entries and reflection append preserve previous text',()=>{const d={...empty(),items:[{date,start:'23:30',end_date:'2026-10-27',end:'00:30',category:'sleep',activity:'Sleep',note:''}],reflections:[{date,text:'New'}]};const p=D.plan(d,[block('__reflect__','reflection','Old')],[]);assert.equal(p.patches.length,3);assert.equal(p.patches.find(p=>p.slot==='__reflect__').after.note,'Old\n\nNew');});
test('targeted move, rename and delete preserve notes; collisions reject',()=>{
  const r=[block('09:00'),block('09:30')],catalog=A.targets(A.daysFromRows(r),D.helpers),target=catalog[0].id;
  const p=D.plan({...empty(),actions:[{type:'activity_update',target,start:'11:00',end:'12:00',activity:'Renamed'}]},r,catalog);assert.equal(p.patches.length,4);assert.equal(p.patches.find(p=>p.after)?.after.sub,'Renamed');
  assert.equal(D.plan({...empty(),actions:[{type:'activity_delete',target}]},r,catalog).patches.length,2);
  assert.throws(()=>D.plan({...empty(),actions:[{type:'activity_update',target,start:'11:00',end:'12:00'}]},[...r,block('11:00')],catalog),/overlaps/);
});
test('linked objective completion, removal and global settings preservation',()=>{
  const r=[block('__plan__','plan','[ ] One <!--day-link:a:2026-10-26:-->'),block('__plan__','plan','[ ] One <!--day-link:a:2026-10-26:-->',{date:'2026-10-27'}),block('__settings__','settings',JSON.stringify({theme:'dark',shortTermObjectives:'[ ] Global'}),{date:'2000-01-01'})];const c=A.targets(A.daysFromRows(r),D.helpers);
  assert.equal(D.plan({...empty(),actions:[{type:'objective_complete',target:c[0].id,completed:true}]},r,c).patches.length,2);
  assert.equal(D.plan({...empty(),actions:[{type:'objective_remove',target:c[0].id}]},r,c).patches[0].after,null);
  const p=D.plan({...empty(),actions:[{type:'objective_add',horizon:'shortTermObjectives',text:'Next'}]},r,c);assert.equal(JSON.parse(p.patches[0].after.note).theme,'dark');
});
test('rough plans, existing notes and deterministic query totals',()=>{
  assert.equal(D.plan({...empty(),actions:[{type:'rough_plan_add',date,text:'Walk'}]},[],[]).patches[0].after.sub,'Rough plan');
  const r=[block('__note__a','note',JSON.stringify({id:'a',title:'Note',body:'Old'}),{date:'2000-01-01'}),block('09:00'),block('09:30','work','[GCal] planned')],c=A.targets(A.daysFromRows(r),D.helpers);
  const p=D.plan({...empty(),actions:[{type:'note_append',target:'note:a',text:'More'}]},r,c);assert.equal(JSON.parse(p.patches[0].after.note).body,'Old\n\nMore');
  assert.match(D.plan({...empty(),actions:[{type:'query_day',date}]},r,c).answers[0],/0.5 hours/);
});
for(const phrase of ['save','save it','apply changes','/save','confirm'])test(`explicit confirmation ${phrase}`,()=>assert.equal(D.control(phrase,{today:date}).control,'save'));
for(const phrase of ["don't save",'never save','save tomorrow','I thought about deleting my gym session','cancel my subscription','undo everything'])test(`not a control: ${phrase}`,()=>assert.equal(D.control(phrase,{today:date}),null));
test('question produces no writable plan even if model also supplied an action',()=>{assert.equal(D.plan({...empty(),questions:['Which one?'],actions:[{type:'activity_delete',target:'made up'}]},[],[]).patches.length,0);});
test('fabricated targets and unsupported operations never become patches',()=>{for(const action of [{type:'activity_delete',target:'invented'},{type:'execute_sql',text:'delete'},{type:'checkin',date,energy:2,sql:'bad'}])assert.throws(()=>D.plan({...empty(),actions:[action]},[],[]));});
test('Telegram updates reject groups, other actors, forwards, old dates and edited messages',()=>{
  const u={update_id:1,message:{message_id:5,date:Math.floor(Date.now()/1000),from:{id:123},chat:{id:123,type:'private'},text:'Hello'}};
  assert.equal(parseUpdate(u).text,'Hello');
  for(const change of [{chat:{id:123,type:'group'}},{from:{id:456}},{forward_origin:{}},{date:1}])assert.equal(parseUpdate({...u,message:{...u.message,...change}}),null);
  assert.equal(parseUpdate({update_id:1,edited_message:u.message}),null);
});
test('all preview pages fit Telegram limits; callback identifies exact draft',()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',data={draft:empty(),review:{summaries:['x'.repeat(8000)],answers:[],navigation:[],questions:[],patches:[{}]},transcript:'s'};
  const pages=preview(id,data);assert.ok(pages.every(p=>p.text.length<=3600));assert.ok(pages.every(p=>p.draftId===id));assert.ok(pages.at(-1).reply_markup.inline_keyboard[0].every(b=>b.callback_data.length<=64));
});
test('HTTP auth, raw-body bounds and disabled defaults fail closed',async()=>{
  let used=0;const h=handlers({env:{TELEGRAM_ENABLED:'1',TELEGRAM_WEBHOOK_SECRET:'secret'},getRuntime:()=>{used++;throw new Error('must not call');}});
  assert.equal((await h.webhook(new Request('https://test',{method:'POST',body:'{}'}))).status,401);assert.equal(used,0);
  assert.equal((await h.webhook(new Request('https://test',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:'x'.repeat(65000)}))).status,400);
  assert.equal((await handlers({env:{}}).webhook(new Request('https://test',{method:'POST'}))).status,503);
  assert.equal(equal('secret','secret'),true);assert.equal(equal('secret',''),false);
});
test('invalid audio never reaches speech provider; Groq receives bytes, not bot-token URL',async()=>{
  const calls=[];const p=providers({TELEGRAM_BOT_TOKEN:'secret',GROQ_API_KEY:'speech'},async(url,init)=>{calls.push(url);if(url.endsWith('getFile'))return Response.json({ok:true,result:{file_path:'voice/a.oga'}});return new Response(Buffer.from('not audio'));});
  await assert.rejects(p.transcribe({fileId:'x',duration:20}),/OGG/);assert.equal(calls.length,2);assert.ok(calls.every(u=>!u.includes('groq')));
});
test('Ogg timing parser rejects malformed and oversized-duration audio',()=>{
  assert.throws(()=>opusDuration(Buffer.alloc(0)));assert.throws(()=>opusDuration(Buffer.from('RIFFxxx')));
  const b=Buffer.alloc(47);b.write('OggS');b[5]=6;b[26]=1;b[27]=19;b.write('OpusHead',28);b[37]=1;b.writeBigUInt64LE(121n*48000n,6);assert.throws(()=>opusDuration(b),/two minutes/);
});
test('Telegram final page without EOS is accepted only with a complete packet',()=>{
  const b=Buffer.from(readFileSync(joinFixture('silence.ogg')));let at=0,last=0;
  while(at<b.length){last=at;const n=b[at+26];let size=0;for(let i=0;i<n;i++)size+=b[at+27+i];at+=27+n+size;}
  b[last+5]&=~4;
  assert.ok(Math.abs(opusDuration(b)-0.4)<0.01);
  assert.throws(()=>opusDuration(b.subarray(0,b.length-1)),/incomplete/);
  const n=b[last+26],index=last+26+n,extra=255-b[index];b[index]=255;
  assert.throws(()=>opusDuration(Buffer.concat([b,Buffer.alloc(extra)])),/complete audio/);
});
test('genuine encoded Ogg fixture uploads bytes without leaking Telegram credentials to Groq',async()=>{
  const audio=readFileSync(joinFixture('silence.ogg'));assert.ok(Math.abs(opusDuration(audio)-0.4)<0.01);
  let uploaded;
  const p=providers({TELEGRAM_BOT_TOKEN:'private-telegram-token',GROQ_API_KEY:'speech-key'},async(url,init)=>{
    if(url.endsWith('getFile'))return Response.json({ok:true,result:{file_path:'voice/file.oga'}});
    if(url.startsWith('https://api.telegram.org/file/'))return new Response(audio);
    assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');uploaded=init.body;
    assert.equal(init.headers.Authorization,'Bearer speech-key');assert.equal(uploaded.get('url'),null);
    assert.deepEqual(Buffer.from(await uploaded.get('file').arrayBuffer()),audio);
    return Response.json({text:'A synthetic transcript',segments:[{no_speech_prob:0.01}]});
  });
  assert.equal(await p.transcribe({fileId:'sample',duration:1}),'A synthetic transcript');assert.ok(uploaded);
});
function joinFixture(name){return require('node:path').join(__dirname,'telegram-fixtures',name);}
test('transcription silence detection cannot create a diary draft',async()=>{
  const audio=readFileSync(joinFixture('silence.ogg'));
  const p=providers({TELEGRAM_BOT_TOKEN:'t',GROQ_API_KEY:'s'},async url=>url.endsWith('getFile')?Response.json({ok:true,result:{file_path:'a.oga'}}):url.includes('/file/')?new Response(audio):Response.json({text:'Thank you for watching',segments:[{no_speech_prob:0.99}]}));
  await assert.rejects(p.transcribe({fileId:'x',duration:1}),/clear speech/);
});
test('provider credentials and bot-token URLs are absent from surfaced network errors',async()=>{
  const p=providers({TELEGRAM_BOT_TOKEN:'private-token'},async()=>{throw new Error('private-token-url');});
  await assert.rejects(p.send(1,{text:'test'}),e=>!e.message.includes('private-token'));
});
test('QStash validates signature, body, destination, expiration and rotation',async()=>{
  const {SignJWT}=require('jose'),{createHash}=require('node:crypto'),{queue}=require('../server/telegram/providers.cjs');
  const env={QSTASH_TOKEN:'test',QSTASH_CURRENT_SIGNING_KEY:'current-signing-key',QSTASH_NEXT_SIGNING_KEY:'next-signing-key',TELEGRAM_PUBLIC_ORIGIN:'https://example.com'};
  const q=queue(env),body=JSON.stringify({jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});
  const sign=(key,sub=q.url,exp='1m')=>new SignJWT({body:createHash('sha256').update(body).digest('base64url')}).setProtectedHeader({alg:'HS256'}).setIssuer('Upstash').setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(key));
  const s=await sign(env.QSTASH_CURRENT_SIGNING_KEY);assert.equal(await q.verify(s,body),true);
  assert.equal(await q.verify(await sign(env.QSTASH_NEXT_SIGNING_KEY),body),true);
  await assert.rejects(q.verify(s,body+' '));await assert.rejects(q.verify(await sign('wrong'),body));await assert.rejects(q.verify(await sign(env.QSTASH_CURRENT_SIGNING_KEY,'https://wrong'),body));await assert.rejects(q.verify(await sign(env.QSTASH_CURRENT_SIGNING_KEY,q.url,-1),body));
});
test('callback parser binds action to opaque draft, not arbitrary JSON',()=>{
  const base={update_id:2,callback_query:{id:'callback',from:{id:123},message:{message_id:6,chat:{id:123,type:'private'}},data:'save:aaaaaaaaaaaabbbbccccdddddddddddd'}};
  assert.ok(parseUpdate(base).callback.id);assert.equal(parseUpdate({...base,callback_query:{...base.callback_query,data:'save:{"sql":"delete"}'}}),null);
});
test('authenticated webhook awaits queue acceptance and returns retry on publication failure',async()=>{
  const env={TELEGRAM_ENABLED:'1',TELEGRAM_WEBHOOK_SECRET:'secret',TELEGRAM_BOT_TOKEN:'42:key'};
  const body=JSON.stringify({update_id:1,message:{message_id:1,date:Math.floor(Date.now()/1000),text:'test',from:{id:123},chat:{id:123,type:'private'}}});
  const h=handlers({env,getRuntime:()=>({service:{ingest:async()=>{throw new Error('queue unavailable');}}})});
  assert.equal((await h.webhook(new Request('https://example.com',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body}))).status,503);
});
test('signed worker still rejects malformed job IDs and extra actions',async()=>{
  let calls=0;const h=handlers({env:{TELEGRAM_ENABLED:'1',TELEGRAM_PROCESSING_ENABLED:'1'},getRuntime:()=>({queue:{verify:async()=>true},service:{process:async()=>calls++}})});
  for(const body of [{jobId:'bad'},{jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',sql:'bad'}])assert.equal((await h.worker(new Request('https://test',{method:'POST',body:JSON.stringify(body)}))).status,400);
  assert.equal(calls,0);assert.equal(equal('é','x'),false);
});
test('bounded context does not expose all note bodies or fabricate current UI selection',()=>{
  const r=Array.from({length:100},(_,i)=>block('__note__'+i,'note',JSON.stringify({id:String(i),title:'Note '+i,body:'z'.repeat(1000)}),{date:'2000-01-01'}));
  const c=D.context(r,'today',{today:date,local_time:'09:00'});assert.equal(c.app.selected_target,null);assert.ok(c.app.targets.length<=80);assert.ok(JSON.stringify(c).length<40000);
});
test('queue publishes only opaque IDs with bounded timeout and distinct stage deduplication',async()=>{
  const {queue}=require('../server/telegram/providers.cjs');const sent=[];
  const q=queue({QSTASH_TOKEN:'private',TELEGRAM_PUBLIC_ORIGIN:'https://example.com',QSTASH_CURRENT_SIGNING_KEY:'a',QSTASH_NEXT_SIGNING_KEY:'b'},async(url,init)=>{sent.push({url,...init});return Response.json({messageId:'test'});});
  await q.publish('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');await q.publish('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','transcript');
  assert.match(sent[0].headers['Upstash-Deduplication-Id'],/^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(sent[0].body),{jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});assert.notEqual(sent[0].headers['Upstash-Deduplication-Id'],sent[1].headers['Upstash-Deduplication-Id']);assert.equal(sent[0].headers['Upstash-Timeout'],'55s');assert.equal(sent[0].redirect,'error');assert.ok(sent[0].signal);
});
test('provider retry-after is propagated without exposing response content',async()=>{
  const p=providers({TELEGRAM_BOT_TOKEN:'secret'},async()=>new Response('private provider detail',{status:429,headers:{'Retry-After':'123'}}));
  await assert.rejects(p.send(1,{text:'test'}),e=>e.retryAfter===123&&!e.message.includes('private'));
});
test('live-model null activity notes normalize without relaxing action or schema validation',async()=>{
  const draft={...empty(),items:[{date,start:'09:00',end_date:date,end:'10:00',category:'work',activity:'Sample Project',note:null}]};
  const model=d=>providers({OLLAMA_API_KEY:'test'},async()=>Response.json({message:{content:JSON.stringify(d)}}));
  const result=await model(draft).interpret('Worked from 9 am to 10 am',{today:date});
  assert.equal(result.items[0].note,'');assert.equal(D.plan(result,[],[]).patches.length,2);
  for(const note of [42,{},false])await assert.rejects(model({...draft,items:[{...draft.items[0],note}]}).interpret('Worked',{today:date}),e=>e.code==='model_invalid');
  await assert.rejects(model({...draft,unexpected:'ignored?'}).interpret('Worked',{today:date}),e=>e.code==='model_invalid');
});
test('Vercel entry points load without credentials and stay disabled by default',async()=>{
  const {pathToFileURL}=require('node:url'),path=require('node:path');
  for(const name of ['webhook','worker']){const route=await import(pathToFileURL(path.join(__dirname,`../api/telegram/${name}.mjs`)));assert.equal(typeof route.default.fetch,'function');assert.equal((await route.default.fetch(new Request('https://test',{method:'POST'}))).status,503);}
});
test('Telegram format resolver follows category-only app formats across categories',()=>{
  for(const category of D.helpers.categories){const d={...empty(),items:[{date,start:'00:00',end_date:date,end:'01:00',category,activity:category,note:''}]};const p=D.plan(d,[],[],{strict:true});assert.equal(p.questions.length,0);assert.equal(p.patches.length,2);assert.ok(p.patches.every(p=>p.after.sub===''&&p.after.category===category));}
});
test('saved names retain exact spelling and stored category instead of model guess',()=>{
  const r=[block('09:00','work','',{subcategory:'Sample Project'})];const d={...empty(),items:[{date,start:'11:00',end_date:date,end:'12:00',category:'other',activity:'sample   project',note:''}]};const p=D.plan(d,r,[],{strict:true});assert.ok(p.patches.every(p=>p.after.sub==='Sample Project'&&p.after.category==='work'));
});
test('note-only activities retain the app wire format without copying unrelated notes',()=>{
  const r=[block('09:00','work','Prepare report',{subcategory:''}),block('10:00','work','Private historical detail',{subcategory:'Meeting'})];
  for(const [activity,sub,note] of [['Prepare report','','Prepare report'],['Meeting','Meeting','']]){const p=D.plan({...empty(),items:[{date,start:'11:00',end_date:date,end:'11:30',category:'work',activity,note:''}]},r,[],{strict:true});assert.equal(p.patches[0].after.sub,sub);assert.equal(p.patches[0].after.note,note);}
});
test('unknown names require explicit confirmation and conflicting names require a category',()=>{
  const d={...empty(),items:[{date,start:'11:00',end_date:date,end:'11:30',category:'work',activity:'New project',note:''}]};const p=D.plan(d,[],[],{strict:true});assert.equal(p.patches.length,0);assert.deepEqual(p.formatProposals,['New project']);assert.equal(D.plan(d,[],[],{strict:true,allowedNew:['New project']}).patches.length,1);
  const r=[block('09:00','work','',{subcategory:'Meeting'}),block('10:00','social','',{subcategory:'Meeting'})];d.items[0].activity='Meeting';assert.equal(D.plan(d,r,[],{strict:true}).patches.length,0);assert.equal(D.plan(d,r,[],{strict:true,selectedCategory:'social'}).patches[0].after.category,'social');
});
test('saved activity settings override historical area and canonicalize names',()=>{
  const r=[block('__settings__','settings',JSON.stringify({subs:{work:['Project X']},activityAreas:{'project x':'learn'}}),{date:'2000-01-01'}),block('09:00','work','',{subcategory:'project x'})];
  const p=D.plan({...empty(),items:[{date,start:'12:00',end_date:date,end:'12:30',category:'other',activity:'project x',note:''}]},r,[],{strict:true});assert.equal(p.patches[0].after.category,'learn');assert.equal(p.patches[0].after.sub,'Project X');
});
test('repeating an existing activity preserves notes and does not invent duplicate subcategories',()=>{
  const r=[block('00:00','sleep','Existing detail',{subcategory:''})];const p=D.plan({...empty(),items:[{date,start:'00:00',end_date:date,end:'00:30',category:'sleep',activity:'Sleep',note:''}]},r,[],{strict:true});assert.equal(p.patches.length,0);
});
test('category labels match the base app and legacy custom activities remain reusable',()=>{
  const src=readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');const builtins=src.slice(src.indexOf('const BUILTIN_CATEGORIES'),src.indexOf('// Palette'));
  const vocabulary=require('../server/telegram/formats.cjs').vocabulary([]);
  for(const m of builtins.matchAll(/id: "([^"]+)"\s*,\s*label: "([^"]+)"/g))assert.ok(vocabulary.some(f=>f.category===m[1]&&f.label===m[2]&&f.sub===''));
  const r=[block('__settings__','settings',JSON.stringify({customCats:[{id:'c_project',label:'Legacy Project'}]}),{date:'2000-01-01'}),block('09:00','c_project','',{subcategory:''})];
  const f=require('../server/telegram/formats.cjs').resolve('legacy project','other',r,{strict:true}).format;assert.equal(f.sub,'Legacy Project');assert.equal(f.category,'other');
});
test('moves preserve exact original fields while explicit renames reuse a saved format',()=>{
  const r=[block('09:00','sleep','Keep this',{subcategory:''}),block('12:00','work','',{subcategory:'Project X'})],c=A.targets(A.daysFromRows(r),D.helpers),target=c.find(t=>t.category==='sleep').id;
  const move={...empty(),actions:[{type:'activity_update',target,start:'10:00',end:'10:30'}]};
  const p=D.plan(move,r,c,{strict:true});assert.deepEqual(p.patches.find(p=>p.after).after,{category:'sleep',sub:'',note:'Keep this'});
  move.actions[0].activity='project x';const renamed=D.plan(move,r,c,{strict:true}).patches.find(p=>p.after).after;assert.deepEqual(renamed,{category:'work',sub:'Project X',note:'Keep this'});
});
