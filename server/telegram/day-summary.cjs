'use strict';
function queryDate(text,today,conversation=[]){
  if(/\b(?:add|move|delete|change|replace|log|record|save|set)\b/i.test(text) && !/\b(?:what|which|have|has|was|is)\b/i.test(text))return null;
  if(/\b(?:double[ -]?check|check again|are you sure)\b/i.test(text)){
    const previous=[...conversation].reverse().find(turn=>turn.user && /\b(?:status|filled|logged|summari[sz]e|recorded)\b/i.test(turn.user));
    return previous?queryDate(previous.user,today):null;
  }
  if(!/\b(?:what|show|summari[sz]e|summary|status|review)\b/i.test(text) || !/\b(?:day|today|yesterday|diary|filled|logged|recorded)\b/i.test(text))return null;
  if(/\b(?:tomorrow|last week|week|month)\b/i.test(text))return null;
  const iso=text.match(/\b(\d{4}-\d{2}-\d{2})\b/);if(iso){const d=new Date(iso[1]+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso[1]?iso[1]:null;}
  if(/\b\d{1,2}(?:st|nd|rd|th)\b/i.test(text))return null;
  if(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text))return null;
  const day=new Date(today+'T12:00:00Z');if(/\byesterday\b/i.test(text))day.setUTCDate(day.getUTCDate()-1);
  return day.toISOString().slice(0,10);
}
function summarize(rows,date){
  const day=rows.filter(r=>r.date===date),timed=day.filter(r=>/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(r.start_time)).sort((a,b)=>a.start_time.localeCompare(b.start_time));
  const label=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  const spans=[];
  for(const row of timed){
    const mins=Number(row.start_time.slice(0,2))*60+Number(row.start_time.slice(3));
    const name=row.subcategory || row.sub || row.category;
    const previous=spans.at(-1);
    if(previous && previous.end===mins && previous.category===row.category && previous.name===name && previous.note===(row.note || ''))previous.end=mins+30;
    else spans.push({start:mins,end:mins+30,name,category:row.category,note:row.note || ''});
  }
  const clock=mins=>`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  const lines=[timed.length?`Here’s what’s saved for ${label}:`:`No activities are saved for ${label}.`];
  for(const span of spans)lines.push(`${clock(span.start)}–${clock(span.end)} · ${span.name}`);
  const goals=day.find(r=>r.start_time==='__plan__')?.note;
  if(goals)lines.push('Objectives:\n'+goals.slice(0,1500));
  if(timed.length)lines.push(`${timed.length/2} hours recorded. Unfilled time is still unknown.`);
  return lines;
}
module.exports={queryDate,summarize};
