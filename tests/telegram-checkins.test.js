const {test}=require('node:test');const assert=require('node:assert/strict');const {checkin}=require('../server/telegram/checkins.cjs');
test('check-ins respect London daylight saving, quiet hours, and recorded sleep',()=>{
 assert.equal(checkin([],Date.parse('2026-10-27T03:00:00Z')),null);
 assert.match(checkin([],Date.parse('2026-10-27T09:00:00Z')).text,/sleep/);
 assert.match(checkin([{date:'2026-10-27',category:'sleep'}],Date.parse('2026-10-27T09:00:00Z')).text,/get done/);
 assert.equal(checkin([],Date.parse('2026-07-01T09:00:00Z')),null);
 assert.match(checkin([],Date.parse('2026-07-01T08:00:00Z')).text,/sleep/);
});

test('recorded objectives and reflection suppress completed check-ins',()=>{
 assert.equal(checkin([{date:'2026-10-27',category:'sleep'},{date:'2026-10-27',start_time:'__plan__',note:'[ ] Walk'}],Date.parse('2026-10-27T09:00:00Z')),null);
 assert.equal(checkin([{date:'2026-10-27',start_time:'__reflect__',note:'Good day'}],Date.parse('2026-10-27T20:00:00Z')),null);
});
