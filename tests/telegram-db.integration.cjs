'use strict';
const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const {Pool}=require('pg');
const {Store,one}=require('../server/telegram/store.cjs');
const {Service,preview}=require('../server/telegram/service.cjs');
const D=require('../server/telegram/domain.cjs');
const socket=process.env.DAY_BOT_TEST_SOCKET;
if(!socket || !socket.includes('day-telegram-test-'))throw new Error('Run npm run test:telegram:db; never point these tests at a real project.');
const admin=new Pool({host:socket,user:'postgres',database:'postgres',max:5});
const scoped=new Pool({host:socket,user:'day_telegram',database:'postgres',max:5});
const store=new Store(scoped),owner='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',connection='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let seq=10;
const empty=()=>({reply:'Draft ready',questions:[],items:[],reflections:[],actions:[]});
const day='2026-10-26';
before(async()=>{
  await admin.query("create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
  await admin.query(readFileSync(join(__dirname,'../supabase-schema.sql'),'utf8'));
  await admin.query('grant usage on schema auth to authenticated; grant select,insert,update,delete on public.blocks to authenticated; grant usage on sequence public.blocks_id_seq to authenticated;');
  const file=readdirSync(join(__dirname,'../supabase/migrations')).find(f=>f.endsWith('_telegram_private_gateway.sql'));
  await admin.query(readFileSync(join(__dirname,'../supabase/migrations',file),'utf8'));
  await admin.query(readFileSync(join(__dirname,'../supabase/migrations/20261027184503_telegram_checkins.sql'),'utf8'));
  await admin.query(readFileSync(join(__dirname,'../supabase/migrations/20261027185056_move_selected_slots_previous_day.sql'),'utf8'));
  await admin.query(readFileSync(join(__dirname,'../supabase/migrations/20261027185438_overwrite_previous_day_transfer.sql'),'utf8'));
  await admin.query(readFileSync(join(__dirname,'../supabase/migrations/20261027210936_agent_context_preferences.sql'),'utf8'));
  await admin.query('alter role day_telegram login');
  await admin.query('insert into day_bot.role_owners(role_name,owner,writes_enabled) values($1,$2,true)',['day_telegram',owner]);
});
beforeEach(async()=>{
  await admin.query('truncate day_bot.outbox,day_bot.receipts,day_bot.drafts,day_bot.jobs,day_bot.links,day_bot.connections,day_bot.usage,public.blocks restart identity cascade');
  await admin.query('update day_bot.role_owners set writes_enabled=true');
  await admin.query('insert into day_bot.connections(id,owner,telegram_user,chat_id) values($1,$2,123,123)',[connection,owner]);
});
after(async()=>{await scoped.end();await admin.end();});
async function job(text='hello',extra={}){
  const n=++seq;const inserted=await store.ingest('42',{updateId:n,userId:123,chatId:123,messageId:n,timestamp:1793000000,text,...extra});return store.claim(inserted.id);
}
async function seed(slot='09:00',note='original',who=owner){await admin.query("insert into public.blocks(user_id,date,start_time,category,note,subcategory) values($1,$2,$3,'work',$4,'Sample')",[who,day,slot,note]);}
async function draft(value={...empty(),items:[{date:day,start:'09:00',end_date:day,end:'10:00',category:'work',activity:'New',note:''}]}){
  const j=await job(),r=await store.readRows(j),ctx=D.context(r,'sample',{today:day,local_time:'12:00'}),review=D.plan(value,r,ctx.app.targets);
  return store.saveDraft(j,{draft:value,review,time:{today:day,local_time:'12:00'},conversation:[],transcript:'sample'},preview);
}
async function savedBlocks(){return (await admin.query("select user_id,date::text,start_time,category,note,subcategory from public.blocks where start_time<>'__agent_history__' order by user_id,date,start_time")).rows;}
test('RLS limits the login role to one owner and denies changing its authority',async()=>{
  await seed('09:00','ours');await seed('09:00','theirs',other);
  assert.equal((await scoped.query('select * from public.blocks')).rowCount,1);
  assert.equal((await scoped.query('delete from public.blocks where user_id=$1',[other])).rowCount,0);
  await assert.rejects(scoped.query("insert into public.blocks(user_id,date,start_time,category) values($1,$2,'11:00','work')",[other,day]),/row-level security/);
  await assert.rejects(scoped.query('update day_bot.role_owners set owner=$1',[other]),/permission denied/);
  await assert.rejects(scoped.query('set role postgres'),/permission denied/);
  await assert.rejects(scoped.query('create table public.forbidden(id int)'),/permission denied/);
});
test('private schema inaccessible to anonymous and ordinary app roles',async()=>{
  const c=await admin.connect();try{for(const role of ['anon','authenticated']){await c.query(`set role ${role}`);await assert.rejects(c.query('select * from day_bot.jobs'),/permission denied/);await c.query('reset role');}}finally{c.release();}
});
test('single-use linking, replay, expiry and re-link invalidation',async()=>{
  const code=await store.link();const input={userId:456,chatId:456,updateId:++seq,messageId:seq,timestamp:1793000000,link:code};
  const first=await store.ingest('42',input);assert.ok(first.id);
  assert.equal((await store.ingest('42',input)).id,first.id);
  assert.equal(await store.ingest('42',{...input,updateId:++seq,userId:789,chatId:789}),null);
  assert.equal(await store.ingest('42',{userId:123,chatId:123,updateId:++seq,messageId:seq,text:'old',timestamp:1793000000}),null);
  const stored=await one(admin,'select input from day_bot.jobs where id=$1',[first.id]);assert.ok(!JSON.stringify(stored).includes(code));
  const stale=await store.link();await admin.query("update day_bot.links set expires_at=now()-interval '1 second'");assert.equal(await store.ingest('42',{...input,updateId:++seq,link:stale}),null);
});
test('duplicate ingestion creates exactly one job and one quota reservation',async()=>{
  const input={userId:123,chatId:123,updateId:++seq,messageId:seq,text:'hi',timestamp:1793000000};
  const a=await store.ingest('42',input),b=await store.ingest('42',input);assert.equal(a.id,b.id);
  assert.equal((await one(admin,'select requests from day_bot.usage')).requests,1);
});
test('queue publication failure leaves a recoverable inbox and retry republishes it',async()=>{
  let tries=0;const service=new Service({store,providers:{},queue:{publish:async()=>{if(++tries===1)throw new Error('offline');}}});
  const input={userId:123,chatId:123,updateId:++seq,messageId:seq,text:'hi',timestamp:1793000000};
  await assert.rejects(service.ingest('42',input),/offline/);const second=await service.ingest('42',input);assert.ok(second.id);assert.equal(tries,2);assert.equal((await store.recover()).length,1);
});
test('only one chat job can run; expired lease cannot finish after another claim',async()=>{
  const j=await job();await assert.rejects(store.claim(j.id),{code:'busy'});
  await admin.query("update day_bot.connections set lease_until=now()-interval '1 second'");
  const next=await store.claim(j.id);assert.notEqual(next.token,j.token);
  await assert.rejects(store.finish(j,[{text:'stale'}]),{code:'lease_lost'});
  await store.finish(next,[{text:'current'}]);assert.equal((await one(admin,'select count(*)::int as n from day_bot.outbox')).n,1);
});
test('apply is atomic and repeated confirmation returns same receipt',async()=>{
  const id=await draft();await store.apply(await job('save'),id,true);assert.equal((await savedBlocks()).length,2);
  await store.apply(await job('save'),id,true);assert.equal((await savedBlocks()).length,2);assert.equal((await one(admin,'select count(*)::int as n from day_bot.receipts')).n,1);
});
test('both database and server write flags are enforced',async()=>{
  const id=await draft(),j=await job('save');await assert.rejects(store.apply(j,id,false),{code:'writes_disabled'});
  await admin.query('update day_bot.role_owners set writes_enabled=false');await assert.rejects(store.apply(j,id,true),{code:'writes_disabled'});assert.equal((await savedBlocks()).length,0);
});
test('stale preview rejects all patches and preserves the draft',async()=>{
  await seed('09:30');const id=await draft();await admin.query("update public.blocks set note='edited' where start_time='09:30'");
  const j=await job('save');await assert.rejects(store.apply(j,id,true),{code:'conflict'});const r=await savedBlocks();assert.equal(r.length,1);assert.equal(r[0].note,'edited');assert.equal((await one(admin,'select status from day_bot.drafts where id=$1',[id])).status,'pending');
});
test('xmin detects changed-then-restored content even without updated_at changes',async()=>{
  await seed();const id=await draft();await admin.query("update public.blocks set note='changed'");await admin.query("update public.blocks set note='original'");await assert.rejects(store.apply(await job('save'),id,true),{code:'conflict'});
});
test('concurrent insert into empty destination aborts instead of overwriting',async()=>{
  const id=await draft(),j=await job('save'),c=await admin.connect();
  try{await c.query('begin');await c.query("insert into public.blocks(user_id,date,start_time,category,note) values($1,$2,'09:30','work','concurrent')",[owner,day]);const saving=store.apply(j,id,true);await new Promise(resolve=>setTimeout(resolve,50));await c.query('commit');await assert.rejects(saving,{code:'conflict'});const r=await savedBlocks();assert.equal(r.length,1);assert.equal(r[0].note,'concurrent');}finally{await c.query('rollback');c.release();}
});
test('concurrent update observed after row lock wait rejects whole transaction',async()=>{
  await seed();const id=await draft(),j=await job('save'),c=await admin.connect();
  try{await c.query('begin');await c.query("update public.blocks set note='concurrent' where user_id=$1",[owner]);const saving=store.apply(j,id,true);await new Promise(resolve=>setTimeout(resolve,50));await c.query('commit');await assert.rejects(saving,{code:'conflict'});assert.equal((await savedBlocks())[0].note,'concurrent');}finally{await c.query('rollback');c.release();}
});
test('undo restores exact prior data, and repeated undo never writes twice',async()=>{
  await seed();const before=await savedBlocks(),id=await draft();await store.apply(await job('save'),id,true);await store.undo(await job('undo'),id,true);assert.deepEqual(await savedBlocks(),before);await store.undo(await job('undo'),id,true);assert.deepEqual(await savedBlocks(),before);
});
test('undo refuses later app changes atomically',async()=>{
  const id=await draft();await store.apply(await job('save'),id,true);await admin.query("update public.blocks set note='later' where start_time='09:30'");await assert.rejects(store.undo(await job('undo'),id,true),{code:'conflict'});assert.equal((await savedBlocks()).length,2);assert.equal((await one(admin,'select undone from day_bot.receipts where id=$1',[id])).undone,false);
});
test('superseded and expired draft buttons cannot save',async()=>{
  const old=await draft(),current=await draft();let j=await job('save');await assert.rejects(store.apply(j,old,true),{code:'stale'});await store.finish(j,[{text:'old rejected'}]);await admin.query("update day_bot.drafts set expires_at=now()-interval '1 second' where id=$1",[current]);await assert.rejects(store.apply(await job('save'),current,true),{code:'stale'});assert.equal((await savedBlocks()).length,0);
});
test('unlink blocks already-queued changes and draft access',async()=>{
  const id=await draft(),j=await job('save');await admin.query('update day_bot.connections set active=false');await assert.rejects(store.apply(j,id,true),{code:'lease_lost'});assert.equal((await savedBlocks()).length,0);
});
test('receipt and outbox survive a lost response; retry never reapplies',async()=>{
  const id=await draft(),j=await job('save');await store.apply(j,id,true);const receipt=await one(admin,'select * from day_bot.receipts where id=$1',[id]);assert.ok(receipt);assert.equal(await store.claim(j.id),null);
  const out=await store.claimReply();assert.ok(out);await admin.query("update day_bot.outbox set lease_until=now()-interval '1 second' where id=$1",[out.id]);const retried=await store.claimReply();assert.ok(retried);await store.delivered(retried,1000);assert.equal((await savedBlocks()).length,2);
});
test('retention removes content but preserves update deduplication',async()=>{
  const j=await job();await store.finish(j,[{text:'private text'}]);await admin.query("update day_bot.jobs set created_at=now()-interval '25 hours'");await admin.query("update day_bot.outbox set created_at=now()-interval '25 hours'");await store.recover();const retained=await one(admin,'select * from day_bot.jobs where id=$1',[j.id]);assert.deepEqual(retained.input,{});assert.equal(retained.transcript,null);assert.equal(retained.update_id,String(j.update_id));
});
test('text service uses real planning, durable correction, save and undo',async()=>{
  let targetStart='09:00',calls=0,messageId=1000;const queued=[];const replies=[];
  const service=new Service({store,writesEnabled:true,queue:{publish:async(id,stage)=>queued.push({id,stage})},providers:{acknowledge:async()=>{},send:async(chat,p)=>{replies.push(p);return {message_id:++messageId};},interpret:async()=>{calls++;return {...empty(),items:[{date:day,start:targetStart,end_date:day,end:'10:00',category:'work',activity:'Sample',note:''}]};}}});
  async function send(text,extra={}){const n=++seq,result=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,text,timestamp:1793000000,...extra});await service.process(result.id);await service.process(result.id);return result;}
  await send('work nine to ten');assert.equal((await savedBlocks()).length,0);let d=(await store.status({connection,generation:1})).pending;assert.ok(d);
  targetStart='09:30';await send('actually half past nine');const corrected=(await store.status({connection,generation:1})).pending;assert.notEqual(corrected.id,d.id);assert.equal(calls,2);
  await send('save');assert.equal((await savedBlocks()).length,0);
  await send('yes');assert.equal(calls,2);assert.equal((await store.status({connection,generation:1})).pending,undefined);
  await send('save');assert.equal((await savedBlocks()).length,1);assert.equal((await savedBlocks())[0].start_time,'09:30');await send('undo');assert.equal((await savedBlocks()).length,0);assert.equal(calls,2);assert.ok(replies.some(p=>p.text.startsWith('Done')));
});
test('voice stage checkpoints transcript and never retranscribes on retry',async()=>{
  let speech=0,model=0;const service=new Service({store,queue:{publish:async()=>{}},providers:{transcribe:async()=>{speech++;return 'my energy is four';},interpret:async()=>{model++;return {...empty(),actions:[{type:'checkin',date:day,energy:4}]};},send:async()=>({message_id:100}),acknowledge:async()=>{}}});
  const n=++seq,r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:1793000000,voice:{fileId:'sample',duration:10}});
  await service.process(r.id);assert.equal(speech,1);assert.equal(model,0);assert.equal((await one(admin,'select transcript from day_bot.jobs where id=$1',[r.id])).transcript,'my energy is four');await service.process(r.id);await service.process(r.id);assert.equal(speech,1);assert.equal(model,1);assert.equal((await savedBlocks()).length,0);
});
test('model failures release leases and preserve user input for bounded retry',async()=>{
  const service=new Service({store,queue:{publish:async()=>{}},providers:{interpret:async()=>{throw Object.assign(new Error('offline'),{code:'provider_network'});}}});
  const n=++seq,r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:1793000000,text:'work'});await assert.rejects(service.process(r.id),/offline/);const j=await one(admin,'select * from day_bot.jobs where id=$1',[r.id]);assert.equal(j.status,'pending');assert.equal(j.input.text,'work');assert.ok(await store.claim(r.id));
});
test('normal app role still reads and writes only its own diary',async()=>{
  await seed();await seed('09:00','other',other);const c=await admin.connect();
  try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await c.query('select * from blocks')).rowCount,1);assert.equal((await c.query("update blocks set note='app change' where user_id=$1",[other])).rowCount,1);assert.equal((await c.query('delete from blocks where user_id=$1',[owner])).rowCount,0);}finally{await c.query('reset role');await c.query("reset request.jwt.claim.sub");c.release();}
});
test('schema audit: all private tables use RLS, no public bot RPC or privilege bypass',async()=>{
  const tables=(await admin.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='day_bot' and relkind='r'")).rows;assert.ok(tables.length>=8);assert.ok(tables.every(t=>t.relrowsecurity));
  const role=await one(admin,"select rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname='day_telegram'");assert.ok(Object.values(role).every(v=>v===false));
  assert.equal((await one(admin,"select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='day_bot' and p.prosecdef")).n,0);
  assert.equal((await one(admin,"select count(*)::int as n from pg_policies where schemaname='day_bot' and cmd='ALL' and with_check is null")).n,0);
});
test('preview pages keep their order and concurrent senders wait for earlier delivery',async()=>{
  const j=await job();await store.finish(j,[{text:'first'},{text:'second'},{text:'third'}]);const first=await store.claimReply();assert.equal(first.payload.text,'first');assert.equal(await store.claimReply(),null);await store.delivered(first,100);const second=await store.claimReply();assert.equal(second.payload.text,'second');await store.delivered(second,101);assert.equal((await store.claimReply()).payload.text,'third');
});
test('ingress quota remains bounded and reserves capacity for explicit controls',async()=>{
  await admin.query('insert into day_bot.usage(owner,day,requests,audio_seconds) values($1,current_date,200,0)',[owner]);
  let first;
  for(let i=0;i<5;i++){const n=++seq,r=await store.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,text:'another request',timestamp:1793000000});first ||= r.id;assert.equal(r.id,first);}
  assert.equal((await one(admin,'select count(*)::int as n from day_bot.jobs')).n,1);
  const n=++seq,control=await store.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,text:'/status',timestamp:1793000000});assert.notEqual(control.id,first);
});
test('corrections must reply to the current preview, not an old draft',async()=>{
  const old=await draft();for(let i=0;i<2;i++){const r=await store.claimReply();await store.delivered(r,500+i);}const current=await draft();const j=await job('correction');assert.equal(await store.isCurrentReply(j,500,current),false);assert.equal(await store.isCurrentReply(j,500,old),true);
});
test('new voice input cannot overwrite a draft without explicit correction intent',async()=>{
  await draft();let modelCalls=0;
  const service=new Service({store,queue:{publish:async()=>{}},providers:{interpret:async()=>{modelCalls++;throw new Error('not expected');}}});
  const n=++seq,r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,text:'also do something else',timestamp:1793000000});await service.process(r.id);assert.equal(modelCalls,0);assert.ok(await store.pending({connection,generation:1}));
});
test('status bypasses a failed provider job without making the earlier request stale',async()=>{
  const first=await job('log work');await store.release(first,'provider_network');
  const status=await job('/status');assert.equal((await store.status(status)).waiting,1);await store.finish(status,[{text:'waiting'}]);
  const resumed=await store.claim(first.id);assert.equal(resumed.late,false);await store.finish(resumed,[{text:'done'}]);
});
test('cancel stops earlier unfinished input and fences its old worker',async()=>{
  const first=await job('log work');await store.release(first,'provider_network');
  const cancel=await job('/cancel');await store.cancel(cancel);
  assert.equal(await store.claim(first.id),null);assert.equal((await one(admin,'select error_code from day_bot.jobs where id=$1',[first.id])).error_code,'cancelled');await assert.rejects(store.finish(first,[{text:'late result'}]),{code:'lease_lost'});
});
test('provider cooldown is durable and recovery does not retry it early',async()=>{
  const j=await job('work');await store.release(j,'provider_limit',120);await assert.rejects(store.claim(j.id),e=>e.code==='deferred'&&e.retryAfter>100);assert.equal((await store.recover()).length,0);await admin.query("update day_bot.jobs set retry_at=now()-interval '1 second' where id=$1",[j.id]);assert.ok(await store.claim(j.id));
});
test('failed reply is immediately recoverable and does not replay a saved mutation',async()=>{
  const id=await draft();await store.apply(await job('save'),id,true);let tries=0;const service=new Service({store,queue:{publish:async()=>{}},providers:{send:async()=>{if(++tries===1)throw new Error('network');return {message_id:100+tries};}}});
  await assert.rejects(service.deliver(1),/network/);await service.deliver(1);assert.equal(tries,2);assert.equal((await savedBlocks()).length,2);assert.equal((await one(admin,'select count(*)::int as n from day_bot.receipts')).n,1);
});
test('voice checkpoint survives a failed next-stage enqueue',async()=>{
  let speech=0,model=0,publications=0;
  const service=new Service({store,queue:{publish:async()=>{if(++publications===2)throw new Error('queue unavailable');}},providers:{transcribe:async()=>{speech++;return 'energy four';},interpret:async()=>{model++;return {...empty(),actions:[{type:'checkin',date:day,energy:4}]};}}});
  const n=++seq,r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:1793000000,voice:{fileId:'sample',duration:1}});await assert.rejects(service.process(r.id),/queue unavailable/);await service.process(r.id);assert.equal(speech,1);assert.equal(model,1);assert.ok(await store.pending({connection,generation:1}));
});
test('pre-format-fix previews cannot save old representations',async()=>{
  const id=await draft();await admin.query("update day_bot.drafts set data=jsonb_set(data,'{review}',(data->'review')-'formatVersion') where id=$1",[id]);
  await assert.rejects(store.apply(await job('save'),id,true),{code:'stale'});assert.equal((await savedBlocks()).length,0);
});
test('check-ins deduplicate, pause persists and inactive connections receive none',async()=>{
  const now=Date.parse('2026-10-27T09:15:00Z');
  await store.checkins(now);await store.checkins(now);
  assert.equal((await one(admin,"select count(*)::int n from day_bot.outbox where payload->>'checkin'='true'")).n,1);
  const j=await job('/pause');await store.setReminders(j,false);
  await store.checkins(Date.parse('2026-10-27T14:15:00Z'));
  assert.equal((await one(admin,"select count(*)::int n from day_bot.outbox where payload->>'checkin'='true'")).n,1);
});
test('saved conversation survives saving, exposes exact receipts, and is isolated by generation',async()=>{
  const id=await draft();const j=await job('save');await store.apply(j,id,true);
  const next=await job('actually yesterday');const memory=await store.conversation(next);
  assert.ok(memory.some(x=>x.recent_changes?.some(r=>r.id===id)));
  assert.deepEqual(await store.conversation({...next,generation:2}),[{focus:next.agentContext || {}},{recent_changes:[],changes_limited:false}]);
});

