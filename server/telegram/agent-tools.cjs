'use strict';
// Telegram tool registry. Each tool has a closed schema and a deterministic handler.
// The browser/Python voice contract remains backward compatible.
const A=require('../../voice-actions');
const R=require('../../event-range');
const {randomUUID}=require('node:crypto');
const text={type:'string',minLength:1,maxLength:4000},short={...text,maxLength:150};
const date={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},clock={type:'string',pattern:'^(?:[01]\\d|2[0-3]):(?:00|30)$'};
const VERSION=2;
const endClock={type:'string',pattern:'^(?:(?:[01]\\d|2[0-3]):(?:00|30)|24:00)$'};
const tools={};
function tool(name,description,fields,required,run,{confirm=false}={}){tools[name]={description,fields,required,run,confirm};}
const parse=value=>{try{return JSON.parse(value || '{}');}catch{throw Error('This saved record is unreadable. Open it in Day before editing.');}};
const str=value=>String(value || '').trim();
function validDate(d){if(!A.dateOK(d))throw Error('Which date do you mean?');return d;}
function target(a,ctx,kind){const canonical=['memory','commitment'].includes(kind)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.target || '')?kind+':'+a.target:a.target;const t=ctx.catalog.find(t=>t.id===canonical && t.kind===kind);if(!t)throw Error(`Which ${kind} do you mean?`);return t;}
function get(ctx,date){return ctx.next[date] ||= {};}
function saveJSON(ctx,date,slot,category,value,sub=''){get(ctx,date)[slot]={category,note:JSON.stringify(value),sub};}
function interval(a){validDate(a.date);validDate(a.end_date || a.date);const r=R.build(a.date,a.start,a.end_date || a.date,a.end);if(r.error || r.hours>168)throw Error(r.error || 'Choose at most seven days.');return r;}
function noteTarget(a,ctx){const t=target(a,ctx,'note'),day=get(ctx,t.date),note=parse(day[t.slot]?.note);if(!note.id || note.deleted)throw Error('That note is no longer available.');return {t,day,note};}
function projects(ctx){return parse(get(ctx,'2000-01-01').__note_projects__?.note).projects || [];}
function projectId(name,ctx){if(!name)return '';const found=projects(ctx).filter(p=>p.name.toLowerCase()===name.toLowerCase());if(found.length!==1)throw Error('Which existing note project do you mean?');return found[0].id;}
function notes(ctx){return Object.entries(get(ctx,'2000-01-01')).filter(([slot])=>slot.startsWith('__note__')).map(([slot,b])=>({slot,...parse(b.note)})).filter(n=>n.id&&!n.deleted);}
function selectedSlots(a,ctx){const r=interval(a),list=[];for(const day of r.days)for(const slot of day.slots)list.push({date:day.date,slot,block:get(ctx,day.date)[slot]});return list;}
function objective(a,ctx){const t=target(a,ctx,'objective'),day=get(ctx,t.date),settings=parse(day.__settings__?.note),raw=t.horizon==='daily'?day.__plan__?.note:settings[t.horizon];const items=(raw || '').split(/\r?\n/).map(ctx.helpers.parseObjective).filter(i=>i.text);if(items[t.index]?.text!==t.text)throw Error('That objective changed. Ask me for the current list.');return {t,day,settings,items};}
function saveObjectives(o,ctx){const value=ctx.helpers.serializeObjectives(o.items);if(o.t.horizon==='daily'){if(value)o.day.__plan__={category:'plan',note:value};else delete o.day.__plan__;}else{o.settings[o.t.horizon]=value;saveJSON(ctx,'2000-01-01','__settings__','settings',o.settings);}}

