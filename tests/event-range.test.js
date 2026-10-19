const test = require('node:test'), assert = require('node:assert/strict');
const range = require('../event-range');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
test('overnight range writes the right half-hours on each date', () => {
 const r=range.build('2026-10-19','23:00','2026-10-20','01:30');
 assert.equal(r.hours,2.5);assert.deepEqual(r.days,[{date:'2026-10-19',slots:['23:00','23:30']},{date:'2026-10-20',slots:['00:00','00:30','01:00']}]);
});
test('multi-day all-day ranges and exclusive midnight endings', () => {
 const r=range.build('2026-10-19','00:00','2026-10-21','24:00');assert.equal(r.hours,72);assert.equal(r.days.length,3);
 const midnight=range.build('2026-10-19','23:00','2026-10-20','00:00');assert.equal(midnight.hours,1);assert.equal(midnight.days.length,1);
});
test('invalid, backwards, empty and overlong ranges are rejected', () => {
 for (const args of [ ['','09:00','2026-10-19','10:00'],['2026-02-30','09:00','2026-03-01','10:00'],['2026-10-19','15:00','2026-10-19','14:00'],['2026-10-20','09:00','2026-10-19','10:00'],['2026-10-19','09:00','2026-10-19','09:00'],['2026-10-19','09:15','2026-10-19','10:00'],['2026-10-19','00:00','2027-10-20','24:00'] ])assert.ok(range.build(...args).error);
});
test('calendar arithmetic preserves slots across DST, leap days and year boundaries',()=>{
 assert.equal(range.build('2026-10-24','23:00','2026-10-25','03:00').hours,4);
 assert.equal(range.shift('2028-02-28',1),'2028-02-29');assert.equal(range.shift('2026-12-31',1),'2027-01-01');
});
function setup({initial={},confirm=true,sb=null}={}) {
 const store=structuredClone(initial), statuses=[],elements={sheet:{inert:false},saveBlock:{disabled:false},plannerScreen:{hidden:true}};
 const ctx={eventDraftVersion:1,eventMode:true,sb,USER_ID:'test',data:{},current:new Date('2026-10-19T12:00:00Z'),EVENT_REMINDER_KEY:'__event_reminders__',
 document:{getElementById:id=>elements[id]},loadLocal:date=>structuredClone(store[date]||{}),saveLocal:(date,day)=>store[date]=structuredClone(day),
 window:{confirm:()=>confirm},ymd:()=> '2026-10-19',eventRemindersForDay:day=>JSON.parse(day.__event_reminders__?.note||'[]'),
 eventReminderBlock:items=>items.length?{category:'calendar_reminder',sub:'Event reminders',note:JSON.stringify(items)}:null,
 setStatus:(kind,message)=>statuses.push({kind,message}),closeSheet:()=>{ctx.eventMode=false;ctx.eventDraftVersion++;elements.sheet.inert=false;},
 render(){},renderPlanner(){},renderEventReminderBanner(){},updateEventRange(){elements.saveBlock.disabled=false;},console:{warn(){}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function savePlannedEvent(')),ctx);
 return {ctx,store,statuses,elements};
}
const selected=()=>range.build('2026-10-19','23:00','2026-10-20','01:00');
const block={category:'social',note:'Test note',sub:'Test event'};
test('saving spans dates, preserves unrelated blocks, and places one reminder at the start',async()=>{
 const {ctx,store}=setup({initial:{'2026-10-20':{'14:00':{category:'work',note:'Keep'}}}});
 await ctx.savePlannedEvent(selected(),block,'Test event','60');
 assert.equal(store['2026-10-19']['23:30'].sub,'Test event');assert.equal(store['2026-10-20']['00:30'].category,'social');assert.equal(store['2026-10-20']['14:00'].note,'Keep');
 assert.equal(JSON.parse(store['2026-10-19'].__event_reminders__.note)[0].start,'23:00');assert.equal(store['2026-10-20'].__event_reminders__,undefined);
});
test('rejecting overwrite leaves every date untouched',async()=>{
 const initial={'2026-10-20':{'00:00':{category:'sleep'}}};const {ctx,store,elements}=setup({initial,confirm:false});
 await ctx.savePlannedEvent(selected(),block,'Test','none');assert.deepEqual(store,initial);assert.equal(elements.sheet.inert,false);assert.equal(elements.saveBlock.disabled,false);
});
test('cloud preflight failure does not write any local data',async()=>{
 const q={then(resolve){resolve({error:new Error('offline')});}};for(const method of ['select','eq','gte','lte','order','range'])q[method]=()=>q;
 const {ctx,store,statuses}=setup({sb:{from:()=>q}});await ctx.savePlannedEvent(selected(),block,'Test','none');
 assert.deepEqual(store,{});assert.equal(statuses.at(-1).kind,'err');assert.equal(ctx.eventMode,true);
});
test('cloud save carries subcategory and selected dates without replacing unrelated rows',async()=>{
 const writes=[];const q={then(resolve){resolve({data:[{date:'2026-10-20',start_time:'14:00',category:'work',note:'Remote',subcategory:'Project'}]});}};
 for(const method of ['select','eq','gte','lte','order','range'])q[method]=()=>q;
 const sb={from(){return {...q,upsert(rows){writes.push(...(Array.isArray(rows)?rows:[rows]));return Promise.resolve({error:null});},delete(){return {eq(){return this;},then(resolve){resolve({error:null});}};}};}};
 const {ctx,store}=setup({sb});await ctx.savePlannedEvent(selected(),block,'Test','none');
 assert.equal(writes.length,4);assert.ok(writes.every(r=>r.subcategory==='Test event'));assert.equal(store['2026-10-20']['14:00'].sub,'Project');
});