async function transferAs(who,expected){
  const c=await admin.connect();
  try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);await c.query('select public.move_day_slots_previous_day($1,$2)',[day,expected]);}
  finally{await c.query('reset role');await c.query('reset request.jwt.claim.sub');c.release();}
}
test('web transfer moves exact selected slots atomically with names and notes intact',async()=>{
  await seed('09:00','my note');await seed('09:30','leave here');
  await transferAs(owner,{'09:00':{category:'work',note:'my note',sub:'Sample'}});
  const blocks=await savedBlocks();assert.equal(blocks.find(b=>b.start_time==='09:00').date,'2026-10-25');assert.equal(blocks.find(b=>b.start_time==='09:00').note,'my note');assert.equal(blocks.find(b=>b.start_time==='09:30').date,day);
});
test('web transfer rejects occupied destinations, stale selections and other owners',async()=>{
  await seed();const expected={'09:00':{category:'work',note:'original',sub:'Sample'}};
  await assert.rejects(transferAs(other,expected),/changed/);
  await assert.rejects(transferAs(owner,{'09:00':{category:'work',note:'stale',sub:'Sample'}}),/changed/);
  await admin.query("insert into public.blocks(user_id,date,start_time,category) values($1,'2026-10-25','09:00','sleep')",[owner]);
  await assert.rejects(transferAs(owner,expected),/already has entries/);
  assert.equal((await savedBlocks()).filter(b=>b.date===day).length,1);
});

