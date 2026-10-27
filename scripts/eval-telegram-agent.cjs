'use strict';
// Synthetic fixtures only: never read or transmit the user's diary.
const {providers}=require('../server/telegram/providers.cjs');const D=require('../server/telegram/domain.cjs');
const rows=['09:00','09:30'].map(start_time=>({date:'2026-10-27',start_time,category:'work',subcategory:'Lab',note:'Synthetic bench protocol',version:'1:1'}));
rows.push({date:'2000-01-01',start_time:'__note__synthetic-note',category:'note',note:JSON.stringify({id:'synthetic-note',title:'Previous idea',body:'Synthetic original note',projectId:'',deleted:false})},{date:'2026-10-27',start_time:'__plan__',category:'plan',note:'[ ] Finish synthetic draft'});
const cases=[
 ['exact-read','On 27 October 2026 tell me exactly what is recorded from 9am to 10am, including notes.',['query_slot']],
 ['partial-edit','On 27 October 2026 change only 9:30am to 10am of Lab: set its note to Reviewed synthetic sample.',['activity_slice']],
 ['idea','Save an idea called Synthetic idea saying Try another approach.',['note_create']],
 ['move','Move the Lab activity on 27 October 2026 to 26 October 2026 at the same times.',['activity_update','activity_move_range']],
 ['rating','Set my energy to four out of five for 27 October 2026.',['checkin']],
 ['objective','Add Read synthetic paper to my objectives for 27 October 2026.',['objective_add']],
 ['preferences','Set check-ins every four hours, quiet hours 10pm to 9am, maximum three check-ins daily.',['agent_preferences']],
 ['gym','For 27 October 2026 log body weight 80kg and a gym session: Bench press, three sets of eight reps at 40kg.',['gym_set']],
 ['find-note','Find notes containing Synthetic.',['query_notes']],
 ['reminder','Remind me on 27 October 2026 at 2pm to Call synthetic test, with a 15-minute lead time.',['reminder_set']],
 ['append-note','Append Another synthetic thought to my note Previous idea.',['note_append','note_update']],
 ['move-objective','Move Finish synthetic draft from my objectives for 27 October 2026 to 28 October 2026.',['objective_move']],
 ['reflection-read','Read my reflection for 27 October 2026.',['query_reflection']],
 ['gym-read','What gym sessions are saved for 27 October 2026?',['query_gym']],
 ['mixed','Add Sleep from 10am to 10:30am on 27 October 2026, and save a note titled Combined synthetic test with body Another approach.',['note_create']],
 ['followup','Actually, move the Lab entry we just discussed to yesterday.',['activity_move_range','activity_update'],true]
];
(async()=>{
 const p=providers(),results=[];
 for(let i=0;i<cases.length;i+=2)await Promise.all(cases.slice(i,i+2).map(async([id,text,expected,followup])=>{
  const started=Date.now();let result;
  try{const ctx=D.context(rows,text,{today:'2026-10-27',local_time:'12:00',timezone:'Europe/London'},followup?[{user:'Record Lab on 27 October 2026 from 9am to 10am.',assistant:'Added Lab on 27 October, 09:00–10:00.'},{recent_changes:[{id:'synthetic-action',state:'current',patches:rows.filter(r=>r.start_time==='09:00'||r.start_time==='09:30').map(r=>({date:r.date,slot:r.start_time,after:{category:r.category,sub:r.subcategory,note:r.note}}))}]}]:[]);if(followup)ctx.discussion_date='2026-10-27';const draft=await p.interpret(text,ctx),review=D.plan(draft,rows,ctx.app.targets,{strict:true});const types=(draft.actions || []).map(a=>a.type);
    let correct=true;
    if(id==='exact-read')correct=review.answers.some(a=>a.includes('Synthetic bench protocol'));
    if(id==='partial-edit')correct=review.patches.length===1&&review.patches[0].slot==='09:30'&&review.patches[0].after?.note==='Reviewed synthetic sample';
    if(id==='rating')correct=review.patches.some(p=>p.slot==='__checkin__'&&JSON.parse(p.after.note).energy===4);
    if(id==='move'||id==='followup')correct=review.patches.filter(p=>p.date==='2026-10-26'&&p.after).length===2&&review.patches.filter(p=>p.date==='2026-10-27'&&!p.after).length===2;
    if(id==='gym')correct=review.patches.some(p=>p.slot==='__gym__'&&JSON.parse(p.after.note).weight===80);
    if(id==='mixed')correct=review.patches.some(p=>p.slot==='10:00'&&p.after.category==='sleep')&&review.patches.some(p=>p.slot.startsWith('__note__'));
    result={id,pass:correct&&types.some(t=>expected.includes(t))&&!review.questions.length,types,patches:review.patches.length,ms:Date.now()-started};}
  catch(e){result={id,pass:false,error:e.code || e.message,ms:Date.now()-started};}
  results.push(result);console.log(JSON.stringify(result));
 }));
 const passed=results.filter(r=>r.pass).length;const times=results.map(r=>r.ms).sort((a,b)=>a-b);console.log(JSON.stringify({passed,total:results.length,median_ms:times[Math.floor(times.length/2)],p90_ms:times[Math.floor(times.length*.9)]}));process.exitCode=passed===results.length?0:1;
})().catch(()=>{console.error('Synthetic evaluation could not run.');process.exitCode=1;});