tool('query_slot','Read exact saved activities and notes for a date/time range.',{date,start:clock,end:endClock},['date'],(a,c)=>{
 validDate(a.date);const day=get(c,a.date);const slots=Object.keys(day).filter(s=>/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(s)&&(!a.start||s>=a.start)&&(!a.end||s<a.end)).sort();
 return slots.length?slots.map(s=>`${a.date} ${s} · ${day[s].sub || day[s].category}${day[s].note?' · '+day[s].note:''}`).join('\n'):`No activities are saved for ${a.date}${a.start?' at '+a.start:''}.`;
});
tool('query_objectives','Read saved daily or longer-term objectives.',{date,horizon:{enum:['daily','shortTermObjectives','longTermObjectives']}},[],(a,c)=>{const horizon=a.horizon || 'daily';if(horizon==='daily')validDate(a.date);const day=get(c,horizon==='daily'?a.date:'2000-01-01');const raw=(horizon==='daily'?day.__plan__?.note:parse(day.__settings__?.note)[horizon]) || '';return raw?raw.split(/\r?\n/).map(c.helpers.parseObjective).filter(i=>i.text).map(i=>`${i.completed?'✓':'○'} ${i.text}`).join('\n'):'No objectives are saved for that scope.';});
tool('query_notes','Search saved note titles and bodies; provide full content of a selected note.',{target:short,text:short},[],(a,c)=>{if(a.target){const {note}=noteTarget(a,c);return `${note.title}\n${note.body || ''}`;}const list=notes(c).filter(n=>!a.text||`${n.title} ${n.body}`.toLowerCase().includes(a.text.toLowerCase()));return list.length?list.slice(0,20).map(n=>`${n.title}: ${(n.body || '').slice(0,300)}`).join('\n'):'No matching notes are saved.';});
tool('query_reflection','Read saved reflection for a date.',{date},['date'],(a,c)=>{validDate(a.date);return get(c,a.date).__reflect__?.note || `No reflection is saved for ${a.date}.`;});
tool('query_gym','Read detailed saved gym record for a date.',{date},['date'],(a,c)=>{validDate(a.date);const day=get(c,a.date),gym=day.__gym__?parse(day.__gym__.note):{},lines=[];if(gym.weight!=null)lines.push(`Body weight: ${gym.weight}kg`);const format=s=>`${s.exercise}${s.sets?' · '+s.sets+' sets':''}${s.reps?' × '+s.reps:''}${s.kg!=null?' at '+s.kg+'kg':''}`;for(const s of gym.sessions || [])lines.push(format(s));const seen=new Set();for(const [slot,b] of Object.entries(day))if(b.category==='gym'&&b.note?.startsWith('__gym_workout_v1__')&&!seen.has(b.note)){seen.add(b.note);lines.push(slot+' · '+(parse(b.note.slice('__gym_workout_v1__'.length)).exercises || []).map(format).join(', '));}return lines.length?`Gym · ${a.date}\n`+lines.join('\n'):`No gym record is saved for ${a.date}.`;});
tool('query_settings','Read activity configuration and agent preferences.',{},[],(a,c)=>{const day=get(c,'2000-01-01'),settings=parse(day.__settings__?.note),prefs=parse(day.__agent_preferences__?.note);return `Check-ins: every ${prefs.interval_hours || 3} hours, maximum ${prefs.daily_limit || 4}/day; quiet ${prefs.quiet_start ?? 22}:00–${prefs.quiet_end ?? 9}:00 London.\nActivities:\n`+Object.entries(settings.subs || {}).map(([cat,names])=>`${cat}: ${Array.isArray(names)?names.join(', '):''}`).join('\n');});
tool('query_reminders','Read actual saved reminders for a date.',{date},['date'],(a,c)=>{validDate(a.date);const block=get(c,a.date).__event_reminders__,list=block?parse(block.note):[];return list.length?list.map(r=>`${r.start} · ${r.title}${r.lead?' ('+r.lead+' minutes before)':''}${r.dismissed?' · dismissed':''}`).join('\n'):`No reminders are saved for ${a.date}.`;});