test('overwrite transfers replace only reviewed destinations and roll back on stale source',async()=>{
  await seed();await admin.query("insert into public.blocks(user_id,date,start_time,category,note,subcategory) values($1,'2026-10-25','09:00','sleep','','')",[owner]);
  const c=await admin.connect();const expected={'09:00':{category:'work',note:'original',sub:'Sample'}},dest={'09:00':{category:'sleep',note:'',sub:''}};
  try{await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await assert.rejects(c.query('select public.overwrite_day_slots_previous_day($1,$2,$3)',[day,expected,{'09:00':null}]),/Yesterday changed/);
    await assert.rejects(c.query('select public.overwrite_day_slots_previous_day($1,$2,$3)',[day,{'09:00':{...expected['09:00'],note:'stale'}},dest]),/changed/);
    assert.equal((await savedBlocks()).length,2);
    await c.query('select public.overwrite_day_slots_previous_day($1,$2,$3)',[day,expected,dest]);
    const blocks=await savedBlocks();assert.equal(blocks.length,1);assert.equal(blocks[0].date,'2026-10-25');assert.equal(blocks[0].note,'original');
  }finally{await c.query('reset role');await c.query('reset request.jwt.claim.sub');c.release();}
});
test('Telegram status uses fresh database rows even after remembered entries moved',async()=>{
  await seed('09:00','moved off today');
  const service=new Service({store,writesEnabled:true,queue:{publish:async()=>{}},providers:{interpret:async()=>{throw Error('Status must not use model memory');}}});
  const n=++seq;const result=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:Math.floor(Date.parse('2026-10-27T20:26:00Z')/1000),text:'What is the status of my day so far? What have I filled in?'});
  await service.process(result.id);
  const answer=await one(admin,"select payload->>'text' as text from day_bot.outbox where dedupe_key=$1",[result.id+':0']);
  assert.equal(answer.text,'No activities are saved for Tuesday 27 October.');
  assert.equal((await savedBlocks()).length,1);
});
test('destructive tool waits for confirmation, then saves and undo restores data',async()=>{
  await seed();const n=++seq;
  const service=new Service({store,writesEnabled:true,queue:{publish:async()=>{}},providers:{interpret:async()=>({...empty(),actions:[{type:'activity_delete',target:'activity:'+day+':09:00'}]})}});
  const r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:1793000000,text:'delete the work entry'});await service.process(r.id);
  assert.equal((await savedBlocks()).length,1);assert.ok((await store.status({connection,generation:1})).pending.data.review.requiresConfirmation);
  const yes=++seq,res=await service.ingest('42',{userId:123,chatId:123,updateId:yes,messageId:yes,timestamp:1793000000,text:'yes'});await service.process(res.id);assert.equal((await savedBlocks()).length,0);
  const undo=await job('undo');await store.undo(undo,undefined,true);assert.equal((await savedBlocks()).length,1);
});
test('saved receipts are labelled stale after a web change',async()=>{
 const id=await draft();const j=await job('save');await store.apply(j,id,true);
 await admin.query("update public.blocks set note='web edit' where user_id=$1",[owner]);
 const next=await job('what changed');const memory=await store.conversation(next);assert.equal(memory.at(-1).recent_changes[0].state,'changed_since');
});
test('persistent focus is reset by forget and relinking',async()=>{
 const j=await job();j.nextContext={focusDate:day,expiresAt:'2099-01-01T00:00:00Z'};await store.finish(j,[{text:'ok'}]);
 const next=await job('/forget');assert.equal(next.agentContext.focusDate,day);await store.forget(next);const conn=await one(admin,'select agent_context from day_bot.connections where id=$1',[connection]);assert.equal(conn.agent_context.focusDate,undefined);assert.ok(conn.agent_context.memorySince);
});
test('expired proactive messages cannot block normal replies',async()=>{
 const j=await job();await store.finish(j,[{text:'old prompt',checkin:true,validUntil:1},{text:'current response'}]);const reply=await store.claimReply();assert.equal(reply.payload.text,'current response');
});

