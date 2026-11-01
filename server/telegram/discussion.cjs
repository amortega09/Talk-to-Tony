'use strict';
const dates=require('./dates.cjs');
function resolve(text,time,focus={},reference=null,pending=null,now=Date.now()){
 const explicit=dates.resolve(text,time.today);
 if(explicit)return {date:explicit,basis:'explicit'};
 const pendingDate=pending?.data?.discussionDate || pending?.data?.draft?.items?.[0]?.date || pending?.data?.review?.patches?.find(p=>p.date!=='2000-01-01')?.date;
 if(dates.valid(pendingDate))return {date:pendingDate,basis:'pending_draft'};
 if(dates.valid(reference?.discussion_date))return {date:reference.discussion_date,basis:'reply'};
 if(dates.valid(focus.focusDate)&&Date.parse(focus.expiresAt)>now)return {date:focus.focusDate,basis:'conversation'};
 return {date:time.today,basis:'today',expired:!!focus.focusDate&&focus.focusDate!==time.today};
}
function multiple(text,anchor){
 const mentions=dates.normalize(text).match(/\b(?:today|yesterday|tomorrow|\d{4}-\d{2}-\d{2}|(?:(?:last|this|next)\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?)\b/gi) || [];
 return new Set(mentions.map(x=>dates.resolve(x,anchor)).filter(Boolean)).size>1;
}
function checkDraft(draft,discussion,text=''){
 // An explicitly multi-day request is validated by the normal per-action planner.
 if(multiple(text,discussion.date))return null;

 const errors=[];
 for(const item of draft.items || []){
  if(item.date!==discussion.date)errors.push(item.date);
  if(item.end_date!==item.date && !(item.end_date===dates.shift(item.date,1)&&item.end<item.start))errors.push(item.end_date);
 }
 for(const r of draft.reflections || [])if(r.date!==discussion.date)errors.push(r.date);
 const scoped=new Set(['query_slot','query_day','query_objectives','query_reflection','query_gym','query_reminders','activity_slice','checkin','day_status','gym_set','reflection_set','rough_plan_add','objective_add']);
 for(const a of draft.actions || [])if(scoped.has(a.type)&&a.date&&a.date!==discussion.date)errors.push(a.date);
 return errors.length?`We’re discussing ${discussion.date}, but I interpreted a different date. Please repeat the day and time so I can save it correctly.`:null;
}
// The LLM supplies the operation and times. Code supplies its single diary date.
function bindDraft(draft,discussion,text=''){
 const next=structuredClone(draft);if(multiple(text,discussion.date))return next;
 for(const item of next.items || []){
   if(!dates.valid(item.date)||!dates.valid(item.end_date))continue;
   const overnight=item.end_date===dates.shift(item.date,1)&&item.end<item.start;
   if(item.end_date!==item.date&&!overnight)continue;
   item.date=discussion.date;item.end_date=overnight?dates.shift(discussion.date,1):discussion.date;
 }
 for(const r of next.reflections || [])if(dates.valid(r.date))r.date=discussion.date;
 const scoped=new Set(['query_slot','query_day','query_objectives','query_reflection','query_gym','query_reminders','activity_slice','checkin','day_status','gym_set','reflection_set','rough_plan_add','objective_add','reminder_set']);
 for(const a of next.actions || [])if(scoped.has(a.type)&&dates.valid(a.date))a.date=discussion.date;
 return next;
}
module.exports={resolve,checkDraft,bindDraft};
