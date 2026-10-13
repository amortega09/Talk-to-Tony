const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, checkin, shift } = require('../patterns');
const slot = i => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
const block = category => ({ category, note: '' });
const full = (category = 'work') => Object.fromEntries(Array.from({length:48}, (_,i) => [slot(i), block(category)]));
const options = {today:'2026-10-13',range:30, objectives: d => d.targets || []};
test('unknown slots and calendar plans break work runs and are excluded', () => {
 const map = {'2026-10-12': {'09:00':block('work'),'09:30':block('work'),'10:30':block('work'),'11:00':{category:'work',note:'[GCal] Meeting'},'11:30':block('exercise'),'12:00':block('work')}};
 const a=analyze(map,options), d=a.logged[0];
 assert.equal(d.logged,5); assert.equal(d.imported,1); assert.equal(d.longest,1); assert.equal(d.switches,1);
 assert.equal(a.categories.work,2); assert.equal(a.categories.exercise,.5);
});
test('exclude sentinel/future dates and retain checkin-only days', () => {
 const a=analyze({'2000-01-01':full(),'2026-10-14':full(),'2026-10-12':{__checkin__:{note:'{"energy":4}'}}},options);
 assert.equal(a.selected.length,1); assert.equal(a.logged.length,0); assert.equal(a.selected[0].checkin.energy,4);
});
test('ratings validate independent missing, malformed and out-of-range values',()=>{
 assert.deepEqual(checkin({__checkin__:{note:'{"energy":0,"satisfaction":5}'}}),{energy:null,satisfaction:5});
 assert.deepEqual(checkin({__checkin__:{note:'invalid'}}),{energy:null,satisfaction:null});
 assert.deepEqual(checkin({__checkin__:{note:'null'}}),{energy:null,satisfaction:null});
});
test('equal completed periods exclude today, special and incomplete days',()=>{
 const map={}; for(let i=0;i<61;i++)map[shift(options.today,-i)]=full();
 map['2026-10-12'].__day_status__={sub:'holiday'};
 map['2026-10-11']={'09:00':block('work')};
 const a=analyze(map,options);
 assert.equal(a.recent.length,28);assert.equal(a.prior.length,30);assert.equal(a.recentStart,'2026-09-13');assert.equal(a.previousStart,'2026-08-14');
 assert.ok(a.recent.every(d=>d.date<options.today));
});
test('comparisons need five days per group and exclude moved targets',()=>{
 const map={};for(let i=1;i<=10;i++){const d=full('other');if(i<=5)d['09:00']=block('exercise');d.targets=[{completed:i<=5},{completed:false,transferredTo:'2026-10-14'}];map[shift(options.today,-i)]=d;}
 const a=analyze(map,options);assert.equal(a.comparisons.length,1);assert.equal(a.comparisons[0].a,1);assert.equal(a.comparisons[0].b,0);
 delete map['2026-10-12'];assert.equal(analyze(map,options).comparisons.length,0);
});
test('night sleep stitches midnight and requires observed boundaries',()=>{
 const yesterday=full('relax'),day=full('relax');
 for(let i=44;i<48;i++)yesterday[slot(i)]=block('sleep');
 for(let i=0;i<14;i++)day[slot(i)]=block('sleep');
 const map={'2026-10-11':yesterday,'2026-10-12':day};
 assert.equal(analyze(map,options).logged.find(d=>d.date==='2026-10-12').nightSleep,9);
 delete yesterday['21:30'];assert.equal(analyze(map,options).logged.find(d=>d.date==='2026-10-12').nightSleep,null);
});
test('observed zero work counts; missing hours do not dilute rhythm',()=>{
 const a=analyze({'2026-10-12':{'09:00':block('work')},'2026-10-11':{'09:00':block('relax')},'2026-10-10':{'10:00':block('work')}},options);
 assert.equal(a.rhythm[9].days,2);assert.equal(a.rhythm[9].work,.25);
});

const fs = require('node:fs'), vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
test('Patterns pages remote rows beyond a single response and keeps local edits', async () => {
 const body={innerHTML:''}, offsets=[];let painted, reads=0;
 const records=Array.from({length:501},(_,i)=>({date:'2026-10-12',start_time:'key'+i,category:'work',note:''}));
 const sb={from(){let offset=0; const query={then(resolve){resolve({data:records.slice(offset,offset+500),error:null});},range(start){offset=start;offsets.push(start);return query;}};
 for(const key of ['select','eq','lte','order','gte'])query[key]=()=>query;return query;}};
 const context={sb,USER_ID:'test',insightRange:30,currentInsight:{id:'patterns'},DayPatterns:require('../patterns'),ymd:()=>options.today,
  document:{getElementById:()=>body},gatherLocalRange:()=>({'2026-10-12':{key0:{category:'relax',note:reads++ ? 'local edit' : 'old local'}, key1:{category:'relax',note:'old local'}}}),console,
  renderPatterns:map=>{painted=map;return 'report';}};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('let patternsRequest ='),app.indexOf('function renderPatterns(')),context);
 await context.loadPatterns();assert.deepEqual(offsets,[0,500]);assert.equal(Object.keys(painted['2026-10-12']).length,501);assert.equal(painted['2026-10-12'].key0.note,'local edit');assert.equal(painted['2026-10-12'].key1.category,'work');
 assert.match(body.innerHTML,/Includes synced records/);
});
test('a remote failure leaves a usable local report with visible status', async()=>{
 const body={innerHTML:''};const q={then(resolve){resolve({error:new Error('offline')});}};for(const k of ['select','eq','lte','order','range','gte'])q[k]=()=>q;
 const context={sb:{from:()=>q},USER_ID:'test',insightRange:30,currentInsight:{id:'patterns'},DayPatterns:require('../patterns'),ymd:()=>options.today,
 document:{getElementById:()=>body},gatherLocalRange:()=>({}),console:{warn(){}},renderPatterns:()=>'<p>local report</p>'};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('let patternsRequest ='),app.indexOf('function renderPatterns(')),context);
 await context.loadPatterns();assert.match(body.innerHTML,/local report/);assert.match(body.innerHTML,/Could not load synced records/);
});
test('restore retains new checkins and separate gym records, and accepts old exports',()=>{
 const saved={};const context={DayPatterns:require('../patterns'),SETTINGS_DATE:'2000-01-01',SLOTS:Array.from({length:48},(_,i)=>slot(i)),
 CHECKIN_KEY:'__checkin__',GYM_KEY:'__gym__',GYM_NOTE_PREFIX:'__gym_workout_v1__',REFLECT_KEY:'__reflect__',PLAN_KEY:'__plan__',DAY_STATUS_TYPES:{},
 customSubs:{},gymExercises:[],loadLocal:()=>({}),saveLocal:(date,day)=>saved[date]=day};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function recoveryRowsFromBackup('),app.indexOf('async function restoreData(')),context);
 const result=context.recoveryRowsFromBackup({days:{'2026-10-12':{blocks:[],checkin:{energy:4,satisfaction:3},gym:{weight:80,sessions:[{exercise:'Squat',sets:3,reps:5,kg:60}]}}}});
 assert.equal(result.rows.length,2);assert.equal(JSON.parse(saved['2026-10-12'].__checkin__.note).energy,4);assert.equal(JSON.parse(saved['2026-10-12'].__gym__.note).sessions[0].kg,60);
 assert.equal(context.recoveryRowsFromBackup({days:{'2026-10-11':{blocks:[{start_time:'09:00',category:'work'}]}}}).rows.length,1);
});
