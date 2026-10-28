/* Shared pure memory/source reconciliation. No network access or writes. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./voice-actions'));else root.DayAgentMemory=factory(root.DayVoiceActions);})(typeof globalThis!=='undefined'?globalThis:this,function(A){
'use strict';
const DATE='2000-01-01',PREFIX={memory:'__memory__',commitment:'__commitment__'};
const parse=value=>{try{return JSON.parse(value || '{}');}catch{return null;}};
function entities(days){return Object.entries(days[DATE] || {}).flatMap(([slot,b])=>{const type=slot.startsWith(PREFIX.memory)?'memory':slot.startsWith(PREFIX.commitment)?'commitment':null;if(!type)return [];const value=parse(b.note);return value?.id&&value.type===type?[{...value,slot}]:[];});}
function fromRows(rows){return entities(A.daysFromRows(rows));}
function targets(days){return entities(days).filter(e=>e.status!=='forgotten').map(e=>({id:`${e.type}:${e.id}`,kind:e.type,date:DATE,slot:e.slot,text:e.title || e.text,status:e.status}));}
function objectiveMatches(days,helpers,linkId){const matches=[];for(const [date,day] of Object.entries(days)){const settings=parse(day.__settings__?.note) || {},horizons=date===DATE?['shortTermObjectives','longTermObjectives']:['daily'];for(const horizon of horizons){const raw=horizon==='daily'?day.__plan__?.note:settings[horizon];const items=(raw || '').split(/\r?\n/).map(helpers.parseObjective).filter(i=>i.text);items.forEach((item,index)=>{if(item.linkId===linkId)matches.push({date,horizon,index,item,items,day,settings});});}}return matches;}
// Change detection only; this checksum is not an authentication boundary.
function fingerprint(text){let h=14695981039346656037n;for(const c of text){h^=BigInt(c.codePointAt(0));h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16);}
function sourceState(record,days,helpers){
 if(!record.source)return {state:'independent'};
 if(record.source.kind==='note'){const note=parse(days[DATE]?.['__note__'+record.source.id]?.note);return !note?.id||note.deleted?{state:'missing'}:{state:'current',label:note.title,fingerprint:fingerprint(JSON.stringify(note))};}
 if(record.source.kind==='objective'){const matches=objectiveMatches(days,helpers,record.source.linkId);if(!matches.length)return {state:'missing'};const done=matches.filter(m=>m.item.completed).length;return {state:done===matches.length?'completed':done?'inconsistent':'current',label:matches[0].item.text,date:matches[0].date,fingerprint:fingerprint(JSON.stringify(matches.map(m=>[m.date,m.horizon,m.item.text,m.item.completed])))};}
 return {state:'missing'};
}
function live(record,days,helpers,now=Date.now()){
 const checked=structuredClone(record),source=sourceState(record,days,helpers);checked.sourceState=source.state;checked.sourceLabel=source.label || '';checked.sourceDate=source.date || null;checked.sourceFingerprint=source.fingerprint || '';
 if(['forgotten','cancelled'].includes(record.status))return checked;
 if(source.state==='missing'||source.state==='inconsistent'){checked.status='needs_review';checked.reason=source.state==='missing'?'Linked record was removed or its identity changed.':'Linked objectives have conflicting completion states.';}
 else if(source.state==='completed' && record.type==='commitment' && !['completed','paused'].includes(record.status)){checked.status='completed';checked.reason='Linked objective is completed.';}
 else if(record.status==='completed'&&record.reason==='Linked objective is completed.'&&source.state==='current'){checked.status='needs_review';checked.reason='Linked objective was reopened. Confirm whether to resume follow-ups.';}
 if(record.type==='memory'&&record.status==='active'&&record.sourceFingerprint&&source.fingerprint&&record.sourceFingerprint!==source.fingerprint){checked.status='needs_review';checked.reason='Linked content changed. Please review the remembered fact.';}
 if(record.reviewAfter&&Date.parse(record.reviewAfter)<now&&checked.status==='active'){checked.status='needs_review';checked.reason='This memory is due for review.';}
 return checked;
}
function reconcile(days,helpers,now=Date.now()){
 const patches=[];
 for(const record of entities(days)){const current=live(record,days,helpers,now),clean=r=>JSON.stringify({status:r.status,sourceState:r.sourceState,sourceLabel:r.sourceLabel || '',sourceDate:r.sourceDate || null,sourceFingerprint:r.sourceFingerprint || '',reason:r.reason || ''});
  if(clean(current)!==clean(record)){delete current.slot;current.updatedAt=new Date(now).toISOString();current.lastVerifiedAt=current.updatedAt;current.revision=(record.revision || 1)+1;patches.push({date:DATE,slot:record.slot,before:A.normal(days[DATE][record.slot]),after:{category:'agent_'+record.type,sub:'',note:JSON.stringify(current)}});}
 }
 return patches;
}
function view(rows,helpers,now=Date.now()){const days=A.daysFromRows(rows);return entities(days).map(e=>live(e,days,helpers,now));}
function priorities(records,today){return records.filter(r=>r.type==='commitment'&&r.status==='active').map(r=>{const project=records.find(p=>p.id===r.projectId&&p.status==='active'),priority=r.priority || project?.priority || 'normal',days=r.dueDate?(Date.parse(r.dueDate)-Date.parse(today))/86400000:null;return {record:r,score:({high:300,normal:100,low:0}[priority] || 0)+(days===null?0:Math.max(0,60-days)),reason:[priority==='high'?'You marked this as a high priority':null,r.dueDate?`Due ${r.dueDate}`:null,r.nextAction?`Next step: ${r.nextAction}`:null].filter(Boolean).join(' · ') || 'Active commitment; no deadline or priority supplied'};}).sort((a,b)=>b.score-a.score||a.record.createdAt.localeCompare(b.record.createdAt));}
function format(record){const label=record.title || record.text || 'Forgotten memory';return `${label}${record.text&&record.text!==label?'\n'+record.text.slice(0,2000):''}\n${({active:record.type==='memory'?'Remembered':'Tracking',waiting:'Waiting',paused:'Follow-ups paused',completed:'Completed',cancelled:'Cancelled',needs_review:'Needs your review',forgotten:'Forgotten',superseded:'Superseded'})[record.status] || record.status}${record.dueDate?' · due '+record.dueDate:''}${record.followupAt?' · check-in '+new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'medium',timeStyle:'short'}).format(new Date(record.followupAt)):''}${record.nextAction?'\nNext: '+record.nextAction.slice(0,900):''}${record.reason?'\n'+record.reason:''}${record.source?'\nLinked to '+record.source.kind+(record.sourceLabel?': '+record.sourceLabel.slice(0,150):''):''}${record.type==='memory'?'\n'+(record.basis==='inferred'?'Inferred, confirmed before saving':'Explicitly remembered'):''}`.slice(0,3400);}
function callback(verb,record){return {text:verb==='mdone'?'Done':verb==='msnooze'?'Snooze this task':verb==='mstop'?'Stop following up':verb==='mforget'?'Forget this memory':verb==='mwhy'?'Why?':'Edit',callback_data:`${verb}:${record.id.replaceAll('-','')}:${(record.revision || 1).toString(36)}`};}
function card(record){
 let buttons=[];
 if(record.type==='commitment'){
   if(['active','waiting','paused'].includes(record.status))buttons.push([callback('mdone',record),callback('msnooze',record)]);
   buttons.push([callback('medit',record),...(['completed','cancelled'].includes(record.status)?[]:[callback('mstop',record)]),callback('mwhy',record)]);
 }else if(record.status!=='forgotten')buttons.push([callback('medit',record),callback('mforget',record),callback('mwhy',record)]);
 return {text:format(record),memoryId:record.id,revision:record.revision || 1,reply_markup:{inline_keyboard:buttons}};
}

function followups(records,now=Date.now()){
 return records.filter(r=>r.type==='commitment'&&['active','waiting'].includes(r.status)&&r.followupAt&&Date.parse(r.followupAt)<=now&&now-Date.parse(r.followupAt)<7*86400000).sort((a,b)=>Date.parse(a.followupAt)-Date.parse(b.followupAt));
}


return {DATE,PREFIX,entities,fromRows,targets,view,live,reconcile,sourceState,priorities,format,card,followups,objectiveMatches,parse};
});