tool('activity_slice','Edit only the specified range, preserving all surrounding entries. Use current formats.',{date,start:clock,end:endClock,end_date:date,activity:short,category:short,text:{type:'string',maxLength:4000}},['date','start','end'],(a,c)=>{
 if(a.category&&!c.helpers.categories.includes(a.category))throw Error('Choose an existing activity category.');
 const slots=selectedSlots(a,c);if(slots.some(x=>!x.block))throw Error('Some selected time is empty. Describe a new entry instead.');
 for(const x of slots)get(c,x.date)[x.slot]={...x.block,...(a.activity?{sub:a.activity}:{}),...(a.category?{category:a.category}:{}),...(a.text!=null?{note:a.text}:{})};
});
for(const type of ['activity_copy','activity_move_range'])tool(type,`${type==='activity_copy'?'Copy':'Move'} a recorded range to destination_date at the same times; ask to confirm overlaps.`,{date,start:clock,end:endClock,end_date:date,destination_date:date},['date','start','end','destination_date'],(a,c)=>{
 validDate(a.destination_date);const slots=selectedSlots(a,c);if(!slots.some(x=>x.block))throw Error('There are no saved activities in that range.');
 const offset=(Date.parse(a.destination_date)-Date.parse(a.date))/86400000;
 const moving=slots.filter(x=>x.block).map(x=>({...x,dest:R.shift(x.date,offset)}));
 if(type==='activity_move_range')for(const x of moving)delete get(c,x.date)[x.slot];
 for(const x of moving){const existing=get(c,x.dest)[x.slot];if(existing&&!A.same(existing,x.block)){c.confirm=true;summariesPlaceholder(c,`Replace ${x.dest} ${x.slot}: ${existing.sub || existing.category}`);}get(c,x.dest)[x.slot]=structuredClone(x.block);}
});
tool('objective_update','Rename an existing objective while preserving completion and links.',{target:short,text},['target','text'],(a,c)=>{if(/[\r\n]|<!--day-link:/.test(a.text))throw Error('Give one objective on one line.');const o=objective(a,c);o.items[o.t.index].text=a.text;saveObjectives(o,c);});
tool('objective_move','Move a daily objective to another day, retaining its metadata.',{target:short,date},['target','date'],(a,c)=>{validDate(a.date);const o=objective(a,c);if(o.t.horizon!=='daily')throw Error('Choose a daily objective to move.');if(o.t.date===a.date)return;const [item]=o.items.splice(o.t.index,1);saveObjectives(o,c);const day=get(c,a.date),items=(day.__plan__?.note || '').split(/\r?\n/).map(c.helpers.parseObjective).filter(i=>i.text);items.push(item);day.__plan__={category:'plan',note:c.helpers.serializeObjectives(items)};});
tool('note_create','Save an idea, thought or note in the existing notes system.',{title:short,text,project:short},['title','text'],(a,c)=>{if(notes(c).some(n=>n.title.toLowerCase()===a.title.toLowerCase()))throw Error('A note with that title exists. Should I append to it?');const id=randomUUID(),now=new Date().toISOString();saveJSON(c,'2000-01-01','__note__'+id,'note',{id,title:a.title,body:a.text,projectId:projectId(a.project,c),createdAt:now,updatedAt:now,deleted:false});});
tool('note_update','Update title, body or project of a selected note; preserve other fields.',{target:short,title:short,text:{type:'string',maxLength:4000},project:{type:'string',maxLength:150}},['target'],(a,c)=>{const {t,day,note}=noteTarget(a,c);if(a.title&&notes(c).some(n=>n.id!==note.id&&n.title.toLowerCase()===a.title.toLowerCase()))throw Error('That title is already in use.');if(a.title)note.title=a.title;if(a.text!=null)note.body=a.text;if(a.project!=null)note.projectId=projectId(a.project,c);note.updatedAt=new Date().toISOString();day[t.slot]={...day[t.slot],note:JSON.stringify(note)};});
tool('note_delete','Delete a selected note, requiring confirmation.',{target:short},['target'],(a,c)=>{const {t,day,note}=noteTarget(a,c);note.deleted=true;note.updatedAt=new Date().toISOString();day[t.slot]={...day[t.slot],note:JSON.stringify(note)};},{confirm:true});
for(const type of ['project_create','project_update','project_delete'])tool(type,'Create, rename or delete a note project. Deleting moves its notes to Unfiled.',{project:short,title:short},['project'],(a,c)=>{
 let list=projects(c);const matches=list.filter(p=>p.name.toLowerCase()===a.project.toLowerCase());
 if(type==='project_create'){if(matches.length)throw Error('That project already exists.');list.push({id:randomUUID(),name:a.project});}
 else {if(matches.length!==1)throw Error('Which existing project do you mean?');const p=matches[0];if(type==='project_update'){if(!a.title)throw Error('What should the new project name be?');if(list.some(x=>x.id!==p.id&&x.name.toLowerCase()===a.title.toLowerCase()))throw Error('That project name is in use.');p.name=a.title;}
 else {list=list.filter(x=>x.id!==p.id);for(const n of notes(c))if(n.projectId===p.id){delete n.slot;n.projectId='';n.updatedAt=new Date().toISOString();saveJSON(c,'2000-01-01','__note__'+n.id,'note',n);}}}
 saveJSON(c,'2000-01-01','__note_projects__','note_projects',{projects:list,updatedAt:new Date().toISOString()});
},{confirm:type==='project_delete'});
for(const type of ['rough_plan_update','rough_plan_remove'])tool(type,'Edit or remove an exact rough-plan item.',{date,text,replacement:text},['date','text'],(a,c)=>{validDate(a.date);const day=get(c,a.date),items=c.helpers.roughPlans(day),index=items.indexOf(a.text);if(index<0)throw Error('That rough plan is no longer saved.');if(type==='rough_plan_update'){if(!a.replacement)throw Error('What should the plan say instead?');items[index]=a.replacement;}else items.splice(index,1);if(items.length)day.__rough_plan__=c.helpers.roughPlanBlock(items);else delete day.__rough_plan__;},{confirm:type==='rough_plan_remove'});
tool('reflection_set','Replace a dated reflection, requiring confirmation when it already exists.',{date,text:{type:'string',maxLength:4000}},['date','text'],(a,c)=>{validDate(a.date);const day=get(c,a.date);if(day.__reflect__?.note)c.confirm=true;if(a.text)day.__reflect__={category:'reflection',note:a.text};else delete day.__reflect__;});
const session={type:'object',additionalProperties:false,properties:{exercise:short,sets:{type:'integer',minimum:1,maximum:100},reps:{type:'integer',minimum:1,maximum:1000},kg:{type:'number',minimum:0,maximum:2000}},required:['exercise']};
tool('gym_set','Save detailed gym weight and sessions using the app gym logger format. Omitted fields are preserved.',{date,weight:{type:['number','null'],minimum:0,maximum:1000},sessions:{type:'array',maxItems:50,items:session}},['date'],(a,c)=>{validDate(a.date);const day=get(c,a.date),gym=parse(day.__gym__?.note);if(a.sessions&&gym.sessions?.length)c.confirm=true;saveJSON(c,a.date,'__gym__','gym',{...gym,...(Object.hasOwn(a,'weight')?{weight:a.weight}:{}),...(a.sessions?{sessions:a.sessions}:{} )});});
tool('reminder_set','Create an event reminder at a date and half-hour time. lead is minutes before.',{date,start:clock,title:short,lead:{type:'integer',minimum:0,maximum:10080}},['date','start','title'],(a,c)=>{validDate(a.date);const day=get(c,a.date),list=day.__event_reminders__?parse(day.__event_reminders__.note):[];list.push({id:randomUUID(),title:a.title,start:a.start,lead:a.lead || 0,dismissed:false,notified:false,type:'event'});saveJSON(c,a.date,'__event_reminders__','calendar_reminder',list,'Event reminders');});
tool('reminder_delete','Remove a saved reminder by its exact title and date.',{date,title:short},['date','title'],(a,c)=>{validDate(a.date);const day=get(c,a.date),list=day.__event_reminders__?parse(day.__event_reminders__.note):[],found=list.filter(r=>r.title===a.title);if(found.length!==1)throw Error('Which reminder do you mean?');const rest=list.filter(r=>r!==found[0]);if(rest.length)saveJSON(c,a.date,'__event_reminders__','calendar_reminder',rest,'Event reminders');else delete day.__event_reminders__;},{confirm:true});
tool('agent_preferences','Set check-in preferences; timezone is Europe/London. Omitted preferences are preserved.',{enabled:{type:'boolean'},interval_hours:{type:'integer',minimum:2,maximum:8},quiet_start:{type:'integer',minimum:0,maximum:23},quiet_end:{type:'integer',minimum:0,maximum:23},daily_limit:{type:'integer',minimum:1,maximum:8},snooze_hours:{type:'integer',minimum:1,maximum:168}},[],(a,c)=>{const prefs=parse(get(c,'2000-01-01').__agent_preferences__?.note);for(const key of ['enabled','interval_hours','quiet_start','quiet_end','daily_limit'])if(a[key]!=null)prefs[key]=a[key];if(a.snooze_hours)prefs.snooze_until=new Date(Date.now()+a.snooze_hours*3600000).toISOString();saveJSON(c,'2000-01-01','__agent_preferences__','agent_preferences',prefs);});

