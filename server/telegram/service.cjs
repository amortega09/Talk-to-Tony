'use strict';
const {UserError,anchor,context,plan,control}=require('./domain.cjs');
const {button}=require('./store.cjs');
const {query,summarize,gaps}=require('./day-summary.cjs');
const help='Tell me about your day by text or voice. I’ll save clear requests and ask if anything is unclear. You can correct me in chat or tap Undo. /today · /plan · /memory · /priorities · /settings · /status · /history · /cancel · /undo · /pause · /resume · /forget · /unlink\nVoice is transcribed by Groq; text and relevant diary context go to Ollama.';
function parseUpdate(u,now=Date.now()) {
  if(!u || !Number.isSafeInteger(u.update_id)||u.update_id<0)return null;
  const cb=u.callback_query,m=cb?.message || u.message,from=cb?.from || m?.from;
  if(!m || !from || from.is_bot || m.chat?.type!=='private' || !Number.isSafeInteger(from.id)||from.id<=0 || m.chat.id!==from.id || !Number.isSafeInteger(m.message_id))return null;
  if(m.forward_origin || m.via_bot)return null;
  if(cb){
    const match=/^(save|cancel|undo|change|pause|snooze|less|mdone|msnooze|mstop|mforget|medit|mwhy|mnex|cnex):([a-f0-9]{32})(?::([0-9a-z]{1,8}))?$/.exec(cb.data || '');
    if(!match || typeof cb.id!=='string'||cb.id.length>200)return null;
    const h=match[2],id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    return {updateId:u.update_id,userId:from.id,chatId:m.chat.id,messageId:m.message_id,callback:{verb:match[1],id,queryId:cb.id,revision:match[3]?parseInt(match[3],36):undefined},timestamp:Math.floor(now/1000)};
  }
  if(!Number.isSafeInteger(m.date) || Math.abs(now/1000-m.date)>86400)return null;
  const base={updateId:u.update_id,userId:from.id,chatId:m.chat.id,messageId:m.message_id,timestamp:m.date,replyTo:m.reply_to_message?.message_id || null};
  if(m.voice){const v=m.voice;if(typeof v.file_id!=='string'||v.file_id.length>512 || !Number.isInteger(v.duration)||v.duration<1||v.duration>120||v.file_size>10000000)return {...base,text:'/audio-limit'};return {...base,voice:{fileId:v.file_id,duration:v.duration}};}
  if(typeof m.text!=='string'||!m.text.trim()||m.text.length>12000)return null;
  const link=/^\/start ([A-Za-z0-9_-]{43})$/.exec(m.text.trim());
  return {...base,...(link?{link:link[1]}:{text:m.text.trim()})};
}
function chunks(lines) {
  const messages=[];let current='';
  for(const line of lines)for(let i=0;i<line.length || i===0;i+=3200){const part=line.slice(i,i+3200);if(current.length+part.length+1>3400){messages.push({text:current});current='';}current+=(current?'\n':'')+part;}
  if(current)messages.push({text:current});return messages;
}
function preview(id,data) {
  const {draft,review,transcript}=data;
  const lines=[...review.summaries,...review.answers,...review.navigation.map(a=>`Open ${a.screen}${a.date?' for '+a.date:''} in Day.`)];
  if(review.questions.length)lines.push(review.questions[0]);
  else if(!review.patches.length && !review.answers.length && !review.navigation.length)lines.push(draft.reply || 'No supported changes found.');
  const messages=chunks(lines).map(m=>({...m,draftId:id}));
  const buttons=review.patches.length && !review.questions.length?[button('Save','save',id),button('Change','change',id),button('Cancel','cancel',id)]:[button('Cancel','cancel',id)];
  if(!review.questions.length)messages.push({text:'Does this look right?',draftId:id,reply_markup:{inline_keyboard:[buttons]}});
  return messages;
}
class Service {
  constructor({store,providers,queue,writesEnabled=false,extendedTools=true}){Object.assign(this,{store,providers,queue,writesEnabled,extendedTools});}
  async ingest(botId,input) {
    const result=await this.store.ingest(botId,input);
    if(result && !result.complete)await this.queue.publish(result.id);
    return result;
  }
  async deliver(limit=3) {
    let last;
    for(let i=0;i<limit;i++){
      const r=await this.store.claimReply();if(!r)return;
      try{const sent=await this.providers.send(r.chat_id,r.payload);await this.store.delivered(r,sent.message_id);last=r;}
      catch(e){await this.store.retryReply(r,e.retryAfter || 0);throw e;}
    }
    // Continue large previews promptly in a fresh bounded delivery, rather than
    // waiting for the recovery sweep before showing their Save button.
    if(!/^(?:checkin|reminder|commitment):/.test(last.dedupe_key))await this.queue.publish(last.dedupe_key.split(':')[0],`reply-${last.ordinal}`);
  }
  async process(id) {
    const job=await this.store.claim(id);
    if(job)job.startedAt=Date.now();
    if(!job){await this.kick(id);await this.deliver();return;}
    try {
      if(job.attempts>5)throw new UserError('Processing failed after several attempts. Nothing new was saved. Use /status, then retry the request.','attempts_exhausted');
      const input=job.input;
      if(input.callback?.queryId){try{await this.providers.acknowledge(input.callback.queryId);}catch{/* expiry of Telegram's spinner must not invalidate a stored confirmation */}}
      if(input.text==='/limit')throw new UserError('Daily pilot allowance reached. Use Day directly or try tomorrow. This request was not saved.','daily_limit');
      if(input.text==='/audio-limit')throw new UserError('Send a voice note of up to two minutes and 10 MB.');
      let text=job.transcript || input.text;
      const menus={Today:'/today',Plan:'/plan',Memory:'/memory',Settings:'/settings'};if(menus[text])text=menus[text];
      if(input.voice && !text){
        text=await this.providers.transcribe(input.voice);await this.store.checkpoint(job,text);
        // A second delivery handles interpretation, leaving each stage within the
        // 60-second function budget. The completed transcript survives retries.
        await this.store.release(job,'transcribed');job.released=true;
        await this.queue.publish(id,'transcript');return;
      }
      const time=anchor(input.timestamp);
      const cmd=input.callback?{control:input.callback.verb}:control(text || '',time);
      if(input.callback && ['mdone','msnooze','mstop','mforget','medit','mwhy','mnex','cnex'].includes(input.callback.verb))await this.store.memoryControl(job,input.callback.verb,input.callback.id,input.callback.revision,this.writesEnabled);
      else if(text==='/memory'||text==='/plan')await this.store.memoryMenu(job,text==='/memory'?'memory':'commitment');
      else if(text==='/today'){const rows=await this.store.readRows(job);job.nextContext={...job.agentContext,focusDate:time.today,expiresAt:new Date(Date.now()+86400000).toISOString(),lastQuery:{date:time.today,kind:'summary'}};await this.store.finish(job,chunks(summarize(rows,time.today)).map(m=>({...m,discussionDate:time.today,queryKind:'summary'})));}
      else if(text==='/priorities'&&(this.store.prioritySuggestionsEnabled===false||this.store.memoryEnabled===false))await this.store.finish(job,[{text:'Priority suggestions are temporarily disabled.'}]);
      else if(text==='/settings'||text==='/priorities'){const rows=await this.store.readRows(job),D=require('./domain.cjs'),ctx=D.context(rows,text,time),review=D.plan({reply:'',questions:[],items:[],reflections:[],actions:[text==='/settings'?{type:'query_settings'}:{type:'query_priorities',date:time.today}]},rows,ctx.app.targets);await this.store.finish(job,chunks(review.answers));}
      else if(input.callback && ['pause','snooze','less'].includes(input.callback.verb))await this.store.proactiveControl(job,input.callback.verb);
      else if(text==='/history')await this.store.history(job);
      else if(text==='/forget')await this.store.forget(job);
      else if(/^\/(?:pause|resume)$/.test(text || ''))await this.store.setReminders(job,text==='/resume');
      else if(/^(?:yes|yes please|go ahead|confirm)[.!\s]*$/i.test(text || '') && (await this.store.pending(job))?.data.review.requiresConfirmation)await this.store.apply(job,undefined,this.writesEnabled);
      else if(cmd?.control==='save')await this.store.apply(job,input.callback?.id,this.writesEnabled);
      else if(cmd?.control==='undo')await this.store.undo(job,input.callback?.id,this.writesEnabled);
      else if(cmd?.control==='cancel')await this.store.cancel(job,input.callback?.id);
      else if(cmd?.control==='unlink')await this.store.unlink(job);
      else if(cmd?.control==='help' || /^\/start(?:@\w+)?$/.test(text || ''))await this.store.finish(job,[{text:help,reply_markup:{keyboard:[[{text:'Today'},{text:'Plan'}],[{text:'Memory'},{text:'Settings'}]],resize_keyboard:true}}]);
      else if(cmd?.control==='status'){
        const status=await this.store.status(job);
        const messages=status.pending?preview(status.pending.id,status.pending.data):[{text:status.receipt?`Latest bot change: ${status.receipt.undone?'undone':'saved'}. No pending draft.`:'No pending draft or saved bot changes.'}];
        if(status.waiting)messages.push({text:`${status.waiting} request(s) waiting or retrying. /cancel stops earlier unfinished work.`});
        await this.store.finish(job,messages);
      } else if(cmd?.control==='change'){
        await this.store.change(job,input.callback.id);
      } else {
        if(job.late)throw new UserError('This message arrived after a newer one. Resend it so I can use the correct order.','late_message');
        const pending=await this.store.pending(job);
        if(input.replyTo && !pending && !this.writesEnabled)throw new UserError('That preview is no longer pending. Send a new request or use /status.','stale');
        if(input.replyTo && pending && !await this.store.isCurrentReply(job,input.replyTo,pending.id))throw new UserError('That reply belongs to an old preview. Use /status and reply to the current one.','stale');
        if(pending && !input.replyTo && !pending.data.review.questions.length && !/^(?:actually|change|make that|correct|instead|no\b)/i.test(text))throw new UserError('A draft is waiting. Reply to its preview to correct it, or /cancel before starting another.','pending_draft');
        // A correction keeps the original date anchor, even after midnight.
        const effectiveTime=require('./dates.cjs').resolve(text,time.today)?time:(pending?.data.time || time);
        const rows=await this.store.readRows(job),conversation=await this.store.conversation(job,rows);
        const reference=await this.store.reference(job);if(reference)conversation.push(reference);
        const discussion=require('./discussion.cjs').resolve(text,time,job.agentContext,reference,pending);
        const discussionDate=discussion.date;
        job.nextContext={...job.agentContext,focusDate:discussionDate,lastQuery:null,expiresAt:new Date(Date.now()+86400000).toISOString()};
        const previous=job.agentContext?.lastQuery;
        const queryConversation=[...conversation,...(previous?[{discussion_date:previous.date,query_kind:previous.kind}]:[]),...(reference?.query_kind?[reference]:[])];
        const request=query(text,time.today,queryConversation,discussionDate);
        if(request&&discussion.expired&&!/\b(?:double[ -]?check|check again|are you sure)\b/i.test(text))throw new UserError('Which day should I check? Our earlier date discussion has expired.');
        if(request){
          job.nextContext={...job.nextContext,focusDate:request.date,lastQuery:request};
          await this.store.finish(job,chunks((request.kind==='gaps'?gaps:summarize)(rows,request.date)).map(m=>({...m,discussionDate:request.date,queryKind:request.kind})));
          await this.queue.publish(id,'replies');await this.kick(id);return;
        }
        if(discussion.expired&&/\b\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)?\s*(?:-|–|to)\s*\d/i.test(text))throw new UserError('Our earlier date discussion has expired. Which day should I put that on?');
        const ctx=context(rows,text,effectiveTime,conversation,{discussionDate});
        if(this.store.memoryEnabled===false){ctx.lasting_memory=[];ctx.app.targets=ctx.app.targets.filter(t=>!['memory','commitment'].includes(t.kind));}
        ctx.discussion_date=discussionDate;ctx.reply_reference=reference;
        const shared=rows.find(r=>r.date==='2000-01-01'&&r.start_time==='__agent_selection__');
        if(shared){try{const selection=JSON.parse(shared.note);if(Date.parse(selection.expiresAt)>Date.now())ctx.app.web_selection=selection;}catch{}}
        const preferences=rows.find(r=>r.date==='2000-01-01'&&r.start_time==='__agent_preferences__');
        if(preferences){try{ctx.agent_preferences=JSON.parse(preferences.note);}catch{}}
        const allowedNew=/^(?:yes|yes please|confirm)[.!\s]*$/i.test(text.trim())?(pending?.data.review.formatProposals || []):[];
        const draft=allowedNew.length?pending.data.draft:cmd?.actions?{reply:'',questions:[],items:[],reflections:[],actions:cmd.actions}:await this.providers.interpret(text,ctx,pending?.data.draft);
        // Deadlines and dated prose are not changes to the diary day under discussion.
        if(!draft.items?.length&&!draft.reflections?.length&&(draft.actions || []).every(a=>/^(?:memory_|commitment_|query_memory|query_commitments|query_priorities|agent_preferences|query_settings|note_|project_)/.test(a.type)))job.nextContext={...job.agentContext,lastQuery:null};
        const dateError=require('./discussion.cjs').checkDraft(draft,discussion,text);
        if(dateError)throw new UserError(dateError,'date_mismatch');
        const selectedCategory=pending?.data.review.questions.length && /^[a-z]+$/.test(text.trim().toLowerCase())?text.trim().toLowerCase():undefined;
        if(!this.extendedTools && draft.actions?.some(a=>require('./agent-tools.cjs').tools[a.type]))throw new UserError('That agent feature is temporarily unavailable.');
        if(this.store.memoryEnabled===false && draft.actions?.some(a=>/^(?:memory_|commitment_|query_memory|query_commitments|query_priorities)/.test(a.type)))throw new UserError('Lasting memory is temporarily disabled.');
        if(this.store.prioritySuggestionsEnabled===false&&draft.actions?.some(a=>a.type==='query_priorities'))throw new UserError('Priority suggestions are temporarily disabled.');
        job.toolNames=(draft.actions || []).map(a=>a.type).concat(draft.items.length?['activity_add']:[],draft.reflections.length?['reflection_append']:[]);
        const review=plan(draft,rows,ctx.app.targets,{strict:true,allowedNew,selectedCategory});
        if(!review.patches.length && !review.questions.length && !review.answers.length && !review.navigation.length && require('./day-summary.cjs').needsEvidence(text))throw new UserError('I couldn’t verify that from the saved records. Which date or item should I look up?','ungrounded_answer');
        if(!review.patches.length && !review.questions.length){
          await this.store.finish(job,chunks([...review.answers,...review.navigation.map(a=>`Open ${a.screen}${a.date?' for '+a.date:''} in Day.`),...(!review.answers.length&&!review.navigation.length?[(draft.actions?.length || draft.items?.length || draft.reflections?.length)?'Everything already matches — no changes were needed.':draft.reply || 'What would you like to update?']:[])]));
        } else await this.store.saveDraft(job,{draft,review,transcript:text,voice:!!input.voice,time:effectiveTime,discussionDate,conversation:[...conversation,{user:text,assistant:draft.reply,question:review.questions[0] || ''}].slice(-3)},preview,this.writesEnabled && !review.requiresConfirmation);
      }
    } catch(e) {
      if(job.released)throw e;
      if(e instanceof UserError)await this.store.finish(job,[{text:e.message}]);
      else {if(e.code!=='lease_lost')await this.store.release(job,/^[a-z_]+$/.test(e.code || '')?e.code:'internal',e.retryAfter || 0);throw e;}
    }
    // Replies run separately so model latency plus multiple Telegram calls cannot
    // exhaust the function deadline. The outbox also survives enqueue failure.
    await this.queue.publish(id,'replies');
    await this.kick(id);
  }
  async kick(id){const next=await this.store.nextPending(id);if(next)await this.queue.publish(next.id,`wake-${id}`);}
  async recover(){
    await this.store.checkins();
    const results=await Promise.allSettled((await this.store.recover()).map(job=>this.queue.publish(job.id)));
    await this.deliver(3);
    if(results.some(r=>r.status==='rejected'))throw new Error('Some jobs could not be requeued');
  }
}
module.exports={Service,parseUpdate,preview,chunks,help};
