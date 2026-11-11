'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {check,apply,scenarios}=require('../scripts/eval/contracts.cjs');
const {evaluate,summarize,shuffle}=require('../scripts/eval/runner.cjs');
const {options}=require('../scripts/eval-telegram-reliability.cjs');
const rows=require('../scripts/eval-telegram-organisation.cjs').rows;
const empty={patches:[],questions:[],answers:['Atlas Research Synthetic protocol'],summaries:[]};
const patch=(slot,after,before=null,date='2026-11-10')=>({date,slot,before,after});
const work={category:'work',sub:'Focused work',note:'',details:{company:'Atlas',project:'Research'}};
test('oracle rejects wrong slots even when legacy metadata checks pass',()=>{
 const r={...empty,patches:[patch('11:00',work),patch('11:30',work)]};
 assert.throws(()=>check('new-work',rows,r,()=>true),/Unrequested/);
});
test('oracle rejects missing slots, extra writes, duplicate patches and stale before values',()=>{
 assert.throws(()=>check('new-work',rows,{...empty,patches:[patch('10:00',work)]},()=>true),/Missing/);
 assert.throws(()=>check('exact-read',rows,{...empty,patches:[patch('10:00',work)]},()=>true),/Unrequested/);
 assert.throws(()=>apply(rows,{patches:[patch('10:00',work),patch('10:00',work)]}),/Duplicate/);
 assert.throws(()=>apply(rows,{patches:[patch('09:00',work)]}),/precondition/);
});
test('oracle rejects dropped notes on work changes',()=>{
 const patches=['09:00','09:30'].map(s=>patch(s,{...work,details:{company:'Orion',project:'Build'}},rows.find(r=>r.start_time===s)));
 assert.throws(()=>check('edit-work',rows,{...empty,patches},()=>true),/lost/);
});
test('oracle rejects extra workout exercises',()=>{
 const patches=['14:00','14:30'].map(s=>{const before=rows.find(r=>r.start_time===s);return patch(s,{...before,note:'__gym_workout_v1__'+JSON.stringify({exercises:[{exercise:'Squat',sets:3,reps:5,kg:60},{exercise:'Bench press',sets:3,reps:8,kg:40}]})},before);});
 assert.throws(()=>check('gym-edit',rows,{...empty,patches},()=>true),/extra workout/);
});
test('oracle rejects markup, unnecessary clarification and missing workout facts',()=>{
 assert.throws(()=>check('exact-read',rows,{...empty,answers:['<!--day-link:private-->']},()=>true),/markup/);
 assert.throws(()=>check('exact-read',rows,{...empty,questions:['Save this?']},()=>true),/Unnecessary/);
 assert.throws(()=>check('gym-read',rows,{...empty,answers:['Bench press 40kg']},()=>true),/set or rep/);
});
test('correct read leaves entire fixture unchanged',()=>assert.deepEqual(check('exact-read',rows,empty,()=>true).map(r=>r.date),rows.map(r=>r.date)));
test('seeded ordering is reproducible without mutating input',()=>{const input=[1,2,3,4,5];assert.deepEqual(shuffle(input,42),shuffle(input,42));assert.deepEqual(input,[1,2,3,4,5]);});
test('outages and unattempted cases never count as acceptance',async()=>{
 const suite=scenarios.slice(0,3);
 const r=await evaluate({scenarios:suite,models:['fixture'],interpret:async()=>{throw Object.assign(Error('quota'),{code:'provider_billing'});}});
 assert.equal(r.summary.scheduled,3);assert.equal(r.summary.attempted,1);assert.equal(r.summary.provider,1);assert.equal(r.summary.skipped,2);assert.equal(r.summary.accepted,false);
});
test('budget exhaustion stays visible in denominator',async()=>{
 const r=await evaluate({scenarios:scenarios.slice(0,2),models:['fixture'],maxRequests:1,interpret:async()=>{throw Object.assign(Error('invalid'),{code:'model_invalid'});}});
 assert.equal(r.summary.scheduled,2);assert.equal(r.summary.task,1);assert.equal(r.summary.skipped,1);assert.equal(r.summary.accepted,false);
});
test('one failed repetition makes the whole case inconsistent',()=>{
 const s=summarize([{id:'x',model:'m',status:'passed'},{id:'x',model:'m',status:'task'}],2);
 assert.equal(s.consistentCases,0);assert.equal(s.accepted,false);
});
test('empty or incomplete runs cannot pass',()=>{assert.equal(summarize([],0).accepted,false);assert.equal(summarize([{status:'passed',id:'x',model:'m'}],2).accepted,false);});
test('CLI defaults to no network and validates bounds',()=>{
 assert.equal(options([]).live,undefined);
 for(const args of [['--repeat','0'],['--max-requests','501'],['--unknown'],['--live','--replay','file']])assert.throws(()=>options(args));
});
test('valid work creation advances state without changing the original fixture',()=>{
 const original=JSON.stringify(rows),review={...empty,patches:[patch('10:00',work),patch('10:30',work)]};
 const next=check('new-work',rows,review,()=>true);
 assert.equal(next.length,rows.length+2);assert.equal(JSON.stringify(rows),original);
});
test('failed fixture replay cannot silently run against changed data',async()=>{
 const s=scenarios.find(s=>s.id==='exact-read');
 const r=await evaluate({scenarios:[s],models:['fixture'],replay:[{model:'fixture',id:s.id,repetition:1,fixtureHash:'wrong',turns:[]}],interpret:()=>{throw Error('must stay offline');}});
 assert.equal(r.results[0].status,'harness');assert.match(r.results[0].error,/fixture/);
});
test('replay is offline, repeatable and checks recorded context',async()=>{
 const s=scenarios.find(s=>s.id==='exact-read');
 const draft={reply:"",items:[],reflections:[],actions:[{type:'query_slot',date:'2026-11-10',start:'09:00',end:'10:00'}],questions:[]};
 const live=await evaluate({scenarios:[s],models:['fixture'],interpret:async()=>draft});
 assert.equal(live.summary.accepted,true);
 const again=await evaluate({scenarios:[s],models:['fixture'],replay:live.results,interpret:()=>{throw Error('network not permitted');}});
 assert.equal(again.summary.accepted,true);assert.deepEqual(again.results[0].turns[0].review,live.results[0].turns[0].review);
 const bad=structuredClone(live.results);bad[0].turns[0].contextHash='wrong';
 const changed=await evaluate({scenarios:[s],models:['fixture'],replay:bad});
 assert.equal(changed.summary.harness,1);
});
test('workflow second turn sees committed synthetic first-turn state',async()=>{
 const s=scenarios.find(s=>s.id==='work-edit-read-workflow');let calls=0;
 const r=await evaluate({scenarios:[s],models:['fixture'],interpret:async(model,text,ctx)=>{
  if(calls++===0)return {reply:"",items:[],reflections:[],questions:[],actions:[{type:'activity_details',target:'activity:2026-11-10:09:00',company:'Orion',project:'Build'}]};
  assert.equal(ctx.app.targets.find(t=>t.id==='activity:2026-11-10:09:00').details.company,'Orion');
  assert.equal(ctx.conversation.length,1);
  return {reply:"",items:[],reflections:[],questions:[],actions:[{type:'query_slot',date:'2026-11-10',start:'09:00',end:'10:00'}]};
 }});
 assert.equal(r.summary.accepted,true);assert.equal(calls,2);
});
test('oracle rejects an extra transport mode and unintended navigation',()=>{
 const trip={category:'travel',sub:'Travel',note:'',details:{modes:['Train','Bus','Car'],destination:'London'}};
 assert.throws(()=>check('mixed-travel',rows,{...empty,patches:['12:00','12:30'].map(s=>patch(s,trip))},()=>true),/travel details/);
 assert.throws(()=>check('exact-read',rows,{...empty,navigation:[{screen:'gym'}]},()=>true),/navigation/);
});
test('workflow cannot pass if the later turn fails',async()=>{
 const s={...scenarios.find(s=>s.id==='exact-read'),id:'two-reads'};s.turns=[s.turns[0],s.turns[0]];let calls=0;
 const r=await evaluate({scenarios:[s],models:['fixture'],interpret:async()=>{
  if(calls++===1)throw Object.assign(Error('invalid later turn'),{code:'model_invalid'});
  return {reply:'',items:[],reflections:[],actions:[{type:'query_slot',date:'2026-11-10',start:'09:00',end:'10:00'}],questions:[]};
 }});
 assert.equal(r.summary.accepted,false);assert.equal(r.summary.task,1);assert.equal(r.results[0].turns.length,2);
});
test('appointment checks retain the stated purpose with flexible storage fields',()=>{
 const lost={category:'health',sub:'Appointment',note:''};
 assert.throws(()=>check('health',rows,{...empty,patches:[patch('15:00',lost)]},()=>true),/purpose was lost/);
 assert.doesNotThrow(()=>check('health',rows,{...empty,patches:[patch('15:00',{...lost,note:'Dentist appointment'})]},()=>true));
});
test('malformed replay reports are rejected before any possible live interpretation',()=>{
 const {validateReplay}=require('../scripts/eval-telegram-reliability.cjs');
 for(const source of [null,{}, {version:1,models:['m'],caseIds:['x'],repeat:1,seed:1}])assert.throws(()=>validateReplay(source),/Invalid replay/);
});
test('a missing captured draft cannot inherit a passing status',async()=>{
 const s=scenarios.find(s=>s.id==='exact-read');
 const live=await evaluate({scenarios:[s],models:['fixture'],interpret:async()=>({reply:'',items:[],reflections:[],actions:[{type:'query_slot',date:'2026-11-10',start:'09:00',end:'10:00'}],questions:[]})});
 delete live.results[0].turns[0].draft;
 const replay=await evaluate({scenarios:[s],models:['fixture'],replay:live.results});
 assert.equal(replay.summary.accepted,false);assert.equal(replay.summary.harness,1);
});