tool('settings_activity','Add, rename, remove or reclassify an activity in app settings. Historical entries stay unchanged.',{operation:{enum:['add','rename','remove','classify']},activity:short,category:short,title:short},['operation','activity'],(a,c)=>{
 if(a.category&&!c.helpers.categories.includes(a.category))throw Error('Choose an existing category.');
 const day=get(c,'2000-01-01'),settings=parse(day.__settings__?.note),subs=settings.subs ||= {},areas=settings.activityAreas ||= {};
 const existing=Object.entries(subs).flatMap(([cat,names])=>Array.isArray(names)?names.filter(n=>String(n).toLowerCase()===a.activity.toLowerCase()).map(name=>({cat,name})):[]);
 if(a.operation==='add'){if(!a.category)throw Error('Which category should this activity use?');if(existing.length)throw Error('That activity already exists.');(subs[a.category] ||= []).push(a.activity);areas[a.activity.toLowerCase()]=a.category;}
 else{if(existing.length!==1)throw Error('Which configured activity do you mean?');const old=existing[0];subs[old.cat]=subs[old.cat].filter(n=>n!==old.name);delete areas[old.name.toLowerCase()];
 if(a.operation==='rename'){if(!a.title)throw Error('What should the new name be?');if(Object.values(subs).some(names=>Array.isArray(names)&&names.some(n=>n.toLowerCase()===a.title.toLowerCase())))throw Error('That name is already configured.');(subs[a.category || old.cat] ||= []).push(a.title);areas[a.title.toLowerCase()]=a.category || old.cat;}
 else if(a.operation==='classify'){if(!a.category)throw Error('Which category should it use?');(subs[a.category] ||= []).push(old.name);areas[old.name.toLowerCase()]=a.category;}}
 saveJSON(c,'2000-01-01','__settings__','settings',settings);
},{confirm:true});
tool('query_capabilities','List supported agent tools and their confirmation requirements.',{},[],()=>descriptions().map(t=>`${t.name}: ${t.description}`).join('\n'));

