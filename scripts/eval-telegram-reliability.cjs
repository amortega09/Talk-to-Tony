'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {providers}=require('../server/telegram/providers.cjs');
const {scenarios}=require('./eval/contracts.cjs');
const {evaluate,writeReport,hash}=require('./eval/runner.cjs');
function options(args){
 const o={repeat:1,seed:1,maxRequests:100};
 for(let i=0;i<args.length;i++){
  const name=args[i];if(name==='--live'){o.live=true;continue;}if(name==='--help'){o.help=true;continue;}
  const fields={'--models':'models','--repeat':'repeat','--seed':'seed','--max-requests':'maxRequests','--out':'out','--replay':'replay','--cases':'cases'};
  if(!fields[name]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Unknown or missing option: '+name);
  o[fields[name]]=args[++i];
 }
 for(const k of ['repeat','seed','maxRequests']){o[k]=Number(o[k]);if(!Number.isSafeInteger(o[k])||o[k]<1||o[k]>(k==='repeat'?20:k==='maxRequests'?500:4294967295))throw Error('Invalid '+k);}
 if(o.live&&o.replay)throw Error('Choose live or replay');
 return o;
}
function validateReplay(source){
 if(source?.version!==1||!Array.isArray(source.results)||!Array.isArray(source.models)||!source.models.length||!Array.isArray(source.caseIds)||!source.caseIds.length||!Number.isInteger(source.repeat)||source.repeat<1||source.repeat>20||!Number.isInteger(source.seed)||source.seed<1)throw Error('Invalid replay report; no requests were made');
 return source;
}
async function main(args){
 const o=options(args);
 if(o.help||(!o.live&&!o.replay)){console.log('Usage: node --env-file=.env scripts/eval-telegram-reliability.cjs --live --models gpt-6-luna --repeat 3 --seed 42 --max-requests 100\nOffline: node scripts/eval-telegram-reliability.cjs --replay PATH/report.json\nOptional: --cases comma,separated,ids --out DIRECTORY\nOnly invented fixtures are sent. No database or Telegram access. Default invocation makes no requests.');return;}
 const source=o.replay?validateReplay(JSON.parse(fs.readFileSync(o.replay,'utf8'))):null;
 const models=(o.models?o.models.split(','):source?.models || [process.env.OPENAI_MODEL || 'gpt-6-luna']);
 if(models.some(m=>!/^gpt-[a-zA-Z0-9.-]+$/.test(m))||new Set(models).size!==models.length)throw Error('Expected unique OpenAI GPT model names');
 const selected=o.cases?o.cases.split(','):source?.caseIds;
 if(selected?.some(id=>!scenarios.some(s=>s.id===id)))throw Error('Unknown case id');
 const suite=selected?scenarios.filter(s=>selected.includes(s.id)):scenarios;
 const dir=path.resolve(o.out || path.join('.day-voice','evals',new Date().toISOString().replace(/[:.]/g,'-')+(source?'-replay':'')));
 if(o.replay&&path.resolve(o.replay)===path.join(dir,'report.json'))throw Error('Replay output must not overwrite its source report');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 let revision='unknown',dirty=true;try{revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();}catch{}
 const sourceFiles=['scripts/eval-telegram-reliability.cjs','scripts/eval/contracts.cjs','scripts/eval/runner.cjs','scripts/eval-telegram-organisation.cjs','server/telegram/providers.cjs','server/telegram/ai-config.cjs','server/telegram/domain.cjs','server/telegram/discussion.cjs','server/telegram/agent-prompt.cjs','server/telegram/agent-tools.cjs','server/telegram/voice-contract.json','voice-actions.js','activity-model.js'];
 const sourceHash=hash(sourceFiles.map(file=>[file,fs.readFileSync(path.join(__dirname,'..',file),'utf8')]));
 const metadata={version:1,createdAt:new Date().toISOString(),revision,dirty,sourceHash,mode:source?'offline-planner-replay':'live',models,caseIds:suite.map(s=>s.id),repeat:source?.repeat || o.repeat,seed:source?.seed || o.seed,fixtureHash:hash(suite),node:process.version,limits:{maxRequests:o.maxRequests},scope:'Synthetic interpretation, discussion date binding, planning, simulated state. No real delivery or persistence.'};
 const completed=[];
 const result=await evaluate({scenarios:suite,models,repeat:metadata.repeat,seed:metadata.seed,maxRequests:o.maxRequests,replay:source?.results,
  async interpret(model,text,ctx,previous,turn){
   if(source)throw Error('Network interpretation is forbidden in replay');
   // Only these explicit configuration values reach the provider. Production settings
   // and any unrelated credentials cannot be used by this evaluation process.
   const env={AI_PROVIDER:'openai',OPENAI_MODEL:model,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
   const guardedFetch=async(url,init)=>{
    if(String(url)!=='https://api.openai.com/v1/responses')throw Error('Evaluation network destination denied');
    const request=JSON.parse(init.body);
    const capture={requestHash:hash(request),model:request.model,request};turn.requests.push(capture);
    const response=await fetch(url,init);
    capture.status=response.status;capture.requestId=response.headers.get('x-request-id');
    // Never record headers or provider error bodies (which can contain account data).
    if(response.ok){capture.response=await response.clone().json();capture.usage=capture.response.usage;}
    return response;
   };
   return providers(env,guardedFetch).interpret(text,ctx,previous);
  },
  onResult(r){completed.push(r);writeReport(dir,{...metadata,results:completed,summary:require('./eval/runner.cjs').summarize(completed,models.length*suite.length*metadata.repeat)});console.log(JSON.stringify({model:r.model,id:r.id,repetition:r.repetition,status:r.status,error:r.error}));}
 });
 const report={...metadata,...result};writeReport(dir,report);
 console.log(JSON.stringify({summary:report.summary,report:path.join(dir,'report.json')}));
 process.exitCode=report.summary.accepted?0:1;
}
module.exports={options,validateReplay,main};
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
