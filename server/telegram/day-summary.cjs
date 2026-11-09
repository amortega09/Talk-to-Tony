'use strict';
const dates=require('./dates.cjs');
const {helpers:{parseObjective}}=require('./domain.cjs');
const categoryLabels={sleep:'Sleep',work:'Work',exercise:'Exercise',gym:'Gym',food:'Food',learn:'Learn',social:'Social',chores:'Chores',travel:'Travel',relax:'Relax',other:'Other'};
function objectives(note){
  return (note || '').split(/\r?\n/).map(parseObjective)
    .map(item=>({...item,text:item.text.replace(/<!--[\s\S]*?-->/g,'').trim()})).filter(item=>item.text);
}
function query(text,today,conversation=[],focusDate=null){
  if(/\b(?:add|move|delete|change|replace|log|record|save|set|put)\b/i.test(text) && !/\b(?:what|which|have|has|was|is)\b/i.test(text))return null;
  if(/\b(?:notes?|ideas?|thoughts?|workout|gym|objectives?|reminders?)\b/i.test(text))return null;
  const checking=/\b(?:double[ -]?check|check again|are you sure)\b/i.test(text);
  if(checking){
    const previous=[...conversation].reverse().find(t=>t.query_kind&&dates.valid(t.discussion_date));
    if(previous)return {date:dates.resolve(text,today) || previous.discussion_date,kind:previous.query_kind};
    const previousText=[...conversation].reverse().find(t=>t.user&&!/\b(?:double[ -]?check|check again|are you sure)\b/i.test(t.user));
    return previousText?query(previousText.user,previousText.anchor_date || today,[],focusDate):null;
  }
  const gaps=/\b(?:free|empty|unfilled|unrecorded|unlogged|gaps?|missing|left to fill|still to fill|need to fill|haven.t (?:filled|logged|recorded))\b/i.test(text);
  if(!/\b(?:what|which|when|show|list|summari[sz]e|summary|status|review|any)\b/i.test(text))return null;
  if(!gaps&&!/\b(?:day|today|yesterday|diary|schedule|timetable|filled|logged|recorded)\b/i.test(text))return null;
  if(/\b(?:week|month)\b/i.test(text))return null;
  if(/\b(?:at|from|between)\s+\d/i.test(text))return null;
  const resolved=dates.resolve(text,today);
  if(/\b(?:today|yesterday|tomorrow)\b/i.test(text)&&(text.match(/\b(?:today|yesterday|tomorrow)\b/gi) || []).length>1)return null;
  if(!resolved&&dates.hasReference(text))return null;
  if(!resolved&&/\b\d{1,2}(?:st|nd|rd|th)\b/.test(text))return null;
  return {date:resolved || focusDate || today,kind:gaps?'gaps':'summary'};
}
function queryDate(text,today,conversation=[],focusDate=null){return query(text,today,conversation,focusDate)?.date || null;}
function label(date){return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
function gaps(rows,date){
 const filled=new Set(rows.filter(r=>r.date===date&&r.category&&/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(r.start_time)).map(r=>r.start_time));
 const ranges=[];let start=null;const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 for(let minute=0;minute<=1440;minute+=30){const empty=minute<1440&&!filled.has(clock(minute));if(empty&&start===null)start=minute;if(!empty&&start!==null){ranges.push(clock(start)+'–'+clock(minute));start=null;}}
 return ranges.length?[`For ${label(date)}, these times are unfilled:`,...ranges,'Unfilled means unrecorded, not necessarily free.']:[`Every time slot is filled for ${label(date)}.`];
}
function summarize(rows,date){
  const day=rows.filter(r=>r.date===date),timed=day.filter(r=>/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(r.start_time)).sort((a,b)=>a.start_time.localeCompare(b.start_time));
  const dayLabel=label(date);
  const spans=[];
  for(const row of timed){
    const mins=Number(row.start_time.slice(0,2))*60+Number(row.start_time.slice(3));
    const name=row.subcategory || row.sub || categoryLabels[row.category] || row.category;
    const previous=spans.at(-1);
    if(previous && previous.end===mins && previous.category===row.category && previous.name===name && previous.note===(row.note || ''))previous.end=mins+30;
    else spans.push({start:mins,end:mins+30,name,category:row.category,note:row.note || ''});
  }
  const clock=mins=>`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  const lines=[dayLabel,'',timed.length?'Recorded activities':`No activities recorded.`];
  for(const span of spans)lines.push(`${clock(span.start)}–${clock(span.end)} · ${span.name}`);
  if(timed.length)lines.push('',`${timed.length/2} ${timed.length===2?'hour':'hours'} recorded · unfilled time is unknown.`);
  const goals=objectives(day.find(r=>r.start_time==='__plan__')?.note);
  const active=goals.filter(item=>!item.completed&&!item.transferredTo);
  const completed=goals.filter(item=>item.completed&&!item.transferredTo);
  const moved=goals.filter(item=>item.transferredTo);
  if(active.length)lines.push('','Objectives',...active.map(item=>`○ ${item.text}`));
  if(completed.length)lines.push('','Completed',...completed.map(item=>`✓ ${item.text}`));
  if(moved.length)lines.push('','Moved to another day',...moved.map(item=>`→ ${item.text} · ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(item.transferredTo+'T12:00:00Z'))}`));
  return lines;
}
function needsEvidence(text){
  if(/\bwhat should\b/i.test(text))return false;
  return /\b(?:what|which|show|list|find|read|summari[sz]e|how much|how many|have i|did i|tell me)\b/i.test(text)&&/\b(?:saved|recorded|logged|diary|objectives?|goals?|notes?|workouts?|gym|sleep|reminders?|entries|slots?|settings)\b/i.test(text);
}
module.exports={query,queryDate,summarize,gaps,label,needsEvidence,objectives};