tool('gym_workout','Save inline exercises for a recorded Gym time range using the app workout format.',{date,start:clock,end:endClock,sessions:{type:'array',maxItems:50,items:session}},['date','start','end','sessions'],(a,c)=>{
 const slots=selectedSlots(a,c);if(slots.some(x=>!x.block || x.block.category!=='gym'))throw Error('Choose recorded Gym slots first.');
 for(const x of slots){if(x.block.note)c.confirm=true;get(c,x.date)[x.slot]={...x.block,note:'__gym_workout_v1__'+JSON.stringify({exercises:a.sessions})};}
});
tool('query_insights','Calculate recorded hours and category totals over a bounded inclusive date range.',{date,end_date:date},['date','end_date'],(a,c)=>{
 validDate(a.date);validDate(a.end_date);if(a.end_date<a.date || Date.parse(a.end_date)-Date.parse(a.date)>366*86400000)throw Error('Choose a date range of at most one year.');
 const totals={},days=[];for(const [date,day] of Object.entries(c.next))if(date>=a.date&&date<=a.end_date){let count=0;for(const [slot,b] of Object.entries(day))if(/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot)){totals[b.category]=(totals[b.category] || 0)+0.5;count++;}if(count)days.push(date);}
 return `${a.date} to ${a.end_date}: ${Object.values(totals).reduce((x,y)=>x+y,0)} recorded hours across ${days.length} days. `+Object.entries(totals).map(([cat,h])=>`${cat}: ${h}h`).join(', ')+'. Empty time is unknown; recorded entries can include plans.';
});

