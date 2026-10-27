'use strict';
const {anchor}=require('./domain.cjs');
function checkin(rows,now=Date.now()){
  const time=anchor(Math.floor(now/1000)),hour=Number(time.local_time.slice(0,2));
  const today=rows.filter(r=>String(r.date).slice(0,10)===time.today);
  const hasSleep=today.some(r=>r.category==='sleep');
  const hasGoals=today.some(r=>r.start_time==='__plan__' && r.note?.trim());
  let text;
  if(hour===9)text=!hasSleep?'Morning! How long did you sleep last night?':!hasGoals?'Morning! Anything you’d like to get done today?':null;
  if(hour===14)text=!hasGoals?'Hey, how’s your day going? Any objectives you’d like to add?':'Hey, how are your objectives going? Anything you’d like to update?';
  if(hour===20)text=today.some(r=>r.start_time==='__reflect__' && r.note?.trim())?null:'How was your day? Anything you’d like to record or reflect on?';
  return text?{key:`${time.today}:${hour}`,text:text+'\n/pause to pause check-ins.'}:null;
}
module.exports={checkin};
