'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {providers,jsonRequest}=require('../server/telegram/providers.cjs');
const {aiConfig,strictSchema,fromWire}=require('../server/telegram/ai-config.cjs');
const empty=()=>({reply:'Ready',questions:[],items:[],reflections:[],actions:[]});
const completed=draft=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:JSON.stringify(draft)}]}]});
test('OpenAI receives bounded, non-stored JSON requests with the tested low-cost model and existing context',async()=>{
 let sent;const p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'private-test-key',OLLAMA_API_KEY:'must-not-be-used'},async(url,init)=>{sent={url,init,body:JSON.parse(init.body)};return Response.json(completed(empty()));});
 const result=await p.interpret('Synthetic request',{today:'2026-11-10',work_companies:[{name:'Atlas',projects:['Research']}]});
 assert.equal(result.reply,'Ready');assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.init.headers.Authorization,'Bearer private-test-key');
 assert.equal(sent.body.model,'gpt-6-luna');assert.equal(sent.body.store,false);assert.equal(sent.body.max_output_tokens,8192);assert.deepEqual(sent.body.reasoning,{effort:'medium'});assert.equal(sent.body.text.format.type,'json_schema');assert.equal(sent.body.text.format.strict,true);assert.ok(sent.body.text.format.schema.properties.actions);
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

test('sole Work item preserves the explicitly stated company and project even if nano omitted them',()=>{
 const {explicitWorkDetails}=require('../server/telegram/ai-config.cjs');const catalog=[{name:'Atlas',projects:['Research','Review draft']},{name:'Orion',projects:['Build']}];
 const make=()=>({...empty(),items:[{category:'work',details:{}}]});
 assert.deepEqual(explicitWorkDetails(make(),'I worked for Atlas on Research.',catalog).items[0].details,{company:'Atlas',project:'Research'});
 assert.deepEqual(explicitWorkDetails(make(),'Log company Atlas on task Review draft.',catalog).items[0].details,{company:'Atlas',project:'Review draft'});
 for(const text of ['I worked on Research.','I worked for Atlas.','I worked for Atlas on Build.','I worked for Atlas, not on Research.','I worked for Atlas on Research and for Orion on Build.','I worked for Atlas on Researcher.'])assert.ok(require('../activity-model').workError(explicitWorkDetails(make(),text,catalog).items[0],catalog));
 const multiple=make();multiple.items.push({category:'work',details:{}});explicitWorkDetails(multiple,'I worked for Atlas on Research.',catalog);assert.ok(multiple.items.every(i=>!i.details.company));
});

test('simple new timed entries use low reasoning; edits, reads, repetitions and follow-ups keep medium',()=>{
 const {reasoningEffort}=require('../server/telegram/ai-config.cjs');assert.equal(reasoningEffort('I travelled by train from noon until one.'),'low');assert.equal(reasoningEffort('Log work for Atlas on Research from 9 to 10.'),'low');
 for(const t of ['Move my meeting from nine to ten.','What did I do from nine to ten?','Repeat the same work from nine to ten.','Add company Boreal and work from nine to ten.'])assert.equal(reasoningEffort(t),'medium');assert.equal(reasoningEffort('Travel from nine to ten.',{}),'medium');
});

test('native action dates and clocks are constrained before interpretation',()=>{
 const schema=strictSchema(require('../server/telegram/domain.cjs').agentSchema),actions=schema.properties.actions.anyOf?.find(s=>s.type==='array') || schema.properties.actions,legacy=actions.items.anyOf[0];
 assert.match(legacy.properties.start.pattern,/00/);assert.ok(legacy.properties.end_date.pattern);
 const Ajv=require('ajv'),check=new Ajv({strict:false,allowUnionTypes:true}).compile(legacy.properties.end);assert.equal(check('broken JSON in a clock'),false);assert.equal(check('12:30'),true);assert.equal(check(null),true);
});
test('a model cannot invent permission to clear workouts',async()=>{
 const d={...empty(),actions:[{type:'gym_workout',date:'2026-11-10',start:'14:00',end:'15:00',sessions:[],clear_sessions:true}]};
 const p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'test'},async()=>Response.json(completed(d)));
 await assert.rejects(p.interpret('Replace Squat with Bench press, three sets of eight at 40kg.',{today:'2026-11-10'}),/clear all workout/);
 assert.equal((await p.interpret('Clear all exercises in my gym workout.',{today:'2026-11-10'})).actions[0].clear_sessions,true);
});

test('a company/project mismatch cannot be silently reassigned to the project owner',()=>{
 const {explicitWorkDetails:f}=require('../server/telegram/ai-config.cjs'),D=require('../server/telegram/domain.cjs'),catalog=[{name:'Atlas',projects:['Research']},{name:'Orion',projects:['Build']}];
 const draft={...empty(),items:[{date:'2026-11-10',start:'11:00',end_date:'2026-11-10',end:'12:00',category:'work',activity:'Work',note:'',details:{company:'Orion',project:'Build'}}]};
 f(draft,'Record Atlas / Build work. Build belongs to Orion; I am not authorising any new projects.',catalog);
 assert.deepEqual(draft.items[0].details,{company:'Atlas',project:'Build'});
 const rows=[{date:'2000-01-01',start_time:'__settings__',category:'settings',note:JSON.stringify({workHierarchyVersion:1,workCompanies:catalog})}],ctx=D.context(rows,'Work',{today:'2026-11-10',local_time:'12:00'}),review=D.plan(draft,rows,ctx.app.targets,{strict:true});assert.equal(review.patches.length,0);assert.equal(review.questions.length,1);
 const prior={...empty(),items:[{category:'work',details:{company:'',project:'Research'}}]},answer={...empty(),items:[{category:'work',details:{company:'Orion',project:'Build'}}]};f(answer,'Atlas',catalog,prior);assert.deepEqual(answer.items[0].details,{company:'Atlas',project:'Research'});
});

test('company names inside a project title and project names matching a company do not imply selection',()=>{
 const {explicitWorkDetails:f}=require('../server/telegram/ai-config.cjs'),catalog=[{name:'Atlas',projects:['Atlas report','Atlas','Research']}],make=()=>({...empty(),items:[{category:'work',details:{company:'Atlas',project:'Atlas report'}}]});
 assert.equal(f(make(),'Log work on project Atlas report from 9 to 10.',catalog).items[0].details.company,'');
 assert.equal(f(make(),'Log work for company Atlas from 9 to 10.',catalog).items[0].details.project,'');
});

test('a model cannot register a company or project without the user requesting it',async()=>{
 const d={...empty(),actions:[{type:'work_project_add',company:'Atlas',project:'Build'}]},p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'test'},async()=>Response.json(completed(d)));
 await assert.rejects(p.interpret('Record Atlas / Build work. I am not authorising any new projects.',{today:'2026-11-10'}),/explicitly request/);
 assert.equal((await p.interpret('Add project Build under company Atlas.',{today:'2026-11-10'})).actions[0].project,'Build');
});

test('read-only questions cannot be silently converted into mutations',async()=>{
 const d={...empty(),actions:[{type:'objective_add',date:'2026-11-10',text:'Invented'}]},p=providers({AI_PROVIDER:'openai',OPENAI_API_KEY:'test'},async()=>Response.json(completed(d)));
 await assert.rejects(p.interpret('What objectives are saved today?',{today:'2026-11-10'}),/question safely/);
 assert.equal((await p.interpret('Show today and also add an objective called Invented.',{today:'2026-11-10'})).actions.length,1);
});