tool('objective_transfer','Transfer an objective between daily, short-term and long-term horizons, preserving its metadata.',{target:short,horizon:{enum:['daily','shortTermObjectives','longTermObjectives']},date},['target','horizon'],(a,c)=>{
 const o=objective(a,c);if(a.horizon==='daily')validDate(a.date);const destination=a.horizon==='daily'?a.date:'2000-01-01';if(destination===o.t.date&&a.horizon===o.t.horizon)return;
 const item=o.items.splice(o.t.index,1)[0];saveObjectives(o,c);const day=get(c,destination),settings=parse(day.__settings__?.note),raw=a.horizon==='daily'?day.__plan__?.note:settings[a.horizon];const items=(raw || '').split(/\r?\n/).map(c.helpers.parseObjective).filter(i=>i.text);
 if(items.some(i=>i.text.toLowerCase()===item.text.toLowerCase()))throw Error('That objective already exists in the destination.');items.push(item);
 if(a.horizon==='daily')day.__plan__={category:'plan',note:c.helpers.serializeObjectives(items)};else{settings[a.horizon]=c.helpers.serializeObjectives(items);saveJSON(c,destination,'__settings__','settings',settings);}
});
tool('reminder_update','Edit a saved reminder by exact title/date, preserving omitted fields.',{date,title:short,new_title:short,start:clock,lead:{type:'integer',minimum:0,maximum:10080}},['date','title'],(a,c)=>{
 validDate(a.date);const day=get(c,a.date),list=day.__event_reminders__?parse(day.__event_reminders__.note):[],found=list.filter(r=>r.title===a.title);if(found.length!==1)throw Error('Which reminder do you mean?');const item=found[0];if(a.new_title)item.title=a.new_title;if(a.start)item.start=a.start;if(a.lead!=null)item.lead=a.lead;item.notified=false;item.dismissed=false;item.id=randomUUID();saveJSON(c,a.date,'__event_reminders__','calendar_reminder',list,'Event reminders');
});
tool('settings_category','Create, rename or remove a custom category definition, matching the web settings format.',{operation:{enum:['add','rename','remove']},title:short,new_title:short,color:{type:'string',pattern:'^#[a-fA-F0-9]{6}$'}},['operation','title'],(a,c)=>{
 const day=get(c,'2000-01-01'),settings=parse(day.__settings__?.note),list=settings.customCats ||= [],found=list.filter(x=>x.label.toLowerCase()===a.title.toLowerCase());
 if(a.operation==='add'){if(found.length)throw Error('That category exists.');const id='c_'+a.title.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,24);if(id==='c_'||list.some(x=>x.id===id))throw Error('Choose a different category name.');list.push({id,label:a.title,color:a.color || '#6366f1'});}
 else{if(found.length!==1)throw Error('Which custom category do you mean?');if(a.operation==='remove')settings.customCats=list.filter(x=>x.id!==found[0].id);else{if(!a.new_title)throw Error('What should the new category name be?');if(list.some(x=>x.id!==found[0].id&&x.label.toLowerCase()===a.new_title.toLowerCase()))throw Error('That category name exists.');found[0].label=a.new_title;if(a.color)found[0].color=a.color;}}
 saveJSON(c,'2000-01-01','__settings__','settings',settings);
},{confirm:true});
tool('query_patterns','Read patterns calculated by the same analysis module as the web app; report sample sizes and no causal claims.',{date,days:{type:'integer',minimum:7,maximum:366}},['date'],(a,c)=>{
 validDate(a.date);const report=require('../../patterns').analyze(c.next,{today:a.date,range:a.days || 30,objectives:day=>(day.__plan__?.note || '').split(/\r?\n/).map(c.helpers.parseObjective).filter(i=>i.text)});
 const lines=[`${report.logged.length} recorded days; ${report.eligible} eligible days for comparisons.`,...Object.entries(report.categories).map(([cat,h])=>`${cat}: ${h}h`)];
 for(const x of report.comparisons)lines.push(`${x.label}: ${(x.unit==='%'?x.a*100:x.a).toFixed(1)}${x.unit} vs ${(x.unit==='%'?x.b*100:x.b).toFixed(1)}${x.unit} (${x.nA} and ${x.nB} days)`);
 if(!report.comparisons.length)lines.push('Not enough comparable days to report associations.');
 lines.push('Recorded activity is not measured attention. Associations are not causes. Missing time is unknown.');return lines.join('\n');
});
require('./memory.cjs').register(tool,{get,saveJSON,target,validDate});

