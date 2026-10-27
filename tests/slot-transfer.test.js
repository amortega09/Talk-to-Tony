const {test}=require('node:test');const assert=require('node:assert/strict');const {plan}=require('../slot-transfer');
test('moves selected recorded slots across month/year boundaries preserving full data',()=>{
 const block={category:'gym',sub:'',note:'{"exercises":[{"name":"Squat"}]}'};
 const source={'09:00':block,'09:30':{category:'food'},__reflect__:{note:'keep'}};
 const result=plan('2026-01-01',source,{},['09:00','10:00']);
 assert.equal(result.date,'2025-12-31');assert.deepEqual(result.to['09:00'],block);assert.equal(result.from['09:00'],undefined);assert.deepEqual(result.from.__reflect__,source.__reflect__);assert.ok(source['09:00']);assert.notEqual(result.to['09:00'],block);
});
test('rejects destination collisions and empty selections without mutating either day',()=>{
 const source={'09:00':{category:'work'}};const destination={'09:00':{category:'sleep'}};
 assert.throws(()=>plan('2026-10-26',source,destination,['09:00']),/already/);
 assert.throws(()=>plan('2026-10-26',source,{},['10:00']),/Select/);
 assert.equal(source['09:00'].category,'work');assert.equal(destination['09:00'].category,'sleep');
});
