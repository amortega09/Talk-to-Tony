const {test}=require('node:test');const assert=require('node:assert/strict');const {checkin}=require('../server/telegram/checkins.cjs');
test('check-ins respect London daylight saving, quiet hours, and recorded sleep',()=>{
 assert.equal(checkin([],Date.parse('2026-10-27T03:00:00Z')),null);
 assert.match(checkin([],Date.parse('2026-10-27T09:00:00Z')).text,/sleep/);
 assert.match(checkin([{date:'2026-10-27',category:'sleep'}],Date.parse('2026-10-27T09:00:00Z')).text,/get done/);
 assert.equal(checkin([],Date.parse('2026-07-01T09:00:00Z')),null);
 assert.match(checkin([],Date.parse('2026-07-01T08:00:00Z')).text,/sleep/);
});

test('recorded objectives and reflection suppress completed check-ins',()=>{
 assert.match(checkin([{date:'2026-10-27',category:'sleep'},{date:'2026-10-27',start_time:'__plan__',note:'[ ] Walk'}],Date.parse('2026-10-27T09:00:00Z')).text,/Walk/);
 assert.equal(checkin([{date:'2026-10-27',start_time:'__reflect__',note:'Good day'}],Date.parse('2026-10-27T20:00:00Z')),null);
});
test('contextual prompts respect pacing, snooze, daily caps, quiet hours and ignored messages',()=>{
 const now=Date.parse('2026-10-27T12:00:00Z');
 assert.equal(checkin([],now,{enabled:false}),null);
 assert.equal(checkin([],now,{snooze_until:'2026-10-28T00:00Z'}),null);
 assert.equal(checkin([],now,{daily_limit:2},{day:'2026-10-27',count:2}),null);
 assert.equal(checkin([],now,{}, {day:'2026-10-27',unanswered:2}),null);
 assert.equal(checkin([],now,{}, {lastUserAt:'2026-10-27T11:45Z'}),null);
 assert.equal(checkin([],now,{quiet_start:11,quiet_end:14}),null);
 assert.ok(checkin([],now,{}, {day:'2026-10-26',unanswered:2}));
});
test('actual reminders use London time, lead minutes and expiration rather than chat guesses',()=>{
 const {dueReminders}=require('../server/telegram/checkins.cjs');
 const rows=[{date:'2026-07-01',start_time:'__event_reminders__',note:JSON.stringify([{id:'r',title:'Call',start:'09:00',lead:15}])}];
 assert.equal(dueReminders(rows,Date.parse('2026-07-01T07:45Z')).length,1);
 assert.equal(dueReminders(rows,Date.parse('2026-07-01T08:30Z')).length,0);
});
test('regular check-ins can mention an explicit priority without inventing an appointment',()=>{
 const now=Date.parse('2026-10-28T12:00Z'),record={id:'task',title:'Application',priority:'high',nextAction:'Draft headings'};
 const message=checkin([],now,{}, {},{priorities:[{record,reason:'You marked this as a high priority'}]});assert.equal(message.record.id,'task');assert.match(message.text,/Draft headings/);assert.doesNotMatch(message.text,/due|deadline|check back/);
 assert.notEqual(checkin([],now,{}, {lastTopic:'commitment'},{priorities:[{record,reason:'high priority'}]}).topic,'commitment');
 assert.equal(checkin([],now,{enabled:false},{},{priorities:[{record,reason:'high priority'}]}),null);
});
