const {test}=require('node:test'),assert=require('node:assert/strict');
const M=require('../activity-model'),A=require('../voice-actions'),D=require('../server/telegram/domain.cjs'),R=require('../event-range');
const {planRows,exportRows}=require('../scripts/organize-history.cjs');
const date='2026-11-09',row=(category,subcategory,details={})=>({id:1,date,start_time:'09:00',category,subcategory,note:'Original note',details,version:'1:1'});
const draft=items=>({reply:'',questions:[],items,reflections:[],actions:[]});
test('history normalises modes and work projects while preserving original content and is idempotent',()=>{
 for(const [b,category,sub,detail] of [[row('travel','Train'),'travel','Travel',{modes:['Train']}],[row('gym',''),'exercise','Gym',{}],[row('work','Moeve'),'work','Work',{project:'Moeve'}],[row('chores','Cooking'),'food','Cooking',{}],[row('other','Dentist'),'health','Appointment',{destination:'Dentist'}]]){
  const before=structuredClone(b),after=M.normalize(A.normal(b),{history:true,projectNames:['Moeve']});assert.equal(after.category,category);assert.equal(after.sub,sub);assert.equal(after.note,b.note);for(const [k,v] of Object.entries(detail))assert.deepEqual(after.details[k],v);assert.ok(after.details.original_category);assert.deepEqual(M.normalize(after,{history:true,projectNames:['Moeve']}),after);assert.deepEqual(b,before);
 }
});
test('unclear entries and contradictory sleep labels keep their purpose and receive review flags',()=>{
 for(const b of [row('social','Excursion'),row('other','Anxious'),row('sleep','Watch TV')]){const after=M.normalize(A.normal(b),{history:true,projectNames:['Moeve']});assert.equal(after.category,b.category);assert.equal(after.sub,b.subcategory);assert.equal(after.details.needs_review,true);}
 const imported=row('work','Moeve');imported.note='[GCal] Meeting';assert.deepEqual(M.normalize(A.normal(imported),{history:true}),A.normal(imported));
});
test('mixed transport counts time once and work has separate project totals',()=>{
 const days={[date]:{'09:00':{category:'travel',sub:'Travel',details:{modes:['Train','Bus']}},'09:30':{category:'travel',sub:'Travel'},'10:00':{category:'work',sub:'Meeting',details:{project:'Moeve'}},'10:30':{category:'work',sub:'Work',details:{project:'Moeve'}}}};
 assert.deepEqual(M.breakdown(days),{travelHours:1,transport:{'Train + Bus':.5,'Mode not recorded':.5},projects:{'Company not recorded / Moeve':1}});
 assert.throws(()=>M.details({modes:['Teleport']}));assert.throws(()=>M.details({project:'a'.repeat(301)}));
});
test('Telegram new journeys, detail corrections, moves and undo patches retain all modes',()=>{
 const item={date,start:'09:00',end:'10:00',end_date:date,category:'travel',activity:'Travel',note:'Station',details:{modes:['Train','Bus'],destination:'London'}};
 const p=D.plan(draft([item]),[],[],{strict:true});assert.equal(p.questions.length,0);assert.equal(p.patches.length,2);assert.deepEqual(p.patches[0].after.details,{destination:'London',modes:['Bus','Train']});
 const rows=p.patches.map(x=>({date,start_time:x.slot,...x.after,subcategory:x.after.sub}));const days=A.daysFromRows(rows),catalog=A.targets(days,D.helpers),target=catalog[0].id;
 const edit=D.plan({...draft([]),actions:[{type:'activity_details',target,modes:['Car'],destination:'Cambridge'}]},rows,catalog);
 assert.equal(edit.patches.length,2);assert.deepEqual(edit.patches[0].before.details,{destination:'London',modes:['Bus','Train']});assert.deepEqual(edit.patches[0].after.details,{destination:'Cambridge',modes:['Car']});
 const moved=A.plan({draft:{actions:[{type:'activity_update',target,date:'2026-11-10'}]},days,catalog,range:R,helpers:D.helpers});assert.ok(moved.patches.filter(p=>p.after).every(p=>p.after.details.destination==='London'));
 const changed=structuredClone(rows);changed[0].details={...changed[0].details,project:'Different'};assert.equal(A.same(rows[0],changed[0]),false);
});
test('migration plans only timed rows and settings, keeps metadata and exports details',()=>{
 const rows=[row('travel','Train'),{id:2,date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({shortTermObjectives:'Keep this',subs:{travel:['Train']}}),version:'2:1'}, {id:3,date,start_time:'__plan__',category:'plan',note:'[ ] Keep objective',version:'3:1'}];
 const plan=planRows(rows);assert.equal(plan.timed,1);assert.equal(plan.changes.length,2);assert.ok(!plan.changes.some(p=>p.slot==='__plan__'));
 const organized=rows.map(r=>{const p=plan.changes.find(p=>p.id===r.id);return p?{...r,...p.after,subcategory:p.after.sub}:r;});
 const exported=exportRows(organized,'test');assert.equal(exported.days[date].objectives,'[ ] Keep objective');assert.deepEqual(exported.days[date].blocks[0].details.modes,['Train']);assert.equal(exported.targets.short_term,'Keep this');assert.equal(planRows(organized).changes.length,0);
});

