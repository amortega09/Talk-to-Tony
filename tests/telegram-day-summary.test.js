const {test}=require('node:test');const assert=require('node:assert/strict');const {queryDate,summarize}=require('../server/telegram/day-summary.cjs');
test('status follows actual date and empty data rather than remembered moved entries',()=>{
 const conversation=[{user:'What is the status of my day so far? i.e. what have I filled in',assistant:'Sleep until 08:30'}];
 assert.equal(queryDate(conversation[0].user,'2026-10-27'),'2026-10-27');
 assert.equal(queryDate('Can you double check that?','2026-10-27',conversation),'2026-10-27');
 const rows=[{date:'2026-10-26',start_time:'00:00',category:'sleep'}];
 assert.deepEqual(summarize(rows,'2026-10-27'),['No activities are saved for Tuesday, 27 October 2026.']);
});
test('summary groups current slots only, preserves labels and leaves gaps',()=>{
 const rows=['09:00','09:30','10:30'].map(start_time=>({date:'2026-10-27',start_time,category:'work',subcategory:'Lab'}));
 const result=summarize(rows,'2026-10-27').join('\n');assert.match(result,/09:00–10:00 · Lab/);assert.match(result,/10:30–11:00 · Lab/);assert.match(result,/1.5 hours/);
 assert.equal(queryDate('What did I log yesterday?','2026-10-27'),'2026-10-26');
 assert.equal(queryDate('Move my day to yesterday','2026-10-27'),null);
 assert.equal(queryDate('Show my diary last week','2026-10-27'),null);
});
test('free slots query returns only contiguous unfilled time for the requested date',()=>{
 const {query,gaps}=require('../server/telegram/day-summary.cjs');const rows=Array.from({length:43},(_,i)=>({date:'2026-10-27',start_time:String(Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'30':'00'),category:'work'}));
 assert.deepEqual(query('What time slots yesterday are free?','2026-10-28'),{date:'2026-10-27',kind:'gaps'});const reply=gaps(rows,'2026-10-27');assert.deepEqual(reply.slice(1,2),['21:30–24:00']);assert.ok(!reply.join('\n').includes('Objectives'));assert.match(reply[0],/27 October 2026/);assert.match(reply.at(-1),/not necessarily free/);
 assert.match(gaps([],'2026-10-27')[1],/00:00–24:00/);assert.equal(gaps([...rows,...['21:30','22:00','22:30','23:00','23:30'].map(start_time=>({date:'2026-10-27',start_time,category:'work'}))],'2026-10-27').length,1);
});
test('double check preserves structured query date across midnight but does not hijack other topics',()=>{
 const {query}=require('../server/telegram/day-summary.cjs');assert.deepEqual(query('Can you double check that?','2026-10-29',[{discussion_date:'2026-10-27',query_kind:'gaps'}]),{date:'2026-10-27',kind:'gaps'});
 assert.equal(query('Can you double check that?','2026-10-29',[{user:'Show my diary yesterday',anchor_date:'2026-10-28'},{user:'Read my gym workout'}]),null);
 assert.equal(query('Show my diary yesterday and today','2026-10-28'),null);
});
