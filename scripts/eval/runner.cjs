'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const D=require('../../server/telegram/domain.cjs'),discussion=require('../../server/telegram/discussion.cjs');
const {check}=require('./contracts.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function shuffle(list,seed){let n=seed>>>0;return list.map(x=>({x,sort:((n=(Math.imul(n,1664525)+1013904223)>>>0)/2**32)})).sort((a,b)=>a.sort-b.sort).map(p=>p.x);}
function summarize(results,scheduled){
 const counts={scheduled,attempted:results.filter(r=>r.status!=='skipped').length,passed:0,task:0,safety:0,provider:0,harness:0,skipped:0};
 for(const r of results)counts[r.status]=(counts[r.status] || 0)+1;
 const groups=new Map();for(const r of results){const k=`${r.model}/${r.id}`;(groups.get(k)||groups.set(k,[]).get(k)).push(r.status);}
 return {...counts,pending:Math.max(0,scheduled-results.length),consistentCases:[...groups.values()].filter(g=>g.every(s=>s==='passed')).length,totalCases:groups.size,accepted:results.length===scheduled&&counts.passed===scheduled&&scheduled>0};
}
function classify(error){if(['task','safety','provider','harness'].includes(error.kind))return error.kind;if(/^(provider_|model_disabled)/.test(error.code || ''))return 'provider';if(error.code==='model_invalid'||error.code==='invalid_request')return 'task';return 'harness';}
async function evaluate({scenarios,models,repeat=1,seed=1,maxRequests=Infinity,interpret,onResult=()=>{},replay=null}){
 const jobs=shuffle(models.flatMap(model=>scenarios.flatMap(s=>Array.from({length:repeat},(_,i)=>({model,scenario:s,repetition:i+1})))),seed);
 let calls=0,blocked=false;const results=[];
 for(const {model,scenario:s,repetition} of jobs){
  const result={model,id:s.id,repetition,fixtureHash:hash(s),status:'passed',turns:[]},started=Date.now();
  let rows=structuredClone(s.rows),previous,conversation=[],focus=s.focusDate;
  if(blocked||calls>=maxRequests){result.status='skipped';result.error=blocked?'Provider unavailable':'Request budget exhausted';}
  else for(let index=0;index<s.turns.length;index++){
   const t=s.turns[index],turn={index,text:t.text,requests:[]};result.turns.push(turn);
   try{
    if(calls>=maxRequests){result.status='skipped';result.error='Request budget exhausted mid-scenario';break;}
    const session=discussion.resolve(t.text,s.time,focus?{focusDate:focus,expiresAt:'2099-01-01T00:00:00Z'}:{});
    const ctx=D.context(rows,t.text,s.time,conversation,{discussionDate:session.date});
    turn.contextHash=hash(ctx);calls++;
    const recorded=replay?.find(r=>r.model===model&&r.id===s.id&&r.repetition===repetition);
    let draft;
    if(replay){
     if(!recorded||recorded.fixtureHash!==result.fixtureHash)throw Object.assign(Error('Replay fixture is missing or changed'),{kind:'harness'});
     const saved=recorded.turns[index];
     if(!saved||saved.contextHash!==turn.contextHash)throw Object.assign(Error('Replay context is missing or changed'),{kind:'harness'});
     if(!saved.draft)throw Object.assign(Error(saved.error || 'No draft captured'),{kind:['task','safety','provider','harness'].includes(recorded.status)?recorded.status:'harness'});
     draft=structuredClone(saved.draft);
    }else draft=await interpret(model,t.text,ctx,previous,turn);
    turn.draft=structuredClone(draft);
    draft=discussion.bindDraft(draft,session,t.text);
    const issue=discussion.checkDraft(draft,session,t.text);if(issue)throw Object.assign(Error(issue),{kind:'task'});
    const review=D.plan(draft,rows,ctx.app.targets,{strict:true});turn.review=review;
    rows=check(t.contract,rows,review,t.checkReview);
    // Only synthetic approved plans advance this simulator. No persistence, Telegram,
    // confirmation UI, delivery retry or authentication coverage is claimed here.
    turn.simulatedApproval=!!review.requiresConfirmation;
    previous=review.questions.length?draft:undefined;
    conversation.push({user:t.text,assistant:(review.questions.length?review.questions:review.answers.length?review.answers:review.summaries).join('\n')});
    focus=session.date;
   }catch(e){
    result.status=classify(e);turn.error=e.message;turn.code=e.code;result.error=e.message;
    if(['provider_auth','provider_billing','model_disabled'].includes(e.code))blocked=true;
    break;
   }
  }
  result.ms=Date.now()-started;results.push(result);await onResult(result);
 }
 const usage={inputTokens:0,outputTokens:0,cachedInputTokens:0};
 for(const r of results)for(const t of r.turns)for(const q of t.requests){usage.inputTokens+=q.usage?.input_tokens || 0;usage.outputTokens+=q.usage?.output_tokens || 0;usage.cachedInputTokens+=q.usage?.input_tokens_details?.cached_tokens || 0;}
 return {results,summary:summarize(results,jobs.length),requests:calls,usage};
}
function writeReport(dir,report){
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const jsonPath=path.join(dir,'report.json');
 fs.writeFileSync(jsonPath+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(jsonPath+'.tmp',jsonPath);
 const s=report.summary;
 const lines=['# Synthetic Telegram interpretation evaluation','',`Accepted: **${s.accepted}**. Passed ${s.passed}/${s.scheduled}; safety ${s.safety}; task ${s.task}; provider ${s.provider}; harness ${s.harness}; skipped ${s.skipped}; pending ${s.pending}.`, `Consistent cases: ${s.consistentCases}/${s.totalCases}. Seed: ${report.seed}. Revision: ${report.revision}.`,'','This tests interpretation, date binding and planning against invented data. State changes and approvals are simulated. It does not test delivery, authentication, persistence or the real Telegram UI.','','| Model | Case | Repeat | Result | Reason |','| --- | --- | --- | --- | --- |'];
 for(const r of report.results)lines.push(`| ${r.model} | ${r.id} | ${r.repetition} | ${r.status} | ${(r.error || '').replace(/[|\r\n]/g,' ')} |`);
 fs.writeFileSync(path.join(dir,'summary.md'),lines.join('\n')+'\n',{mode:0o600});
}
module.exports={evaluate,summarize,shuffle,writeReport,hash};