test('work requires a company and a project owned by that company',()=>{
 const companies=[{name:'Atlas',projects:['Research']},{name:'Orion',projects:['Build']}];
 const b=details=>({category:'work',sub:'Meeting',details});
 assert.match(M.workError(b({}),companies),/company/);
 assert.match(M.workError(b({company:'Atlas'}),companies),/project/);
 assert.match(M.workError(b({company:'Atlas',project:'Build'}),companies),/belonging to Atlas/);
 assert.equal(M.workError(b({company:'Atlas',project:'Research'}),companies),'');
 assert.equal(M.workError({category:'travel'},companies),'');
 assert.match(M.title(b({company:'Atlas',project:'Research'})),/Atlas · Research/);
 assert.throws(()=>M.companies([{name:'Atlas',projects:[]},{name:' atlas ',projects:[]}]));
});
test('Telegram asks for missing work ownership and cannot accept a cross-company project',()=>{
 const settings={date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({workHierarchyVersion:1,workCompanies:[{name:'Atlas',projects:['Research']},{name:'Orion',projects:['Build']}]})};
 const item={date,start:'09:00',end_date:date,end:'09:30',category:'work',activity:'Meeting',note:''};
 for(const details of [{},{company:'Atlas'},{company:'Atlas',project:'Build'}]){const p=D.plan(draft([{...item,details}]),[settings],[],{strict:true});assert.equal(p.patches.length,0);assert.equal(p.questions.length,1);}
 const p=D.plan(draft([{...item,details:{company:'Atlas',project:'Research'}}]),[settings],[],{strict:true});assert.equal(p.questions.length,0);assert.equal(p.patches[0].after.details.company,'Atlas');
 const missing=A.plan.bind(null,{draft:{actions:[{type:'activity_update',target:'activity:'+date+':09:00',text:'Correct note'}]},days:A.daysFromRows([settings,row('work','Meeting')]),catalog:A.targets(A.daysFromRows([settings,row('work','Meeting')]),D.helpers),range:R,helpers:{...D.helpers,deferWorkValidation:false}});assert.throws(missing,/company/);
});
test('Telegram can register company then project without confusing note projects',()=>{
 const rows=[{date:'2000-01-01',start_time:'__settings__',category:'settings',note:'{}'}];
 const p=D.plan({...draft([]),actions:[{type:'work_company_add',company:'Atlas'},{type:'work_project_add',company:'Atlas',project:'Research'}]},rows,[]);
 const settings=JSON.parse(p.patches.find(p=>p.slot==='__settings__').after.note);assert.deepEqual(settings.workCompanies,[{name:'Atlas',projects:['Research']}]);assert.equal(settings.workHierarchyVersion,1);assert.equal(p.questions.length,0);
});
test('historical company assignment uses only an explicit unambiguous project catalogue',()=>{
 const {planHierarchy}=require('../scripts/require-work-hierarchy.cjs');
 const rows=[row('work','Work',{project:'Research',needs_review:true}),{id:2,date:'2000-01-01',start_time:'__settings__',category:'settings',note:'{}',version:'2:1'}];
 let p=planHierarchy(rows,[{name:'Atlas',projects:['Research']}]);assert.equal(p.assigned,1);assert.equal(p.changes[0].after.details.company,'Atlas');assert.equal(p.changes[0].after.details.needs_review,undefined);assert.equal(p.changes[0].after.note,'Original note');
 p=planHierarchy(rows,[{name:'Atlas',projects:['Research']},{name:'Orion',projects:['Research']}]);assert.equal(p.assigned,0);assert.equal(p.changes.some(c=>c.id===1),false);assert.equal(rows[0].details.needs_review,true);
 p=planHierarchy(rows,[]);assert.equal(p.assigned,0);assert.equal(p.work,1);assert.equal(p.changes.some(c=>c.id===1),false);assert.equal(rows[0].details.project,'Research');
});
test('company creation, project creation and a work entry can be planned atomically',()=>{
 const settings={date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({workHierarchyVersion:1,workCompanies:[]})};
 const value={...draft([{date,start:'16:00',end:'16:30',end_date:date,category:'work',activity:'Work',note:'Synthetic',details:{company:'Boreal',project:'Launch'}}]),actions:[{type:'work_company_add',company:'Boreal'},{type:'work_project_add',company:'Boreal',project:'Launch'}]};
 const p=D.plan(value,[settings],[],{strict:true});assert.equal(p.questions.length,0);assert.equal(p.patches.length,2);assert.ok(p.patches.some(p=>p.slot==='16:00'&&p.after.details.company==='Boreal'));assert.ok(p.patches.some(p=>p.slot==='__settings__'));
 const missing=D.plan({...value,actions:[{type:'work_company_add',company:'Boreal'}]},[settings],[],{strict:true});assert.equal(missing.patches.length,0);assert.equal(missing.questions.length,1);
});
