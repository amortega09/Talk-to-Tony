'use strict';
const Ajv = require('ajv');
const contract = require('./voice-contract.json');
const actions = require('../../voice-actions');
const entries = require('../../voice-draft');
const range = require('../../event-range');
const history = require('../../voice-context');
const formats = require('./formats.cjs');
const schemaCheck = new Ajv({strict:false, allowUnionTypes:true}).compile(contract.schema);
class UserError extends Error {
  constructor(message, code='invalid_request') { super(message); this.code=code; }
}
// Mirrors the base app serializers. Differential tests protect these wire formats.
function parseObjective(line) {
  let raw=(line || '').trim();
  const m=raw.match(/\s*<!--day-link:([^:>]+):(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2})?-->\s*$/);
  const metadata=m?{linkId:m[1],originDate:m[2] || '',transferredTo:m[3] || ''}:{linkId:'',originDate:'',transferredTo:''};
  if(m)raw=raw.slice(0,m.index).trim();
  const remainder=raw.replace(/^[•\-*\d+.\s]*/,''), check=remainder.match(/^\[([ xX])\]\s*(.*)$/);
  return {completed:!!check && check[1].toLowerCase()==='x',text:check?check[2]:remainder,...metadata};
}
function serializeObjectives(items) {
  return items.map(i=>`${i.completed?'[x]':'[ ]'} ${i.text.trim()}${i.linkId?` <!--day-link:${i.linkId}:${i.originDate || ''}:${i.transferredTo || ''}-->`:''}`).join('\n');
}
function roughPlans(day) {
  const note=day?.__rough_plan__?.note || ''; if(!note)return [];
  try { const p=JSON.parse(note); if(Array.isArray(p))return p.map(String).map(s=>s.trim()).filter(Boolean); } catch {}
  return note.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}
