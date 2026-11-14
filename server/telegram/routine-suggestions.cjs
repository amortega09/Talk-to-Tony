'use strict';
const M=require('../../activity-model');
const DAY=86400000;
const weekend=date=>[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
const clean=value=>String(value || '').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
// Evidence only: no model call, persistence, inferred times, or copied notes.
function suggestion(rows,time){
 const minute=Number(time.local_time.slice(3,5)),slot=time.local_time.slice(0,2)+':'+(minute<30?'00':'30');
 if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot))return null;
 const atypical=new Set(rows.filter(r=>r.start_time==='__day_status__'&&(r.note || r.sub || r.subcategory)).map(r=>String(r.date).slice(0,10)));
 if(atypical.has(time.today)||rows.some(r=>String(r.date).slice(0,10)===time.today&&r.start_time===slot))return null;
 const today=Date.parse(time.today+'T12:00:00Z'),observed=new Set(),groups=new Map();
 for(const row of rows){
  const date=String(row.date).slice(0,10),age=(today-Date.parse(date+'T12:00:00Z'))/DAY;
  if(atypical.has(date)||row.start_time!==slot||!Number.isInteger(age)||age<1||age>28||weekend(date)!==weekend(time.today)||/^\[GCal\]/.test(row.note || ''))continue;
  observed.add(date);
  let b;try{b=M.normalize(row,{history:true});}catch{continue;}
  if(b.details?.needs_review||!M.labels[b.category]||b.category==='other')continue;
  const activity=clean(b.sub || b.subcategory || M.labels[b.category]);
  if(!activity)continue;
  const d=b.details || {};
  if(b.category==='work'&&(!d.company||!d.project))continue;
  const parts=[activity];
  if(b.category==='work')parts.push(clean(d.company)+' / '+clean(d.project));
  if(b.category==='health'&&d.destination)parts.push(clean(d.destination));
  if(b.category==='travel'){
   if(d.modes?.length)parts.push(d.modes.join(' + '));
   if(d.destination)parts.push('to '+clean(d.destination));
  }
  const label=parts.join(' · '),id=JSON.stringify([b.category,activity,d.company || '',d.project || '',d.modes || [],d.destination || '']);
  if(!groups.has(id))groups.set(id,{label,dates:new Set(),latest:date});
  const group=groups.get(id);group.dates.add(date);if(date>group.latest)group.latest=date;
 }
 const candidates=[...groups.values()].filter(g=>g.dates.size>=3&&g.dates.size/observed.size>=0.6&&today-Date.parse(g.latest+'T12:00:00Z')<=7*DAY)
  .sort((a,b)=>b.dates.size-a.dates.size||b.latest.localeCompare(a.latest)||a.label.localeCompare(b.label));
 if(!candidates.length)return null;
 const best=candidates[0];
 return {label:best.label,slot,matchingDays:best.dates.size,observedDays:observed.size,dayType:weekend(time.today)?'weekend days':'weekdays'};
}
module.exports={suggestion};
