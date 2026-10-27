const {test}=require('node:test');const assert=require('node:assert/strict');const {queryDate,summarize}=require('../server/telegram/day-summary.cjs');
test('status follows actual date and empty data rather than remembered moved entries',()=>{
 const conversation=[{user:'What is the status of my day so far? i.e. what have I filled in',assistant:'Sleep until 08:30'}];
 assert.equal(queryDate(conversation[0].user,'2026-10-27'),'2026-10-27');
 assert.equal(queryDate('Can you double check that?','2026-10-27',conversation),'2026-10-27');
 const rows=[{date:'2026-10-26',start_time:'00:00',category:'sleep'}];
 assert.deepEqual(summarize(rows,'2026-10-27'),['No activities are saved for Tuesday 27 October.']);
});
test('summary groups current slots only, preserves labels and leaves gaps',()=>{
 const rows=['09:00','09:30','10:30'].map(start_time=>({date:'2026-10-27',start_time,category:'work',subcategory:'Lab'}));
 const result=summarize(rows,'2026-10-27').join('\n');assert.match(result,/09:00–10:00 · Lab/);assert.match(result,/10:30–11:00 · Lab/);assert.match(result,/1.5 hours/);
 assert.equal(queryDate('What did I log yesterday?','2026-10-27'),'2026-10-26');
 assert.equal(queryDate('Move my day to yesterday','2026-10-27'),null);
 assert.equal(queryDate('Show my diary last week','2026-10-27'),null);
});
