'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {resolve,checkDraft}=require('../server/telegram/discussion.cjs'),D=require('../server/telegram/domain.cjs');
const time={today:'2026-10-28',local_time:'08:40'},focus={focusDate:'2026-10-27',expiresAt:'2026-10-29T08:40Z'},now=Date.parse('2026-10-28T08:40Z');
const item=(date,end_date=date)=>({date,end_date,start:'21:30',end:'22:00',category:'chores',activity:'chores',note:''});
test('plain timed follow-ups inherit yesterday and explicit today switches the date',()=>{
 assert.deepEqual(resolve('21:30–22 put chores',time,focus,null,null,now),{date:'2026-10-27',basis:'conversation'});assert.equal(resolve('Today put chores at 9',time,focus,null,null,now).date,time.today);assert.equal(resolve('On October 26 put chores at 9',time,focus,null,null,now).date,'2026-10-26');
});
test('reply and pending date references beat unrelated conversational focus',()=>{
 assert.equal(resolve('make it chores',time,focus,{discussion_date:'2026-10-26'},null,now).date,'2026-10-26');assert.equal(resolve('make it chores',time,focus,null,{data:{discussionDate:'2026-10-25'}},now).date,'2026-10-25');assert.equal(resolve('today instead',time,focus,null,{data:{discussionDate:'2026-10-25'}},now).date,time.today);
});
test('expired focus is distinguished from choosing today',()=>{const resolved=resolve('21:30–22 chores',time,{...focus,expiresAt:'2026-10-27T12:00Z'},null,null,now);assert.equal(resolved.expired,true);});
test('the date guard blocks wrong-day writes but allows real overnight and explicit multi-day requests',()=>{
 const discussion={date:'2026-10-27',basis:'conversation'};assert.match(checkDraft({items:[item(time.today)]},discussion),/different date/);assert.equal(checkDraft({items:[item(discussion.date)]},discussion),null);
 assert.equal(checkDraft({items:[{...item('2026-10-27','2026-10-28'),start:'23:00',end:'08:00'}]},discussion),null);
 assert.equal(checkDraft({items:[item('2026-10-27'),item('2026-10-28')]},discussion,'Add chores yesterday and today'),null);
});
test('model context retrieves and ranks the discussion day without changing actual today',()=>{
 const rows=['2026-10-27','2026-10-28'].map(date=>({date,start_time:'21:30',category:'chores',note:'',subcategory:'chores'}));const ctx=D.context(rows,'put chores',time,[],{discussionDate:focus.focusDate});assert.equal(ctx.today,time.today);assert.equal(ctx.viewed_date,focus.focusDate);assert.equal(ctx.discussion_date,focus.focusDate);assert.equal(ctx.app.targets[0].date,focus.focusDate);
});