const helpers={parseObjective,serializeObjectives,roughPlans,roughPlanBlock:plans=>plans.length?{category:'calendar_plan',note:JSON.stringify(plans),sub:'Rough plan'}:null,categories:entries.categories};
function anchor(timestamp) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(timestamp*1000)).map(p=>[p.type,p.value]));
  return {today:`${p.year}-${p.month}-${p.day}`,local_time:`${p.hour}:${p.minute}`,timezone:'Europe/London'};
}
function normalizeTimes(text) {
  const meridiem='(?:a\\.?m\\.?|p\\.?m\\.?)\\b';
  return text.replace(new RegExp('\\b([0-2]?\\d)\\.([0-5]\\d)(?=\\s*'+meridiem+')','gi'),'$1:$2')
    .replace(new RegExp('\\b([0-2]?\\d)\\.([0-5]\\d)(?=\\s*(?:to|until|through)\\s+\\d{1,2}(?:[.:]\\d{2})?\\s*'+meridiem+')','gi'),'$1:$2')
    .replace(new RegExp('(\\b(?:at|from|until|to|by)\\s+)([0-2]?\\d)([0-5]\\d)(?=\\s*(?:'+meridiem+'|this\\s+(?:morning|afternoon|evening)\\b))','gi'),'$1$2:$3')
    .replace(/\b12:([0-5]\d)\s*a\.?m\.?\b/gi,'00:$1');
}
function validate(draft) {
  if(!schemaCheck(draft) || JSON.stringify(draft).length>50000)throw new UserError('The AI returned an invalid draft. Please try again.','model_invalid');
  for(const q of draft.questions)if(q.length>1000)throw new UserError('The AI response was too long.','model_invalid');
  for(const item of [...draft.items,...draft.reflections,...(draft.actions || [])]) {
    for(const value of Object.values(item))if(typeof value==='string' && value.length>4000)throw new UserError('The AI response was too long.','model_invalid');
    for(const k of ['date','end_date'])if(item[k]!=null && !actions.dateOK(item[k]))throw new UserError('Please specify a valid date.');
  }
  if(draft.actions?.length && (draft.items.length || draft.reflections.length))throw new UserError('Please do existing-record changes and new entries separately.');
  return draft;
}
function alignSleep(draft,text,today) {
  if(!actions.dateOK(today) || /\b(?:yesterday|overnight|last night)\b|\d+\s*(?:days?|hours?)\b|\d{4}-\d{2}-\d{2}/i.test(text))return draft;
  const wake=text.match(/\btoday\b.*?\bwoke(?: up)? at (\d{1,2}):(\d{2})\s*(am|a\.m\.)/i);
  const bed=text.match(/\b(?:went to sleep|fell asleep|went to bed|slept) (?:at|from) (0?[0-5]):([0-5]\d)(?!\d|\s*p\.?m)/i);
  if(!wake || !bed)return draft;
  const start=`${bed[1].padStart(2,'0')}:${bed[2]}`,end=`${String(Number(wake[1])%12).padStart(2,'0')}:${wake[2]}`;
  if(start<end)for(const i of draft.items)if(i.category==='sleep' && i.start===start && i.end===end && i.end_date===today)i.date=today;
  return draft;
}
function context(rows,text,time,conversation=[]) {
  const days=actions.daysFromRows(rows), all=actions.targets(days,helpers);
  const words=text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const score=t=>(t.date===time.today?3:0)+words.filter(w=>w.length>2 && (t.activity || t.text || '').toLowerCase().includes(w)).length*5;
  let budget=12000;
  const targets=all.sort((a,b)=>score(b)-score(a)).filter(t=>{budget-=JSON.stringify(t).length;return budget>=0;}).slice(0,80);
  let formatBudget=7000;
  const activityFormats=formats.vocabulary(rows).filter(f=>f.label.length<=150&&f.note.length<=300).sort((a,b)=>score({activity:b.label})-score({activity:a.label})).filter(f=>{formatBudget-=JSON.stringify(f).length;return formatBudget>=0;}).slice(0,80);
  return {...time,viewed_date:time.today,conversation:conversation.slice(-3),app:{screen:'telegram',selected_target:null,targets,targets_limited:targets.length<all.length,activity_formats:activityFormats},diary:history.select({rows,complete:true,source:'cloud'},{today:time.today,viewedDate:time.today,transcript:text,maxChars:14000})};
}
function plan(draft,rows,catalog,options={}) {
  validate(draft);
  if(draft.questions.length)return {patches:[],summaries:[],answers:[],navigation:[],questions:[draft.questions[0]]};
  const days=actions.daysFromRows(rows); let result;
  const resolved=new Map();
  for(const item of [...draft.items,...(draft.actions || []).filter(a=>a.type==='activity_update' && a.activity)]){
    const match=formats.resolve(item.activity,item.category || catalog.find(t=>t.id===item.target)?.category,rows,options);
    if(match.question)return {patches:[],summaries:[],answers:[],navigation:[],questions:[match.question],formatProposals:match.proposal?[match.proposal]:[]};
    resolved.set(item,match.format);
  }
  try {
    if(draft.actions?.length){
      result=actions.plan({draft,days,catalog,range,helpers});
      for(const action of draft.actions){const f=resolved.get(action);if(!f)continue;
        for(const patch of result.patches)if(patch.after && patch.after.sub===action.activity){patch.after={...patch.after,category:f.category,sub:f.sub,note:patch.after.note || f.note};}
      }
    }
    else if(draft.items.length || draft.reflections.length) {
      const p=entries.plan(draft,range); if(p.errors.length)throw new UserError(p.errors[0]);
      const next=structuredClone(days), summaries=[];
      for(const i of draft.items){const f=resolved.get(i);summaries.push(`${i.date} ${i.start} → ${i.end_date} ${i.end}: ${f.label} (${f.category})${i.note?' · '+i.note:''}`);}
      for(const item of draft.items){const f=resolved.get(item),interval=range.build(item.date,item.start,item.end_date,item.end);for(const d of interval.days)for(const slot of d.slots){
        const existing=days[d.date]?.[slot];
        const note=item.note || (existing && existing.category===f.category && formats.key(existing.sub)===formats.key(f.sub)?existing.note:'') || f.note;
        (next[d.date] ||= {})[slot]={category:f.category,sub:f.sub,note};
        if(existing)summaries.push(`Replace ${d.date} ${slot}: ${existing.sub || existing.category}`);
      }}
      for(const r of p.reflections){const day=next[r.date] ||= {}, old=day.__reflect__?.note || '';day.__reflect__={category:'reflection',note:old===r.text?old:[old,r.text].filter(Boolean).join('\n\n')};summaries.push(`Reflection ${r.date}: ${r.text}`);}
      const patches=[];
      for(const [date,day] of Object.entries(next))for(const [slot,after] of Object.entries(day))if(!actions.same(days[date]?.[slot],after))patches.push({date,slot,before:actions.normal(days[date]?.[slot]),after:actions.normal(after)});
      result={patches,summaries,answers:[],navigation:[]};
    } else result={patches:[],summaries:[],answers:[],navigation:[]};
  } catch(e) { if(e instanceof UserError)throw e; throw new UserError(e.message); }
  const versions=new Map(rows.map(r=>[`${r.date}/${r.start_time}`,r.version]));
  result.patches=result.patches.map(p=>({...p,version:versions.get(`${p.date}/${p.slot}`) || null}));
  if(result.patches.length>500)throw new UserError('Split this into smaller changes.');
  return {...result,questions:[],formatVersion:1};
}
function control(text,time) {
  const t=text.trim().replace(/^\/(save|cancel|undo|status|help|unlink)(?:@\w+)?$/i,'$1').toLowerCase().replace(/[.!?]+$/,'');
  if(['status','help','unlink'].includes(t))return {control:t};
  return actions.localCommand(t,{today:time.today,viewedDate:time.today,shift:range.shift});
}
module.exports={UserError,helpers,anchor,normalizeTimes,validate,alignSleep,context,plan,control,contract};
