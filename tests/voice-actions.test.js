const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../voice-actions'),range=require('../event-range');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),context={};vm.createContext(context);
for(const name of ['parseObjectiveLine','serializeObjectiveItem','serializeObjectiveItems','roughPlansForDay','roughPlanBlock']) {
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start)+2;vm.runInContext(source.slice(start,end),context);
}
vm.runInContext("const ROUGH_PLAN_KEY='__rough_plan__'",context);
const helpers={parseObjective:context.parseObjectiveLine,serializeObjectives:context.serializeObjectiveItems,roughPlans:context.roughPlansForDay,roughPlanBlock:context.roughPlanBlock,categories:require('../voice-draft').categories};
const block={category:'work',sub:'CFD',note:'Keep this note'},date='2026-10-25';
function plan(days,actions){return A.plan({draft:{actions},days,catalog:A.targets(days,helpers),range,helpers});}
const target=`activity:${date}:09:00`;
test('moving a contiguous activity preserves notes/category and unrelated entries',()=>{
 const days={[date]:{'09:00':block,'09:30':block,'13:00':{category:'food'}}};
 const result=plan(days,[{type:'activity_update',target,date:'2026-10-26',start:'10:00',end:'11:00'}]);
 assert.equal(result.patches.length,4);assert.equal(result.patches.filter(p=>!p.after).length,2);
 assert.deepEqual(result.patches.find(p=>p.date==='2026-10-26').after,block);
 assert.equal(days[date]['09:00'],block);assert.ok(!result.patches.some(p=>p.slot==='13:00'));
});
test('ambiguous or missing targets and conflicting destinations never produce a plan',()=>{
 const days={[date]:{'09:00':block,'10:00':{category:'food'}}};
 assert.throws(()=>plan(days,[{type:'activity_delete',target:'CFD'}]),/selection/);
 assert.throws(()=>plan(days,[{type:'activity_update',target,start:'10:00',end:'11:00'}]),/overlaps/);
 assert.throws(()=>plan(days,[{type:'activity_update',target,start:'09:15',end:'10:00'}]));
 assert.ok(days[date]['09:00']);
});
test('overnight destinations include exactly the requested slots',()=>{
 const days={[date]:{'09:00':block}};
 const result=plan(days,[{type:'activity_update',target,date,start:'23:30',end_date:'2026-10-26',end:'00:30'}]);
 assert.deepEqual(result.patches.filter(p=>p.after).map(p=>[p.date,p.slot]),[[date,'23:30'],['2026-10-26','00:00']]);
});
test('delete affects only one exact contiguous segment',()=>{
 const result=plan({[date]:{'09:00':block,'10:00':block}},[{type:'activity_delete',target}]);
 assert.equal(result.patches.length,1);assert.equal(result.patches[0].slot,'09:00');assert.equal(result.patches[0].after,null);
});
test('goal completion preserves metadata and updates linked copies',()=>{
 const note='[ ] Submit CFD <!--day-link:abc:2026-10-25:2026-10-26-->';
 const days={[date]:{__plan__:{category:'plan',note}},'2026-10-26':{__plan__:{category:'plan',note}}};
 const result=plan(days,[{type:'objective_complete',target:`objective:${date}:daily:0`,completed:true}]);
 assert.equal(result.patches.length,2);for(const p of result.patches)assert.match(p.after.note,/^\[x\].*day-link:abc/);
});
test('long-term goal additions preserve every other setting',()=>{
 const days={'2000-01-01':{__settings__:{category:'settings',note:JSON.stringify({customCats:[{id:'lab'}],longTermObjectives:'[ ] Thesis'})}}};
 const result=plan(days,[{type:'objective_add',horizon:'longTermObjectives',text:'Finish paper'}]);
 const settings=JSON.parse(result.patches[0].after.note);assert.deepEqual(settings.customCats,[{id:'lab'}]);assert.match(settings.longTermObjectives,/Thesis\n\[ \] Finish paper/);
});
test('checkins retain the other rating, plans retain earlier plans, and notes append',()=>{
 const days={[date]:{__checkin__:{category:'checkin',note:'{"energy":2,"satisfaction":4}'},__rough_plan__:{category:'calendar_plan',note:'["Walk"]'}},'2000-01-01':{__note__n:{category:'note',note:'{"id":"n","title":"Research","body":"Original","projectId":"p"}'}}};
 const result=plan(days,[{type:'checkin',date,energy:5},{type:'rough_plan_add',date,text:'Meet Sam'},{type:'note_append',target:'note:n',text:'New idea'}]);
 assert.equal(JSON.parse(result.patches.find(p=>p.slot==='__checkin__').after.note).satisfaction,4);
 assert.deepEqual(JSON.parse(result.patches.find(p=>p.slot==='__rough_plan__').after.note),['Walk','Meet Sam']);
 const note=JSON.parse(result.patches.find(p=>p.slot==='__note__n').after.note);assert.equal(note.body,'Original\n\nNew idea');assert.equal(note.projectId,'p');
 assert.throws(()=>plan(days,[{type:'checkin',date,energy:6}]),/1–5/);
});
test('query totals are computed, exclude imports, and do not mutate data',()=>{
 const result=plan({[date]:{'09:00':block,'09:30':block,'10:00':{category:'work',note:'[GCal] meeting'}}},[{type:'query_day',date}]);
 assert.equal(result.patches.length,0);assert.match(result.answers[0],/CFD: 1h/);assert.match(result.answers[0],/Unrecorded time is unknown/);
});
test('local commands are exact and do not turn narration into a destructive action',()=>{
 const env={today:date,viewedDate:'2026-10-21',shift:range.shift};
 assert.equal(A.localCommand('show yesterday',env).actions[0].date,'2026-10-24');
 assert.equal(A.localCommand('go to next day',env).actions[0].date,'2026-10-22');
 assert.equal(A.localCommand('I said undo that earlier',env),null);
 assert.equal(A.localCommand('save it',env).control,'save');
});
module.exports={helpers};
