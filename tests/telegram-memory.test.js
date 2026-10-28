'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const D=require('../server/telegram/domain.cjs'),M=require('../server/telegram/memory.cjs'),A=require('../voice-actions');
const date='2026-10-28',time={today:date,local_time:'10:00',timezone:'Europe/London'};
const row=(slot,note,category='plan',day=date)=>({date:day,start_time:slot,category,note,subcategory:'',version:'1:1'});
const draft=actions=>({reply:'',questions:[],items:[],reflections:[],actions});
function apply(actions,rows=[]){const ctx=D.context(rows,'application',time),result=D.plan(draft(actions),rows,ctx.app.targets),days=A.daysFromRows(rows);for(const p of result.patches){const day=days[p.date] ||= {};if(p.after)day[p.slot]=p.after;else delete day[p.slot];}return {result,days,rows:Object.entries(days).flatMap(([date,day])=>Object.entries(day).map(([start_time,b])=>({date,start_time,...b,subcategory:b.sub,version:'2:2'})))};}
const records=rows=>M.view(rows,D.helpers);
test('explicit lasting memories persist separately; inferred ones require confirmation',()=>{
 const explicit=apply([{type:'memory_remember',kind:'preference',text:'Prefer afternoon check-ins'}]);assert.equal(explicit.result.requiresConfirmation,false);const memory=records(explicit.rows)[0];assert.equal(memory.status,'active');assert.equal(memory.basis,'explicit');assert.equal(explicit.rows[0].date,'2000-01-01');
 assert.equal(apply([{type:'memory_remember',kind:'preference',text:'Might prefer afternoons',basis:'inferred'}]).result.requiresConfirmation,true);
});
test('commitments never invent time slots or check-in times from deadlines',()=>{
 const {rows}=apply([{type:'commitment_create',title:'Finish application',due_date:'2026-10-30',next_action:'Outline final section'}]);const c=records(rows)[0];assert.equal(rows.length,1);assert.equal(c.followupAt,undefined);assert.equal(c.dueDate,'2026-10-30');assert.equal(c.nextAction,'Outline final section');
});
test('source links add a stable objective identity and survive moves/renames',()=>{
 const created=apply([{type:'commitment_create',title:'Application',source_target:'objective:'+date+':daily:0'}],[row('__plan__','[ ] Application')]);const c=records(created.rows)[0];assert.ok(c.source.linkId);assert.match(created.days[date].__plan__.note,/<!--day-link:/);
 const moved=structuredClone(created.days);moved['2026-10-29']=moved[date];delete moved[date];moved['2026-10-29'].__plan__.note=moved['2026-10-29'].__plan__.note.replace('Application','Submit application');const live=M.live(c,moved,D.helpers);assert.equal(live.sourceState,'current');assert.equal(live.sourceDate,'2026-10-29');assert.equal(live.sourceLabel,'Submit application');
});
test('completion suppresses follow-ups, and reopening requires review rather than resurrection',()=>{
 const created=apply([{type:'commitment_create',title:'Application',source_target:'objective:'+date+':daily:0',followup_date:'2099-02-04',followup_time:'15:00'}],[row('__plan__','[ ] Application')]);const c=records(created.rows)[0],days=structuredClone(created.days);days[date].__plan__.note=days[date].__plan__.note.replace('[ ]','[x]');const done=M.live(c,days,D.helpers);assert.equal(done.status,'completed');assert.equal(M.followups([done],Date.parse('2099-02-04T16:00Z')).length,0);
 days[date].__plan__.note=days[date].__plan__.note.replace('[x]','[ ]');assert.equal(M.live(done,days,D.helpers).status,'needs_review');
});
test('source deletion and note tombstones require review and never recreate source data',()=>{
 const note={id:'n',title:'Application',body:'Draft',deleted:false};const created=apply([{type:'commitment_create',title:'Application',source_target:'note:n'}],[row('__note__n',JSON.stringify(note),'note','2000-01-01')]);const c=records(created.rows)[0],days=structuredClone(created.days);delete days['2000-01-01'].__note__n;assert.equal(M.live(c,days,D.helpers).status,'needs_review');assert.equal(days['2000-01-01'].__note__n,undefined);
 days['2000-01-01'].__note__n={category:'note',note:JSON.stringify({...note,deleted:true})};assert.equal(M.live(c,days,D.helpers).status,'needs_review');
});
test('commitment completion updates its linked objective in the same patch set',()=>{
 const created=apply([{type:'commitment_create',title:'Application',source_target:'objective:'+date+':daily:0'}],[row('__plan__','[ ] Application')]),c=records(created.rows)[0];const completed=apply([{type:'commitment_update',target:'commitment:'+c.id,status:'completed'}],created.rows);assert.match(completed.days[date].__plan__.note,/\[x\]/);assert.equal(records(completed.rows)[0].status,'completed');assert.equal(completed.result.patches.length,2);
});
test('rescheduling a deadline clears an obsolete check-in',()=>{
 const created=apply([{type:'commitment_create',title:'Application',due_date:'2099-02-05',followup_date:'2099-02-04',followup_time:'15:00'}]),c=records(created.rows)[0];const changed=apply([{type:'commitment_update',target:'commitment:'+c.id,due_date:'2099-02-10'}],created.rows);assert.equal(records(changed.rows)[0].followupAt,null);assert.match(records(changed.rows)[0].reason,/cleared/);
});
test('forgetting wipes the active fact while preserving linked source content',()=>{
 const created=apply([{type:'memory_remember',kind:'decision',text:'Remember this synthetic decision',source_target:'note:n'}],[row('__note__n',JSON.stringify({id:'n',title:'Decision',body:'Keep source'}),'note','2000-01-01')]),m=records(created.rows)[0];const forgotten=apply([{type:'memory_forget',target:'memory:'+m.id}],created.rows);assert.equal(forgotten.result.requiresConfirmation,true);const record=records(forgotten.rows)[0];assert.equal(record.status,'forgotten');assert.equal(record.text,undefined);assert.ok(forgotten.days['2000-01-01'].__note__n);
});
test('priorities use explicit project priority and explain their reasoning without mutations',()=>{
 const project=apply([{type:'memory_remember',kind:'project',title:'Application',text:'Application is the main priority this week',priority:'high'}]),p=records(project.rows)[0];const linked=apply([{type:'commitment_create',title:'Outline application',project_target:'memory:'+p.id,next_action:'Draft headings'}],project.rows);const ranked=M.priorities(records(linked.rows),date);assert.match(ranked[0].reason,/high priority/);assert.match(ranked[0].reason,/Draft headings/);const query=apply([{type:'query_priorities',date}],linked.rows);assert.equal(query.result.patches.length,0);
});
test('cards are bounded and callbacks identify an exact record revision',()=>{
 const created=apply([{type:'memory_remember',kind:'context',text:'x'.repeat(2000)}]),m=records(created.rows)[0],card=M.card(m);assert.ok(card.text.length<=3600);assert.ok(card.reply_markup.inline_keyboard.flat().every(b=>b.callback_data.length<=64));assert.match(card.reply_markup.inline_keyboard[0][0].callback_data,new RegExp(':'+m.revision.toString(36)+'$'));
});
test('reconciliation is idempotent and old events cannot undo a newer source state',()=>{
 const created=apply([{type:'commitment_create',title:'Application',source_target:'objective:'+date+':daily:0'}],[row('__plan__','[ ] Application')]);assert.equal(M.reconcile(created.days,D.helpers).length,0);created.days[date].__plan__.note=created.days[date].__plan__.note.replace('[ ]','[x]');const patches=M.reconcile(created.days,D.helpers);for(const p of patches)created.days[p.date][p.slot]=p.after;assert.equal(M.reconcile(created.days,D.helpers).length,0);
});
test('read-only queries never propose writes to legacy unreconciled memories',()=>{
 const rows=[row('__memory__legacy',JSON.stringify({id:'legacy',type:'memory',status:'active',title:'Preference',text:'Concise replies',createdAt:'2026-10-28T12:00Z'}),'agent_memory','2000-01-01')];
 const ctx=D.context(rows,'memory',time),result=D.plan(draft([{type:'query_memory'}]),rows,ctx.app.targets);assert.equal(result.patches.length,0);assert.match(result.answers[0],/Concise replies/);
});
test('a linked note body change invalidates memory even when its title is unchanged',()=>{
 const note={id:'n',title:'Project',body:'Original decision'},created=apply([{type:'memory_remember',kind:'decision',text:'Original decision',source_target:'note:n'}],[row('__note__n',JSON.stringify(note),'note','2000-01-01')]);const record=records(created.rows)[0];created.days['2000-01-01'].__note__n.note=JSON.stringify({...note,body:'New decision'});const current=M.live(record,created.days,D.helpers);assert.equal(current.status,'needs_review');assert.match(current.reason,/content changed/);
});
test('bare UUID references resolve only to the exact owner catalog entity of the requested kind',()=>{
 const created=apply([{type:'memory_remember',kind:'preference',text:'Concise'}]),record=records(created.rows)[0];const changed=apply([{type:'memory_update',target:record.id,text:'Detailed'}],created.rows);assert.equal(records(changed.rows)[0].text,'Detailed');assert.throws(()=>apply([{type:'commitment_update',target:record.id,status:'completed'}],created.rows),/Which commitment/);assert.throws(()=>apply([{type:'memory_update',target:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'Wrong'}],created.rows),/Which memory/);
});
