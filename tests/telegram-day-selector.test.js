'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),selector=require('../server/telegram/day-selector.cjs'),dates=require('../server/telegram/dates.cjs'),discussion=require('../server/telegram/discussion.cjs'),{query}=require('../server/telegram/day-summary.cjs'),{parseUpdate}=require('../server/telegram/service.cjs');
const connection='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
test('screenshot ordinal typo and schedule resolve before the model is called',()=>{assert.equal(dates.resolve('What was my schedule for October 31rst?','2026-11-01'),'2026-10-31');assert.deepEqual(query('What was my schedule for October 31rst?','2026-11-01'),{date:'2026-10-31',kind:'summary'});assert.equal(dates.resolve('February 30th','2026-11-01'),null);assert.equal(dates.hasReference('February 30th'),true);assert.equal(dates.hasReference('Save November ideas'),false);});
test('day controls use absolute owner-connection references, fit Telegram limits and retain undo',()=>{
 const payload=selector.decorate({text:'Saved',discussionDate:'2026-10-31',reply_markup:{inline_keyboard:[[{text:'Undo',callback_data:'undo:x'}]]}},connection),buttons=payload.reply_markup.inline_keyboard.at(-1);assert.equal(payload.reply_markup.inline_keyboard[0][0].text,'Undo');assert.deepEqual(buttons.map(b=>selector.parse(b.callback_data).date),['2026-10-30','2026-10-31','today','2026-11-01']);assert.ok(buttons.every(b=>b.callback_data.length<=64));assert.equal(selector.decorate(payload,connection).reply_markup.inline_keyboard.length,2);
 assert.equal(selector.parse('day:'+connection.replaceAll('-','')+':20260230'),null);
});
test('selector callback passes Telegram private-chat validation',()=>{
 const callback_data=selector.navigation(connection,'2026-10-31')[1].callback_data,u={update_id:1,callback_query:{id:'q',data:callback_data,from:{id:123},message:{message_id:1,chat:{id:123,type:'private'}}}};const value=parseUpdate(u);assert.equal(value.callback.date,'2026-10-31');assert.equal(value.callback.id,connection);u.callback_query.message.chat.type='group';assert.equal(parseUpdate(u),null);
});
test('server binds single-day operations deterministically and preserves overnight duration',()=>{
 const input={items:[{date:'2026-11-01',end_date:'2026-11-02',start:'23:00',end:'08:00'}],reflections:[{date:'2026-11-01',text:'Good'}],actions:[{type:'query_day',date:'2026-11-01'},{type:'commitment_create',due_date:'2027-01-01'}]},bound=discussion.bindDraft(input,{date:'2026-10-31'},'log this');assert.equal(bound.items[0].date,'2026-10-31');assert.equal(bound.items[0].end_date,'2026-11-01');assert.equal(bound.reflections[0].date,'2026-10-31');assert.equal(bound.actions[0].date,'2026-10-31');assert.equal(bound.actions[1].due_date,'2027-01-01');assert.equal(input.items[0].date,'2026-11-01');
 assert.equal(discussion.bindDraft(input,{date:'2026-10-31'},'October 31rst and November 1st').items[0].date,'2026-11-01');
});
