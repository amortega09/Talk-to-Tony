'use strict';
// Telegram-only adapter for the app's category/subcategory/note representation.
const labels={sleep:'Sleep',work:'Work',exercise:'Exercise',gym:'Gym',food:'Food',learn:'Learn',social:'Social',chores:'Chores',travel:'Travel',relax:'Relax',other:'Other'};
const key=s=>String(s || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function vocabulary(rows){
  let settings={};try{settings=JSON.parse(rows.find(r=>r.start_time==='__settings__')?.note || '{}');}catch{}
  const choices=[];
  const custom=Array.isArray(settings.customCats)?settings.customCats:[];
  function add(label,category,sub,note='',priority=0){
    if(!label || !labels[category])return;
    const override=settings.activityAreas?.[key(label)];
    choices.push({label,category:labels[override]?override:category,sub,note,priority});
  }
  for(const [cat,names] of Object.entries(settings.subs || {}))if(Array.isArray(names))for(const name of names)if(typeof name==='string')add(name,cat,name,'',2);
  for(const r of rows){
    if(!/^\d{2}:\d{2}$/.test(r.start_time))continue;
    const sub=r.subcategory || '',note=r.note || '';
    if(r.category==='gym'){add('Gym','gym','','',3);continue;}
    const legacy=custom.find(c=>c.id===r.category);
    if(legacy && !sub){add(legacy.label,'other',legacy.label);continue;}
    if(sub)add(sub,legacy?'other':r.category,sub);
    else if(note && !note.startsWith('[GCal]') && !note.startsWith('__'))add(note,r.category,'',note);
  }
  for(const c of custom)if(typeof c.label==='string'){const builtin=Object.entries(labels).find(([,label])=>key(label)===key(c.label));if(!builtin)add(c.label,'other',c.label,'',2);}
  // The category itself is an app option, never a redundant subcategory.
  for(const [category,label] of Object.entries(labels))add(label,category,'','',3);
  const groups=new Map();
  for(const c of choices){const k=key(c.label);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
  return [...groups.values()].flatMap(group=>{
    const max=Math.max(...group.map(c=>c.priority));const candidates=group.filter(c=>c.priority===max),unique=new Map();
    for(const c of candidates){const k=JSON.stringify([c.category,key(c.sub),c.note]);const entry=unique.get(k);if(entry)entry.count++;else unique.set(k,{...c,count:1});}
    return [...unique.values()].sort((a,b)=>b.count-a.count).map(({priority,count,...c})=>c);
  });
}
function resolve(name,category,rows,{strict=false,allowedNew=[],selectedCategory}={}){
  let matches=vocabulary(rows).filter(c=>key(c.label)===key(name));
  if(matches.length>1 && selectedCategory)matches=matches.filter(c=>c.category===selectedCategory);
  if(matches.length===1)return {format:matches[0]};
  if(matches.length>1)return {question:`“${name}” has multiple saved formats. Reply with its category (${[...new Set(matches.map(c=>c.category))].join(' or ')}), or give a different existing name.`};
  if(strict && !allowedNew.some(n=>key(n)===key(name)))return {question:`Create “${name}” as a new activity in ${labels[category] || category}? Reply yes, or give its existing name.`,proposal:name};
  return {format:{label:name,category,sub:name,note:''}};
}
module.exports={vocabulary,resolve,key};