function summary(a,c){
 const selected=c.catalog.find(t=>t.id===a.target),name=selected?.text || selected?.activity || a.title || a.activity || '';
 switch(a.type){
  case 'memory_remember':return `Remembered: ${a.title || a.text}`;
  case 'memory_update':return `Updated memory: ${name}`;
  case 'memory_forget':return `Forget memory: ${name}`;
  case 'commitment_create':return `Tracking “${a.title}”${a.due_date?' · due '+a.due_date:''}`;
  case 'commitment_update':return `Updated “${name}”${a.status?' · '+a.status:''}${a.due_date?' · due '+a.due_date:''}`;
  case 'activity_slice':return `Updated ${a.date}, ${a.start}–${a.end}${a.text!=null?' · '+a.text:''}`;
  case 'activity_copy':case 'activity_move_range':return `${a.type==='activity_copy'?'Copy':'Move'} ${a.date}, ${a.start}–${a.end} to ${a.destination_date}`;
  case 'note_create':return `Saved “${a.title}” to your notes`;
  case 'note_update':return `Updated “${name}”${a.title?' · new title: '+a.title:''}`;
  case 'note_delete':return `Delete note “${name}”`;
  case 'objective_update':return `Changed “${name}” to “${a.text}”`;
  case 'objective_move':case 'objective_transfer':return `Moved “${name}” to ${a.date || a.horizon}`;
  case 'gym_set':case 'gym_workout':return `Workout for ${a.date}${a.weight!=null?' · body weight '+a.weight+'kg':''}${a.sessions?' · '+a.sessions.map(s=>`${s.exercise}${s.sets?' '+s.sets+' sets':''}${s.reps?' × '+s.reps:''}${s.kg!=null?' at '+s.kg+'kg':''}`).join(', '):''}`;
  case 'reminder_set':case 'reminder_update':return `Reminder: ${a.new_title || a.title} · ${a.date}${a.start?' at '+a.start:''}${a.lead!=null?' · '+a.lead+' minutes before':''}`;
  case 'reminder_delete':return `Remove reminder “${a.title}” on ${a.date}`;
  case 'agent_preferences':return `Updated your check-in preferences${a.interval_hours?' · every '+a.interval_hours+' hours':''}${a.daily_limit?' · maximum '+a.daily_limit+' per day':''}${a.snooze_hours?' · snoozed '+a.snooze_hours+' hours':''}`;
  case 'project_create':return `Created note project “${a.project}”`;
  case 'project_update':return `Renamed project “${a.project}” to “${a.title}”`;
  case 'project_delete':return `Delete project “${a.project}” and move its notes to Unfiled`;
  default:return `${a.type.replaceAll('_',' ')}${a.date?' · '+a.date:''}${name?' · '+name:''}`;
 }
}

