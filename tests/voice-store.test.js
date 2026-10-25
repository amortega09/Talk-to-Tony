const test=require('node:test'),assert=require('node:assert/strict'),store=require('../voice-store'),A=require('../voice-actions');
const before={category:'work',note:'',sub:'CFD'},after={category:'food',note:'',sub:'Lunch'},date='2026-10-25';
function setup({failDelete=false,foreign=false}={}) {
 const remote={[date]:{'09:00':before}},local=structuredClone(remote),calls=[];let owner='me';
 const client={from(table){let op='read',rows,slots,filters={};const q={
 select(){return q;},eq(k,v){filters[k]=v;return q;},in(k,v){filters[k]=v;slots=v;return q;},order(){return q;},range(){return q;},
 upsert(value){op='upsert';rows=value;return q;},delete(){op='delete';return q;},
 then(resolve){calls.push({op,filters,table});if(foreign)owner='other';
 if(op==='read')return resolve({data:Object.entries(remote).flatMap(([date,day])=>Object.entries(day).map(([start_time,b])=>({date,start_time,...b,subcategory:b.sub})))});
 if(op==='upsert'){for(const r of rows)(remote[r.date] ||= {})[r.start_time]={category:r.category,note:r.note,sub:r.subcategory};return resolve({data:rows});}
 if(failDelete)return resolve({error:Error('offline')});
 for(const slot of slots)delete remote[filters.date][slot];return resolve({data:slots.map(start_time=>({date:filters.date,start_time}))});
 }};return q;}};
 const options={client,owner:'me',currentOwner:()=>owner,local:d=>local[d] || {},localBefore:structuredClone(local),same:A.same,onApplied:patches=>{for(const p of patches){local[p.date] ||= {};if(p.after)local[p.date][p.slot]=p.after;else delete local[p.date][p.slot];}}};
 return {remote,local,calls,options};
}
test('writes are owner scoped, preserve unrelated rows, and can be reversed',async()=>{
 const s=setup(),patches=[{date,slot:'09:00',before,after}];
 await store.apply({...s.options,patches});assert.deepEqual(s.local[date]['09:00'],after);
 await store.apply({...s.options,localBefore:structuredClone(s.local),patches:[{date,slot:'09:00',before:after,after:before}]});
 assert.deepEqual(s.remote[date]['09:00'],before);assert.ok(s.calls.filter(c=>c.op==='read').every(c=>c.filters.user_id==='me'));
});
test('remote changes and local changes after preview prevent all writes',async()=>{
 for(const location of ['local','remote']){const s=setup();s[location][date]['09:00']={...before,note:'new edit'};
 await assert.rejects(store.apply({...s.options,patches:[{date,slot:'09:00',before,after}]}),/changed|edited/);assert.equal(s.calls.filter(c=>c.op!=='read').length,0);}
});
test('unsynced local differences already present at review are not overwritten',async()=>{
 const s=setup();s.local[date]['09:00']={...before,note:'pending edit'};s.options.localBefore=structuredClone(s.local);
 await assert.rejects(store.apply({...s.options,patches:[{date,slot:'09:00',before,after}]}),/versions differ/);
});
test('account switch during preflight prevents writes',async()=>{
 const s=setup({foreign:true});await assert.rejects(store.apply({...s.options,patches:[{date,slot:'09:00',before,after}]}),/account changed/);assert.equal(s.calls.length,1);
});
test('a partially failed move reports confirmed writes and retains the source locally',async()=>{
 const s=setup({failDelete:true}),patches=[{date,slot:'09:00',before,after:null},{date,slot:'11:00',before:null,after:before}];
 await assert.rejects(store.apply({...s.options,patches}),error=>{assert.equal(error.applied.length,1);return /could not be confirmed/.test(error.message);});
 assert.deepEqual(s.local[date]['09:00'],before);assert.deepEqual(s.local[date]['11:00'],before);
 assert.equal(s.calls.at(-1).filters.user_id,'me');
});
