const test=require('node:test'),assert=require('node:assert/strict'),{create}=require('../diary-agent');
const diary={activities:[{activity:'Lab',category:'work'}],entries:[]};
const reply=(questions=[])=>({reply:'Review your draft.',questions,items:[],reflections:[]});
const base={userId:'owner',transcript:'Log Lab',context:{today:'2026-10-22'},previous:null,recall:async()=>diary,think:async()=>reply()};
test('the agent remembers the last question and includes the original topic during recall',async()=>{
 const agent=create();let query,payload;
 const first=await agent.run({...base,transcript:'I did Lab today',think:async()=>reply(['When did Lab start?','When did it end?'])});
 assert.equal(first.question,'When did Lab start?');
 await agent.run({...base,transcript:'Nine until noon',recall:async value=>{query=value.query;return diary;},think:async value=>{payload=value;return reply();}});
 assert.match(query,/I did Lab today/);assert.equal(payload.context.conversation.length,1);assert.equal(payload.context.conversation[0].question,'When did Lab start?');assert.equal(payload.transcript,'Nine until noon');
});
test('conversation memory is bounded and never reused across accounts',async()=>{
 const agent=create();let payload;
 for(let n=0;n<6;n++)await agent.run({...base,transcript:'Private project '+n+'x'.repeat(1400)});
 await agent.run({...base,think:async value=>{payload=value;return reply();}});assert.equal(payload.context.conversation.length,3);assert.ok(payload.context.conversation.every(t=>t.user.length<=1000));
 await agent.run({...base,userId:'other',think:async value=>{payload=value;return reply();}});assert.equal(payload.context.conversation.length,0);
});
test('reset during recall prevents a model request and returns no draft',async()=>{
 const agent=create();let finish,calls=0;
 const pending=agent.run({...base,recall:()=>new Promise(resolve=>finish=resolve),think:async()=>{calls++;return reply();}});
 agent.reset();finish(diary);assert.equal(await pending,null);assert.equal(calls,0);
});
test('reset during inference discards the response and clears conversation',async()=>{
 const agent=create();let finish;
 const pending=agent.run({...base,think:()=>new Promise(resolve=>finish=resolve)});await new Promise(resolve=>setImmediate(resolve));agent.reset();finish(reply());assert.equal(await pending,null);
 let conversation;await agent.run({...base,think:async value=>{conversation=value.context.conversation;return reply();}});assert.equal(conversation.length,0);
});
test('the agent rejects invalid responses without remembering them',async()=>{
 const agent=create();await assert.rejects(agent.run({...base,think:async()=>({items:[]})}),/invalid draft/);
 let conversation;await agent.run({...base,think:async value=>{conversation=value.context.conversation;return reply();}});assert.equal(conversation.length,0);
});