function summariesPlaceholder(c,text){(c.extraSummaries ||= []).push(text);}
function schema(base){const result=structuredClone(base),legacy=result.properties.actions.items;result.properties.actions.items={oneOf:[legacy,...Object.entries(tools).map(([type,t])=>({type:'object',additionalProperties:false,properties:{type:{const:type},...t.fields},required:['type',...t.required]}))]};return result;}
function descriptions(){const legacy=[{name:'activity_update',description:'Edit or move a whole existing activity target.'},{name:'activity_delete',description:'Delete a whole activity target.',confirmation:true},{name:'objective_add',description:'Add a daily or longer-term objective.'},{name:'objective_complete',description:'Set completion of an existing objective.'},{name:'objective_remove',description:'Delete an existing objective.',confirmation:true},{name:'rough_plan_add',description:'Add a dated rough plan.'},{name:'checkin',description:'Set energy/satisfaction ratings from 1 to 5.'},{name:'day_status',description:'Set holiday, travel, sick, off or clear day label.'},{name:'note_append',description:'Append text to an existing note target.'},{name:'query_day',description:'Read saved activity totals for one day.'},{name:'navigate',description:'Open an app screen or date via the web.'}];return [...legacy,...Object.entries(tools).map(([name,t])=>({name,description:t.description,confirmation:t.confirm}))];}
function plan({draft,days,catalog,range,helpers}){
 const c={next:structuredClone(days),catalog,helpers,confirm:false},summaries=[],answers=[],navigation=[];
 for(const a of draft.actions || []){
  const tool=tools[a.type];
  if(tool){const answer=tool.run(a,c);if(a.type.startsWith('query_'))answers.push(answer);else{summaries.push(summary(a,c));c.confirm ||= tool.confirm;}}
  else {const r=A.plan({draft:{actions:[a]},days:c.next,catalog,range,helpers});for(const p of r.patches){const day=get(c,p.date);if(p.after)day[p.slot]=p.after;else delete day[p.slot];}summaries.push(...r.summaries);answers.push(...r.answers);navigation.push(...r.navigation);if(['activity_delete','objective_remove'].includes(a.type))c.confirm=true;}
 }
 // Derived state belongs to writes or read-time reconciliation, never a query plan.
 if((draft.actions || []).some(a=>!a.type.startsWith('query_')&&a.type!=='navigate'))for(const patch of require('./memory.cjs').reconcile(c.next,helpers)){get(c,patch.date)[patch.slot]=patch.after;}
 const patches=[];for(const date of new Set([...Object.keys(days),...Object.keys(c.next)]))for(const slot of new Set([...Object.keys(days[date] || {}),...Object.keys(c.next[date] || {})])){const before=A.normal(days[date]?.[slot]),after=A.normal(c.next[date]?.[slot]);if(!A.same(before,after))patches.push({date,slot,before,after});}
 return {patches,summaries:[...summaries,...(c.extraSummaries || [])],answers,navigation,requiresConfirmation:c.confirm};
}
module.exports={VERSION,schema,descriptions,plan,tools};
