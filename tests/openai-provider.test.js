'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {providers,jsonRequest}=require('../server/telegram/providers.cjs');
const {aiConfig,strictSchema,fromWire}=require('../server/telegram/ai-config.cjs');
const empty=()=>({reply:'Ready',questions:[],items:[],reflections:[],actions:[]});
const completed=draft=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:JSON.stringify(draft)}]}]});
test('OpenAI receives bounded, non-stored JSON requests with the cheapest model and existing context',async()=>{
 let sent;const p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'private-test-key',OLLAMA_API_KEY:'must-not-be-used'},async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return Response.json(completed(empty()));});
 const result=await p.interpret('Synthetic request',{today:'2026-11-10',work_companies:[{name:'Atlas',projects:['Research']}]});
 assert.equal(result.reply,'Ready');assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.init.headers.Authorization,'Bearer private-test-key');
 assert.equal(sent.body.model,'gpt-5-nano');assert.equal(sent.body.store,false);assert.equal(sent.body.max_output_tokens,8192);assert.deepEqual(sent.body.reasoning,{effort:'medium'});assert.equal(sent.body.text.format.type,'json_schema');assert.equal(sent.body.text.format.strict,true);assert.ok(sent.body.text.format.schema.properties.actions);
 assert.match(sent.body.input,/JSON/);const data=JSON.parse(sent.body.input.split('\n').slice(1).join('\n'));assert.equal(data.context.work_companies[0].name,'Atlas');assert.ok(data.tools.length);assert.ok(sent.init.signal);assert.equal(sent.init.redirect,'error');assert.equal(sent.body.temperature,undefined);assert.equal(sent.body.think,undefined);
});
test('explicit OpenAI never falls back to the old provider without a key',async()=>{
 let calls=0;const p=providers({AI_PROVIDER:'openai',OLLAMA_API_KEY:'old'},async()=>{calls++;});await assert.rejects(p.interpret('test',{}),e=>e.code==='model_disabled');assert.equal(calls,0);
 assert.equal(aiConfig({OPENAI_API_KEY:'test'}).provider,'openai');assert.throws(()=>aiConfig({AI_PROVIDER:'unknown'}));
});
test('incomplete, refused, missing and schema-invalid OpenAI responses cannot become changes',async()=>{
 for(const value of [{...completed(empty()),status:'incomplete'}, {status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}, {status:'completed',output:[]},completed({...empty(),actions:[{type:'arbitrary_sql'}]})]){
  const p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'test'},async()=>Response.json(value));await assert.rejects(p.interpret('test',{today:'2026-11-10'}),e=>e.code==='model_invalid');
 }
});
test('OpenAI exhausted credits and invalid credentials identify the provider without leaking error bodies',async()=>{
 for(const [status,body,code] of [[429,{error:{code:'insufficient_quota',message:'private account detail'}},'provider_billing'],[429,{error:{code:'rate_limit_exceeded'}},'provider_limit'],[401,{error:{message:'private key detail'}},'provider_auth']]){
  const p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'test'},async()=>Response.json(body,{status}));await assert.rejects(p.interpret('test',{}),e=>e.code===code&&e.provider==='openai'&&!e.message.includes('private'));
 }
});

test('wire nulls preserve explicit clears and required unknowns without weakening validation',()=>{
 const schema={type:'object',properties:{required:{type:['string','null']},optional:{type:'string'},clear:{type:['string','null']},details:{type:'object',properties:{company:{type:'string'}},additionalProperties:false}},required:['required'],additionalProperties:false};
 const wire=strictSchema(schema);assert.deepEqual(wire.required,['required','optional','clear','details']);assert.equal(wire.properties.optional.anyOf[1].type,'null');
 assert.deepEqual(fromWire({required:null,optional:null,clear:null,details:{company:null}},schema),{required:null,clear:null,details:{}});
 const {validate,agentSchema}=require('../server/telegram/domain.cjs');const plan={...empty(),actions:[{type:'commitment_update',target:'commitment:test',due_date:null,next_action:null}]};
 const restored=fromWire(plan,agentSchema);assert.equal(restored.actions[0].due_date,null);assert.ok(!('next_action' in restored.actions[0]));
 assert.throws(()=>validate({...empty(),items:[{category:'not-a-category'}]}));
});
