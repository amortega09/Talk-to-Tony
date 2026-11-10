'use strict';
// Live model evaluation using invented data only; no database or Telegram writes.
const assert=require('node:assert/strict'),D=require('../server/telegram/domain.cjs'),A=require('../voice-actions'),{providers}=require('../server/telegram/providers.cjs');
const date='2026-11-10',workCompanies=[{name:'Atlas',projects:['Research','Review draft']},{name:'Orion',projects:['Build','Research']}];
const rows=[{date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({workHierarchyVersion:1,workCompanies,workProjects:['Research','Build','Review draft']})},
 ...['09:00','09:30'].map(start_time=>({date,start_time,category:'work',subcategory:'Meeting',note:'Synthetic protocol',details:{company:'Atlas',project:'Research'}})),
 ...['14:00','14:30'].map(start_time=>({date,start_time,category:'exercise',subcategory:'Gym',note:'__gym_workout_v1__'+JSON.stringify({exercises:[{exercise:'Bench press',sets:3,reps:8,kg:40}]})})),
 {date,start_time:'__plan__',category:'plan',note:'[ ] Synthetic objective <!--day-link:fixture::-->'}];
const time={today:date,local_time:'16:00',timezone:'Europe/London'};
const cases=[
 ['new-work','Log focused work today from 10am to 11am for company Atlas on project Research.',r=>r.patches.length===2&&r.patches.every(p=>p.after?.details?.company==='Atlas'&&p.after.details.project==='Research')],
 ['individual-task','Log work today from 11am to 11:30am for company Atlas on task Review draft.',r=>r.patches.length===1&&r.patches[0].after?.details?.project==='Review draft'],
 ['ambiguous-company','Log a meeting today from 11am to noon on project Research. I have not chosen which company.',r=>!r.patches.length&&r.questions.length===1],
 ['wrong-company','Log a meeting today 11am to noon for Atlas on project Build, which is currently saved under Orion. Do not create any companies or projects.',r=>!r.patches.length&&r.questions.length===1],
 ['edit-work','Change the company and project of my saved meeting today from 9am to 10am to Orion, project Build. Keep the time and note.',r=>r.patches.length===2&&r.patches.every(p=>p.after?.details?.company==='Orion'&&p.after.details.project==='Build'&&p.after.note==='Synthetic protocol')],
 ['move-work','Move my Atlas Research meeting today from 9am to 10am to tomorrow at the same times, preserving its company, project and note.',r=>r.patches.filter(p=>p.after).length===2&&r.patches.filter(p=>p.after).every(p=>p.date==='2026-11-11'&&p.after.details?.company==='Atlas'&&p.after.details.project==='Research')],
 ['mixed-travel','Log travel today from 12pm to 1pm to London using both train and bus.',r=>r.patches.length===2&&r.patches.every(p=>p.after?.category==='travel'&&p.after.details?.modes?.includes('Train')&&p.after.details.modes.includes('Bus')&&p.after.details.destination==='London')],
 ['gym-read','What exercises, sets, reps and weights did I log at the gym today?',r=>!r.patches.length&&r.answers.some(a=>a.includes('Bench press')&&a.includes('40kg'))],
 ['gym-edit','For my saved Gym today from 2pm to 3pm, replace its exercises with Squat, 3 sets of 5 reps at 60kg.',r=>r.patches.length===2&&r.patches.every(p=>JSON.parse(p.after.note.slice('__gym_workout_v1__'.length)).exercises[0].exercise==='Squat')],
 ['exact-read','Read exactly what I saved today from 9am to 10am, including company, project and note.',r=>!r.patches.length&&r.answers.some(a=>a.includes('Atlas')&&a.includes('Research')&&a.includes('Synthetic protocol'))],
 ['health','Log a dentist appointment today from 3pm to 3:30pm.',r=>r.patches.length===1&&r.patches[0].after?.category==='health'],
 ['new-company-and-work','Add company Boreal and project Launch under Boreal, then log work for Boreal on Launch today from 4pm to 4:30pm.',r=>r.patches.some(p=>p.slot==='16:00'&&p.after?.details?.company==='Boreal'&&p.after.details.project==='Launch')&&r.patches.some(p=>p.slot==='__settings__')]
];
(async()=>{const p=providers(),results=[];for(let i=0;i<cases.length;i+=2){await Promise.all(cases.slice(i,i+2).map(async([id,text,check])=>{
 const started=Date.now();let draft,review;
 try{const ctx=D.context(rows,text,time);draft=await p.interpret(text,ctx);review=D.plan(draft,rows,ctx.app.targets,{strict:true});assert.ok(check(review));results.push({id,pass:true,ms:Date.now()-started});console.log(JSON.stringify(results.at(-1)));}
 catch(e){const result={id,pass:false,error:e.message,code:e.code,draft,review,ms:Date.now()-started};results.push(result);console.log(JSON.stringify(result));}
}));if(results.some(r=>r.code==='provider_billing'||r.code==='provider_auth'))break;}const summary={passed:results.filter(r=>r.pass).length,total:results.length};console.log(JSON.stringify(summary));process.exitCode=summary.passed===summary.total?0:1;})().catch(e=>{console.error(e.message);process.exitCode=1;});
