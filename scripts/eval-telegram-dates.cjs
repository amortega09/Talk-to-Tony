'use strict';
// Only invented fixtures are sent to the model. No database access.
const assert=require('node:assert/strict'),D=require('../server/telegram/domain.cjs'),{providers}=require('../server/telegram/providers.cjs'),discussion=require('../server/telegram/discussion.cjs');
const rows=[{date:'2026-10-27',start_time:'21:00',category:'chores',subcategory:'chores',note:'Synthetic chores'},{date:'2026-10-28',start_time:'10:00',category:'work',subcategory:'Lab',note:'Synthetic lab'}];
const time={today:'2026-10-28',local_time:'08:40',timezone:'Europe/London'};
const cases=[
 {id:'plain-yesterday-followup',text:'21:30-22 put chores',day:'2026-10-27',slot:'21:30'},
 {id:'explicit-today-switch',text:'Today put chores from 21:30 to 22:00',day:'2026-10-28',slot:'21:30'},
 {id:'past-day-reflection',text:'My reflection for that day: I felt good about my progress.',day:'2026-10-27',reflection:true},
 {id:'past-day-exact-read',text:'What is written from 21:00 to 21:30 on that day?',day:'2026-10-27',query:true},
 {id:'month-first-date',text:'On October 26 2026 put chores from 21:30 to 22:00',day:'2026-10-26',slot:'21:30'}
];
(async()=>{const p=providers();let passed=0;for(const c of cases){try{const focus={focusDate:'2026-10-27',expiresAt:'2099-01-01T00:00Z'},session=discussion.resolve(c.text,time,focus),ctx=D.context(rows,c.text,time,[{user:'What time slots yesterday are free?',assistant:'For Tuesday 27 October 2026: 21:30–24:00 is unfilled.'}],{discussionDate:session.date}),draft=await p.interpret(c.text,ctx);assert.equal(session.date,c.day);assert.equal(discussion.checkDraft(draft,session,c.text),null);const review=D.plan(draft,rows,ctx.app.targets,{strict:true});assert.equal(review.questions.length,0);if(c.query){assert.equal(review.patches.length,0);assert.ok(review.answers.some(a=>a.includes('Synthetic chores')));}else{assert.ok(review.patches.some(p=>p.date===c.day&&(c.reflection?p.slot==='__reflect__':p.slot===c.slot)));assert.ok(review.patches.every(p=>p.date===c.day));}passed++;console.log(JSON.stringify({id:c.id,pass:true}));}catch(e){console.log(JSON.stringify({id:c.id,pass:false,error:e.message}));}}console.log(JSON.stringify({passed,total:cases.length}));process.exitCode=passed===cases.length?0:1;})().catch(()=>{console.error('Synthetic date evaluation failed');process.exitCode=1;});
