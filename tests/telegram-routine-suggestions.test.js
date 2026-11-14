'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {suggestion}=require('../server/telegram/routine-suggestions.cjs'),{checkin}=require('../server/telegram/checkins.cjs');
const time={today:'2026-11-13',local_time:'12:15',timezone:'Europe/London'};
const dates=['2026-11-10','2026-11-11','2026-11-12'];
const gym=(date,extra={})=>({date,start_time:'12:00',category:'exercise',subcategory:'Gym',note:'private workout note',...extra});
const rows=()=>dates.map(d=>gym(d));
test('three distinct recent matching days produce a factual suggestion without exposing notes',()=>{
 const data=rows(),copy=JSON.stringify(data),result=suggestion(data,time);
 assert.deepEqual(result,{label:'Gym',slot:'12:00',matchingDays:3,observedDays:3,dayType:'weekdays'});
 const message=checkin(data,Date.parse('2026-11-13T12:15Z'));
 assert.equal(message.topic,'routine');assert.match(message.text,/3 recent weekdays/);assert.match(message.text,/Is that what/);assert.doesNotMatch(message.text,/private|saved|added/);assert.equal(JSON.stringify(data),copy);
});
test('duplicates, isolated events, other times and future entries do not manufacture a routine',()=>{
 assert.equal(suggestion([gym(dates[0]),gym(dates[0]),gym(dates[0])],time),null);
 assert.equal(suggestion(rows().slice(0,2),time),null);
 assert.equal(suggestion(rows().map(r=>({...r,start_time:'12:30'})),time),null);
 assert.equal(suggestion(['2026-11-16','2026-11-17','2026-11-18'].map(d=>gym(d)),time),null);
});
test('weak, stale and conflicting patterns fall back to a normal check-in',()=>{
 const conflicting=rows().concat(['2026-11-09','2026-11-06','2026-11-05'].map(d=>gym(d,{category:'food',subcategory:'Eating'})));
 assert.equal(suggestion(conflicting,time),null);
 assert.equal(suggestion(['2026-10-20','2026-10-21','2026-10-22'].map(d=>gym(d)),time),null);
 assert.equal(suggestion(['2026-09-20','2026-09-21','2026-09-22'].map(d=>gym(d)),time),null);
});
test('weekday history is not a weekend routine and genuine weekend patterns work',()=>{
 const saturday={...time,today:'2026-11-14'};
 assert.equal(suggestion(rows(),saturday),null);
 assert.equal(suggestion(['2026-11-01','2026-11-07','2026-11-08'].map(d=>gym(d)),saturday).dayType,'weekend days');
});
test('filled slots, exceptional days and calendar plans suppress suggestions',()=>{
 assert.equal(suggestion(rows().concat(gym(time.today,{category:'food'})),time),null);
 const status=date=>({date,start_time:'__day_status__',category:'calendar_status',note:'Holiday',subcategory:'holiday'});
 assert.equal(suggestion(rows().concat(status(time.today)),time),null);
 assert.equal(suggestion(rows().concat(status(dates[0])),time),null);
 assert.equal(suggestion(rows().map(r=>({...r,note:'[GCal] future plan'})),time),null);
});
test('matching work requires the same explicit company and project or task',()=>{
 const work=rows().map(r=>({...r,category:'work',subcategory:'Meeting',details:{company:'Atlas',project:'Research'}}));
 assert.equal(suggestion(work,time).label,'Meeting · Atlas / Research');
 assert.equal(suggestion(work.map(r=>({...r,details:{project:'Research'}})),time),null);
 work[0].details.company='Orion';assert.equal(suggestion(work,time),null);
});
test('travel suggestions preserve combined modes and destination without copying notes',()=>{
 const travel=rows().map(r=>({...r,category:'travel',subcategory:'Travel',details:{modes:['Bus','Train'],destination:'London'}}));
 assert.equal(suggestion(travel,time).label,'Travel · Bus + Train · to London');
 travel[0].details.modes=['Car'];assert.equal(suggestion(travel,time),null);
});
test('ambiguous, malformed and review-marked entries do not become suggestions',()=>{
 assert.equal(suggestion(rows().map(r=>({...r,details:{needs_review:true}})),time),null);
 assert.equal(suggestion(rows().map(r=>({...r,details:{modes:'Train'}})),time),null);
 assert.equal(suggestion(rows().map(r=>({...r,category:'other',subcategory:'Other'})),time),null);
 assert.equal(suggestion(rows().map(r=>({...r,category:'sleep',subcategory:'TV'})),time),null);
});
test('London daylight saving and half-hour boundaries select local recorded times',()=>{
 const summer=['2026-06-26','2026-06-29','2026-06-30'].map(d=>gym(d));
 assert.equal(checkin(summer,Date.parse('2026-07-01T11:15Z')).topic,'routine');
 assert.equal(suggestion(rows().map(r=>({...r,start_time:'12:30'})),{...time,local_time:'12:45'}).slot,'12:30');
});
test('suggestions respect pacing and give explicit commitments precedence',()=>{
 const now=Date.parse('2026-11-13T12:15Z');
 for(const [prefs,state] of [[{enabled:false},{}],[{}, {day:time.today,count:4}],[{}, {lastUserAt:'2026-11-13T12:00Z'}],[{}, {day:time.today,unanswered:2}]])assert.equal(checkin(rows(),now,prefs,state),null);
 assert.notEqual(checkin(rows(),now,{}, {day:time.today,lastTopic:'routine'}).topic,'routine');
 assert.equal(checkin(rows(),now,{}, {day:'2026-11-12',lastTopic:'routine'}).topic,'routine');
 const record={title:'Application',priority:'high',dueDate:time.today};
 assert.equal(checkin(rows(),now,{}, {},{priorities:[{record,reason:'high priority'}]}).topic,'commitment');
});
