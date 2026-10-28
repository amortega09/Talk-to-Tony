'use strict';
const {anchor}=require('./domain.cjs');
function contactWindow(now=Date.now(),prefs={},state={}){
 const time=anchor(Math.floor(now/1000)),hour=Number(time.local_time.slice(0,2)),start=prefs.quiet_end ?? 9,end=prefs.quiet_start ?? 22;
 const inQuiet=start<end?(hour<start||hour>=end):(hour<start&&hour>=end);
 if(prefs.enabled===false||Date.parse(prefs.snooze_until || '')>now||inQuiet||start===end)return null;
 if((state.day===time.today?(state.count || 0):0)>=(prefs.daily_limit || 4))return null;
 if(state.lastUserAt&&now-Date.parse(state.lastUserAt)<45*60000)return null;
 if(state.day===time.today&&state.unanswered>=2)return null;
 return {time,hour,start};
}
function checkin(rows,now=Date.now(),prefs={},state={},options={}){
 const available=contactWindow(now,prefs,state);if(!available)return null;
 const {time,hour,start}=available,interval=prefs.interval_hours || 3,window=Math.floor(((hour-start+24)%24)/interval);
 if(((hour-start+24)%24)%interval!==0)return null;
 const today=rows.filter(r=>String(r.date).slice(0,10)===time.today);
 const hasSleep=today.some(r=>r.category==='sleep'),goals=today.find(r=>r.start_time==='__plan__')?.note || '';
 const pending=goals.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^\[x\]/i.test(x));
 const reflection=today.some(r=>r.start_time==='__reflect__'&&r.note?.trim());
 let topic,text,record;
 const next=options.priorities?.find(x=>x.record.dueDate<=time.today||x.record.priority==='high'||x.reason.includes('high priority'));
 if(hour<12&&!hasSleep){topic='sleep';text='Morning! How did you sleep? Want to add it to your diary?';}
 else if(next&&state.lastTopic!=='commitment'){topic='commitment';record=next.record;text=`How’s “${record.title}” going?${record.nextAction?' You mentioned '+record.nextAction.slice(0,200)+'.':''} Want to update it?`;}
 else if(!goals&&hour<15){topic='objectives';text='How’s your day going? Anything you’d like to get done today?';}
 else if(pending.length&&state.lastTopic!=='objectives'){topic='objectives';const name=pending[0].replace(/^\[ \]\s*/, '').replace(/<!--.*?-->/g,'').slice(0,120);text=`How’s “${name}” going? Anything you’d like to update?`;}
 else if(hour>=18&&!reflection){topic='reflection';text='How has today felt? Anything on your mind you’d like to keep?';}
 else {topic=state.lastTopic==='ideas'?'diary':'ideas';text=topic==='ideas'?'Any ideas or thoughts worth keeping today? You can just send a quick voice note.':'How’s the day unfolding? Anything since we last spoke you’d like to add to your diary?';}
 if(topic===state.lastTopic && state.day===time.today)return null;
 return {key:`${time.today}:${start}:${interval}:${window}`,topic,text,...(record?{record}: {})};
}
function dueReminders(rows,now=Date.now()){
 const {localInstant}=require('./dates.cjs'),due=[];
 for(const row of rows){if(row.start_time!=='__event_reminders__')continue;let list;try{list=JSON.parse(row.note);}catch{continue;}if(!Array.isArray(list))continue;
 for(const item of list){if(item.dismissed || !item.id || !item.title)continue;const when=localInstant(row.date,item.start);if(when===null)continue;const dueAt=when-Math.max(0,Number(item.lead)||0)*60000;if(now>=dueAt&&now-dueAt<20*60000)due.push({key:`${row.date}:${item.id}`,text:`A little reminder: ${String(item.title).slice(0,2000)} · ${row.date}, ${item.start}`,validUntil:Math.floor((dueAt+20*60000)/1000)});}
 }
 return due;
}
module.exports={checkin,dueReminders,contactWindow};