test('agent history is published atomically and reflects undo for the web view',async()=>{
 const id=await draft();await store.apply(await job('save'),id,true);
 let history=await one(admin,"select note from public.blocks where user_id=$1 and start_time='__agent_history__'",[owner]);assert.equal(JSON.parse(history.note)[0].id,id);
 await store.undo(await job('undo'),id,true);history=await one(admin,"select note from public.blocks where user_id=$1 and start_time='__agent_history__'",[owner]);assert.equal(JSON.parse(history.note)[0].undone,true);
});
test('check-in buttons persist snooze and pace without changing diary activities',async()=>{
 const j=await job();await store.proactiveControl(j,'snooze');let record=await one(admin,"select note from public.blocks where start_time='__agent_preferences__'");assert.ok(Date.parse(JSON.parse(record.note).snooze_until)>Date.now());
 const less=await job();await store.proactiveControl(less,'less');record=await one(admin,"select note from public.blocks where start_time='__agent_preferences__'");assert.equal(JSON.parse(record.note).interval_hours,4);
 const pause=await job();await store.proactiveControl(pause,'pause');assert.equal((await one(admin,'select reminders_enabled from day_bot.connections where id=$1',[connection])).reminders_enabled,false);
});
test('proactive kill switch stops production of reminders and queued proactive delivery',async()=>{
 const disabled=new Store(scoped,{proactiveEnabled:false});const j=await job();await disabled.finish(j,[{text:'prompt',checkin:true,validUntil:9999999999},{text:'normal'}]);await disabled.checkins(Date.parse('2026-10-27T09:00Z'));const reply=await disabled.claimReply();assert.equal(reply.payload.text,'normal');
});
test('an ungrounded model answer to a factual query is refused',async()=>{
 const service=new Service({store,writesEnabled:true,queue:{publish:async()=>{}},providers:{interpret:async()=>({...empty(),reply:'You did a workout.'})}});const n=++seq;const r=await service.ingest('42',{userId:123,chatId:123,updateId:n,messageId:n,timestamp:1793000000,text:'What gym workouts are saved?'});await service.process(r.id);const reply=await one(admin,"select payload->>'text' as text from day_bot.outbox where dedupe_key=$1",[r.id+':0']);assert.match(reply.text,/couldn’t verify/);
});
test('natural resume preferences override legacy pause without corrupting undo semantics',async()=>{
 await admin.query('update day_bot.connections set reminders_enabled=false where id=$1',[connection]);
 await admin.query("insert into public.blocks(user_id,date,start_time,category,note) values($1,'2000-01-01','__agent_preferences__','agent_preferences','{\"enabled\":true}')",[owner]);
 const j=await job();await store.finish(j,[{text:'check-in',checkin:true,validUntil:9999999999}]);assert.equal((await store.claimReply()).payload.text,'check-in');
 const pause=await job('/pause');await store.setReminders(pause,false);const preferences=await one(admin,"select note from public.blocks where start_time='__agent_preferences__'");assert.equal(JSON.parse(preferences.note).enabled,false);
});
