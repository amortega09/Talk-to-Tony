'use strict';
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {Pool}=require('pg');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {UserError,control}=require('./domain.cjs');
const A=require('../../voice-actions');
const hash=s=>createHash('sha256').update(s).digest('hex');
const cleanId=id=>String(id).replaceAll('-','');
const callback=(verb,id)=>`${verb}:${cleanId(id)}`;
const button=(text,verb,id)=>({text,callback_data:callback(verb,id)});
const rows=async(c,q,p=[]) => (await c.query(q,p)).rows;
const one=async(c,q,p=[]) => (await rows(c,q,p))[0];
function poolFromEnv(env=process.env) {
  if(!env.TELEGRAM_DATABASE_URL)throw new Error('Missing database configuration');
  const url=new URL(env.TELEGRAM_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol) || !/^day_telegram(?:\.|$)/.test(decodeURIComponent(url.username)))throw new Error('Use the scoped day_telegram database role');
  // TLS cannot be disabled via query parameters on hosted connections.
  for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(k);
  const ssl={rejectUnauthorized:true};
  if(url.hostname.endsWith('.pooler.supabase.com') || url.hostname.endsWith('.supabase.co'))ssl.ca=readFileSync(join(__dirname,'supabase-ca.crt'),'utf8');
  return new Pool({connectionString:url.toString(),ssl,max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,statement_timeout:10000,application_name:'day-telegram'});
}
class Store {
  constructor(pool){this.pool=pool;}
  async tx(fn) {
    const c=await this.pool.connect();
    try {await c.query('begin');const result=await fn(c);await c.query('commit');return result;}
    catch(e){await c.query('rollback');throw e;}finally{c.release();}
  }
  async owner(c=this.pool) {
    const o=await one(c,'select owner,writes_enabled from day_bot.role_owners where role_name=current_user');
    if(!o)throw new Error('Bot owner is not configured');return o;
  }
  async link() {
    const token=randomBytes(32).toString('base64url');
    await this.tx(async c=>{const {owner}=await this.owner(c);await c.query('delete from day_bot.links where owner=$1',[owner]);await c.query("insert into day_bot.links(hash,owner,expires_at) values($1,$2,now()+interval '10 minutes')",[hash(token),owner]);});
    return token;
  }
  async ingest(botId,input) {
    return this.tx(async c=>{
      const existing=await one(c,'select id,status from day_bot.jobs where bot_id=$1 and update_id=$2',[botId,input.updateId]);
      if(existing)return existing.status==='done'||existing.status==='failed'?{id:existing.id,complete:true}:{id:existing.id};
      let conn;
      if(input.link) {
        const link=await one(c,'select * from day_bot.links where hash=$1 and used_at is null and expires_at>now() for update',[hash(input.link)]);
        if(!link)return null;
        await c.query('update day_bot.links set used_at=now() where hash=$1',[hash(input.link)]);
        conn=await one(c,`insert into day_bot.connections(id,owner,telegram_user,chat_id) values($1,$2,$3,$4)
          on conflict(owner) do update set telegram_user=excluded.telegram_user,chat_id=excluded.chat_id,active=true,generation=day_bot.connections.generation+1,lease_job=null,lease_token=null,lease_until=null,last_message_id=0 returning *`,[randomUUID(),link.owner,input.userId,input.chatId]);
        await c.query("update day_bot.drafts set status='cancelled' where connection=$1 and status='pending'",[conn.id]);
        await c.query("update day_bot.jobs set status='failed',error_code='relinked',input='{}',transcript=null where connection=$1 and status in ('pending','processing')",[conn.id]);
        input={...input,link:undefined,text:'/help'};
      } else conn=await one(c,'select * from day_bot.connections where telegram_user=$1 and chat_id=$2 and active=true for update',[input.userId,input.chatId]);
      if(!conn)return null;
      // Bound storage before paid/provider work. Duplicate updates don't consume this budget.
      const verb=input.callback?.verb || control(input.text || '',{today:'2026-01-01'})?.control;
      input={...input,control:verb || null};
      const isControl=!!verb;
      const quota=await one(c,`insert into day_bot.usage(owner,day,requests,audio_seconds) values($1,current_date,1,$2)
        on conflict(owner,day) do update set requests=day_bot.usage.requests+1,audio_seconds=day_bot.usage.audio_seconds+excluded.audio_seconds
        where day_bot.usage.requests<$3 and day_bot.usage.audio_seconds+excluded.audio_seconds<=1800 returning requests`,[conn.owner,input.voice?.duration || 0,isControl?250:200]);
      if(!quota){
        const limited=await one(c,"select id,status from day_bot.jobs where connection=$1 and created_at>=current_date and input->>'text'='/limit' order by created_at limit 1",[conn.id]);
        if(limited)return {id:limited.id,complete:['done','failed'].includes(limited.status)};
        input={...input,text:'/limit',voice:undefined,callback:undefined};
      }
      const id=randomUUID();
      await c.query('insert into day_bot.jobs(id,owner,connection,generation,bot_id,update_id,message_id,input) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,conn.owner,conn.id,conn.generation,botId,input.updateId,input.messageId,JSON.stringify(input)]);
      return {id};
    });
  }
  async claim(id) {
    return this.tx(async c=>{
      const job=await one(c,'select * from day_bot.jobs where id=$1',[id]);
      if(!job || ['done','failed'].includes(job.status))return null;
      if(new Date(job.retry_at).getTime()>Date.now())throw Object.assign(new Error('Retry scheduled'),{code:'deferred',retryAfter:Math.ceil((new Date(job.retry_at)-Date.now())/1000)});
      const conn=await one(c,'select *,lease_until>now() as leased from day_bot.connections where id=$1 for update',[job.connection]);
      if(!conn.active || conn.generation!==job.generation){await c.query("update day_bot.jobs set status='failed',error_code='revoked' where id=$1",[id]);return null;}
      if(conn.leased)throw Object.assign(new Error('Chat is busy'),{code:'busy'});
      const first=await one(c,"select id from day_bot.jobs where connection=$1 and status in ('pending','processing') order by case when input->>'control' in ('status','help','cancel','unlink') then 0 else 1 end,update_id,created_at limit 1",[conn.id]);
      if(first?.id!==id)throw Object.assign(new Error('Earlier message pending'),{code:'busy'});
      const token=randomUUID();
      await c.query("update day_bot.connections set lease_job=$2,lease_token=$3,lease_until=now()+interval '90 seconds' where id=$1",[conn.id,id,token]);
      await c.query("update day_bot.jobs set status='processing',attempts=attempts+1 where id=$1",[id]);
      return {...job,token,attempts:job.attempts+1,chatId:conn.chat_id,late:Number(job.message_id)<Number(conn.last_message_id)};
    });
  }
  async guard(c,job,{allowRevoked=false}={}) {
    const conn=await one(c,'select *,lease_until>now() as leased from day_bot.connections where id=$1 for update',[job.connection]);
    if(!conn || conn.lease_token!==job.token || conn.lease_job!==job.id || !conn.leased || conn.generation!==job.generation || (!allowRevoked && !conn.active))throw Object.assign(new Error('Expired job lease'),{code:'lease_lost'});
    return conn;
  }
  async checkpoint(job,transcript) {await this.tx(async c=>{await this.guard(c,job);await c.query('update day_bot.jobs set transcript=$2 where id=$1',[job.id,transcript]);});}
  async release(job,code,retryAfter=0) {
    await this.tx(async c=>{await this.guard(c,job);await c.query("update day_bot.jobs set status='pending',error_code=$2,retry_at=now()+$3*interval '1 second' where id=$1",[job.id,code,Math.min(86400,Math.max(0,retryAfter))]);await c.query('update day_bot.connections set lease_until=null where id=$1',[job.connection]);});
  }
  async pending(job,c=this.pool) {
    return one(c,"select * from day_bot.drafts where connection=$1 and generation=$2 and status='pending' and expires_at>now()",[job.connection,job.generation]);
  }
  async isCurrentReply(job,messageId,draftId) {
    return !!await one(this.pool,"select id from day_bot.outbox where connection=$1 and generation=$2 and message_id=$3 and payload->>'draftId'=$4",[job.connection,job.generation,messageId,draftId]);
  }
  async readRows(job) {
    // Bounded complete retrieval is necessary for linked objectives. Only selected
    // context is sent to the model; fail closed if this bound cannot cover history.
    return this.tx(async c=>{
      await this.guard(c,job);
      const result=await rows(c,"select date::text,start_time,category,note,subcategory,id::text || ':' || xmin::text as version from public.blocks where user_id=$1 order by date,start_time limit 10001",[job.owner]);
      if(result.length>10000)throw new UserError('Your history exceeds this pilot’s retrieval limit. Use the app for this request.','history_limit');
      return result;
    });
  }
  async enqueueReply(c,job,key,payload) {
    if(payload.text.length>3600)throw new Error('Reply must be paginated');
    await c.query('insert into day_bot.outbox(id,owner,connection,generation,dedupe_key,payload) values($1,$2,$3,$4,$5,$6) on conflict(dedupe_key) do nothing',[randomUUID(),job.owner,job.connection,job.generation,key,JSON.stringify(payload)]);
  }
  async finishIn(c,job,payloads) {
    for(let i=0;i<payloads.length;i++)await this.enqueueReply(c,job,`${job.id}:${i}`,payloads[i]);
    await c.query("update day_bot.jobs set status='done' where id=$1",[job.id]);
    await c.query('update day_bot.connections set lease_until=null,lease_job=null,lease_token=null,last_message_id=case when $3 then greatest(last_message_id,$2) else last_message_id end where id=$1',[job.connection,job.message_id,!job.input.control && !job.input.callback]);
  }
  async finish(job,payloads) {await this.tx(async c=>{await this.guard(c,job);await this.finishIn(c,job,payloads);});}
  async saveDraft(job,data,render,autoSave=false) {
    return this.tx(async c=>{
      await this.guard(c,job);
      await c.query("update day_bot.drafts set status='superseded' where connection=$1 and status='pending'",[job.connection]);
      const id=randomUUID();
      await c.query('insert into day_bot.drafts(id,owner,connection,generation,data) values($1,$2,$3,$4,$5)',[id,job.owner,job.connection,job.generation,JSON.stringify(data)]);
      if(autoSave && data.review.patches.length && !data.review.questions.length){
        if(!(await this.owner(c)).writes_enabled)throw new UserError('Saving is currently disabled.');
        const patches=await this.applyPatches(c,job.owner,data.review.patches);
        await c.query('insert into day_bot.receipts(id,owner,connection,patches) values($1,$2,$3,$4)',[id,job.owner,job.connection,JSON.stringify(patches)]);
        await c.query("update day_bot.drafts set status='saved' where id=$1",[id]);
        await this.finishIn(c,job,[this.savedReply(id,data)]);
      }else await this.finishIn(c,job,render(id,data));return id;
    });
  }
  savedReply(id,data){
    const summary=data.review.summaries.map(line=>line.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) → (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}): (.*)$/,(_,date,start,endDate,end,name)=>{
      const label=d=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
      return `${name.replace(/ \([a-z]+\)$/,'')} · ${label(date)}, ${start}–${date===endDate?'':label(endDate)+' '}${end}`;
    })).join(' · ');
    return {text:('Done — '+(summary || 'updated your diary.')).slice(0,3300),reply_markup:{inline_keyboard:[[button('Change','change',id),button('Undo','undo',id)]]}};
  }
  async conversation(job){
    const recent=await rows(this.pool,`select j.input,j.transcript,
      (select string_agg(o.payload->>'text',E'\\n' order by o.ordinal) from day_bot.outbox o where o.dedupe_key like j.id::text || ':%') as answer
      from day_bot.jobs j where j.connection=$1 and j.generation=$2 and j.status='done' and j.created_at>now()-interval '24 hours'
      order by j.update_id desc limit 8`,[job.connection,job.generation]);
    const changes=await rows(this.pool,`select r.id,r.patches,r.undone from day_bot.receipts r join day_bot.drafts d on d.id=r.id where r.connection=$1 and d.generation=$2 and r.created_at>now()-interval '24 hours' order by r.created_at desc limit 8`,[job.connection,job.generation]);
    let budget=10000;
    const boundedChanges=changes.filter(change=>{budget-=JSON.stringify(change).length;return budget>=0;});
    const prompt=await one(this.pool,"select payload->>'text' as text from day_bot.outbox where connection=$1 and generation=$2 and payload->>'checkin'='true' and created_at>now()-interval '12 hours' order by ordinal desc limit 1",[job.connection,job.generation]);
    return [...(prompt?[{assistant:prompt.text}]:[]),...recent.reverse().map(r=>({user:(r.transcript || r.input.text || (r.input.callback?.verb==='change'?'Change saved change '+r.input.callback.id:'')).slice(0,2000),assistant:(r.answer || '').slice(0,2000)})),{recent_changes:boundedChanges,changes_limited:boundedChanges.length<changes.length}];
  }
  async change(job,id){
    const d=await one(this.pool,"select * from day_bot.drafts where id=$1 and connection=$2 and generation=$3 and expires_at>now()",[id,job.connection,job.generation]);
    if(!d)throw new UserError('That change is too old. Tell me the day and activity you want to change.');
    await this.finish(job,[{text:'What would you like to change? Mention the new day, time or activity.'}]);
  }
  async cancel(job,id) {
    await this.tx(async c=>{
      await this.guard(c,job);const d=await this.pending(job,c);
      if(id && d?.id!==id)throw new UserError('That preview is no longer current. Use /status.','stale');
      if(d)await c.query("update day_bot.drafts set status='cancelled' where id=$1",[d.id]);
      await c.query("update day_bot.jobs set status='failed',error_code='cancelled',input='{}',transcript=null where connection=$1 and id<>$2 and update_id<$3 and status in ('pending','processing')",[job.connection,job.id,job.update_id]);
      await this.finishIn(c,job,[{text:'Pending draft and earlier unfinished requests cancelled. Nothing new was saved.'}]);
    });
  }
  async unlink(job) {
    await this.tx(async c=>{await this.guard(c,job);await c.query('update day_bot.connections set active=false where id=$1',[job.connection]);await c.query("update day_bot.drafts set status='cancelled' where connection=$1 and status='pending'",[job.connection]);await this.finishIn(c,job,[{text:'Telegram disconnected. Reconnect using a new link code.',unlinked:true}]);});
  }
  async applyPatches(c,owner,patches) {
    const saved=[];
    if(!Array.isArray(patches)||patches.length===0||patches.length>500)throw new UserError('This draft has no valid changes.');
    const keys=new Set();
    for(const p of [...patches].sort((a,b)=>`${a.date}/${a.slot}`.localeCompare(`${b.date}/${b.slot}`))) {
      const key=`${p.date}/${p.slot}`;
      if(keys.has(key))throw new Error('Duplicate patch'); keys.add(key);
      const current=await one(c,"select category,note,subcategory,id::text || ':' || xmin::text as version from public.blocks where user_id=$1 and date=$2 and start_time=$3 for update",[owner,p.date,p.slot]);
      if(!A.same(current,p.before) || (p.version && p.version!==current?.version))throw new UserError('An affected record changed. Cancel and make a fresh draft; nothing was saved.','conflict');
      let after;
      if(p.after) {
        const v=[owner,p.date,p.slot,p.after.category,p.after.note || '',p.after.sub || ''];
        try {
          after=current?await one(c,"update public.blocks set category=$4,note=$5,subcategory=$6,updated_at=clock_timestamp() where user_id=$1 and date=$2 and start_time=$3 returning id::text || ':' || xmin::text as version",v)
            :await one(c,"insert into public.blocks(user_id,date,start_time,category,note,subcategory) values($1,$2,$3,$4,$5,$6) returning id::text || ':' || xmin::text as version",v);
        } catch(e){if(e.code==='23505')throw new UserError('A destination changed. Make a fresh draft; nothing was saved.','conflict');throw e;}
      } else await c.query('delete from public.blocks where user_id=$1 and date=$2 and start_time=$3',[owner,p.date,p.slot]);
      saved.push({...p,afterVersion:after?.version || null});
    }
    return saved;
  }
  async apply(job,id,writesEnabled) {
    await this.tx(async c=>{
      await this.guard(c,job);
      if(!writesEnabled || !(await this.owner(c)).writes_enabled)throw new UserError('Preview mode: saving is not enabled yet.','writes_disabled');
      const existing=id && await one(c,'select * from day_bot.receipts where id=$1 and connection=$2',[id,job.connection]);
      if(existing){await this.finishIn(c,job,[{text:existing.undone?'This change was already undone.':'This change was already saved.'}]);return;}
      const d=await this.pending(job,c);
      if(!d || (id && d.id!==id))throw new UserError('That preview expired or was replaced. Use /status.','stale');
      if(d.data.review.questions.length)throw new UserError('Answer the clarification before saving.');
      if(d.data.review.formatVersion!==1)throw new UserError('This preview predates the activity-format update. /cancel and send the request again; nothing was saved.','stale');
      const patches=await this.applyPatches(c,job.owner,d.data.review.patches);
      await c.query('insert into day_bot.receipts(id,owner,connection,patches) values($1,$2,$3,$4)',[d.id,job.owner,job.connection,JSON.stringify(patches)]);
      await c.query("update day_bot.drafts set status='saved' where id=$1",[d.id]);
      await this.finishIn(c,job,[this.savedReply(d.id,d.data)]);
    });
  }
  async undo(job,id,writesEnabled) {
    await this.tx(async c=>{
      await this.guard(c,job);
      if(!writesEnabled || !(await this.owner(c)).writes_enabled)throw new UserError('Saving and undo are disabled.','writes_disabled');
      const r=id?await one(c,'select * from day_bot.receipts where id=$1 and connection=$2 for update',[id,job.connection]):await one(c,'select * from day_bot.receipts where connection=$1 order by created_at desc limit 1 for update',[job.connection]);
      if(!r || Date.now()-new Date(r.created_at).getTime()>7*86400000)throw new UserError('There is no recent bot change available to undo.');
      if(!r.undone){await this.applyPatches(c,job.owner,r.patches.map(p=>({...p,before:p.after,after:p.before,version:p.afterVersion})));await c.query('update day_bot.receipts set undone=true where id=$1',[r.id]);}
      await this.finishIn(c,job,[{text:r.undone?'This change was already undone.':'Undone. Refresh Day to see the restored records.'}]);
    });
  }
  async status(job) {
    const pending=await this.pending(job);
    const receipt=await one(this.pool,'select id,undone,created_at from day_bot.receipts where connection=$1 order by created_at desc limit 1',[job.connection]);
    const waiting=await one(this.pool,"select count(*)::int as count from day_bot.jobs where connection=$1 and status in ('pending','processing') and id<>$2",[job.connection,job.id || '00000000-0000-0000-0000-000000000000']);
    return {pending,receipt,waiting:waiting.count};
  }
  async nextPending(id) {
    return one(this.pool,"select j.id from day_bot.jobs j join day_bot.connections c on c.id=j.connection where j.connection=(select connection from day_bot.jobs where id=$1) and c.active and c.generation=j.generation and j.status in ('pending','processing') and j.retry_at<=now() order by case when j.input->>'control' in ('status','help','cancel','unlink') then 0 else 1 end,j.update_id limit 1",[id]);
  }
  async claimReply() {
    return this.tx(async c=>{
      const r=await one(c,`select o.*,c.chat_id from day_bot.outbox o join day_bot.connections c on c.id=o.connection
        where o.delivered_at is null and (o.lease_until is null or o.lease_until<now()) and o.attempts<8
        and (o.payload->>'checkin' is distinct from 'true' or (c.reminders_enabled and (o.payload->>'validUntil')::bigint>extract(epoch from now()))) and o.generation=c.generation and (c.active or o.payload->>'unlinked'='true') and o.created_at>now()-interval '24 hours'
        and not exists (select 1 from day_bot.outbox earlier where earlier.connection=o.connection and earlier.generation=o.generation and earlier.ordinal<o.ordinal and earlier.delivered_at is null and earlier.attempts<8 and earlier.created_at>now()-interval '24 hours')
        order by o.ordinal for update of o skip locked limit 1`);
      if(!r)return null;
      const token=randomUUID();await c.query("update day_bot.outbox set lease_token=$2,lease_until=now()+interval '30 seconds',attempts=attempts+1 where id=$1",[r.id,token]);return {...r,token};
    });
  }
  async delivered(reply,messageId) {await this.pool.query('update day_bot.outbox set delivered_at=now(),message_id=$3,lease_until=null where id=$1 and lease_token=$2',[reply.id,reply.token,messageId]);}
  async retryReply(reply,delay=0) {await this.pool.query("update day_bot.outbox set lease_until=now()+$3*interval '1 second' where id=$1 and lease_token=$2",[reply.id,reply.token,Math.min(86400,Math.max(0,delay))]);}
  async setReminders(job,enabled){
    await this.tx(async c=>{await this.guard(c,job);await c.query('update day_bot.connections set reminders_enabled=$2 where id=$1',[job.connection,enabled]);await this.finishIn(c,job,[{text:enabled?'Check-ins are back on — 9am, 2pm and 8pm London time.':'Check-ins paused. Send /resume whenever you want them back.'}]);});
  }
  async checkins(now=Date.now()){
    const connections=await rows(this.pool,'select * from day_bot.connections where active and reminders_enabled');
    for(const connection of connections){
      const job={connection:connection.id,owner:connection.owner,generation:connection.generation};
      const diary=await rows(this.pool,"select date::text,start_time,category,note,subcategory from public.blocks where user_id=$1 and date=$2",[job.owner,require('./domain.cjs').anchor(Math.floor(now/1000)).today]);
      const message=require('./checkins.cjs').checkin(diary,now);
      if(message)await this.tx(async c=>{
        const current=await one(c,'select active,reminders_enabled from day_bot.connections where id=$1 for update',[connection.id]);
        if(current?.active && current.reminders_enabled)await this.enqueueReply(c,job,`checkin:${connection.id}:${connection.generation}:${message.key}`,{text:message.text,checkin:true,validUntil:Math.floor(now/3600000)*3600+3600});
      });
    }
  }
  async recover() {
    // Keep idempotency keys; remove sensitive payloads after their useful lifetime.
    await this.pool.query("update day_bot.jobs set input='{}',transcript=null,status=case when status in ('pending','processing') then 'failed' else status end,error_code=case when status in ('pending','processing') then 'expired' else error_code end where created_at<now()-interval '24 hours' and input<>'{}'");
    await this.pool.query("update day_bot.drafts set status=case when status='pending' then 'expired' else status end,data='{}' where expires_at<now() and data<>'{}'");
    await this.pool.query("update day_bot.receipts set patches='[]' where created_at<now()-interval '7 days' and patches<>'[]'");
    await this.pool.query("update day_bot.outbox set payload='{}',delivered_at=coalesce(delivered_at,now()) where created_at<now()-interval '24 hours' and payload<>'{}'");
    await this.pool.query("delete from day_bot.links where expires_at<now()");
    return rows(this.pool,"select j.id from day_bot.jobs j join day_bot.connections c on c.id=j.connection where j.status in ('pending','processing') and j.retry_at<=now() and c.active and j.generation=c.generation and (c.lease_until is null or c.lease_until<now()) order by j.update_id,j.created_at limit 20");
  }
}
module.exports={Store,poolFromEnv,hash,callback,button,one,rows};
