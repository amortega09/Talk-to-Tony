'use strict';
const {timingSafeEqual}=require('node:crypto');
const {Store,poolFromEnv}=require('./store.cjs');
const {Service,parseUpdate}=require('./service.cjs');
const {providers,queue}=require('./providers.cjs');
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!a)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
async function raw(req,limit=64000){
  // Web-standard Request preserves the original bytes for signature verification.
  const chunks=[];let size=0;
  for await(const chunk of (req.body || [])){const b=Buffer.from(chunk);size+=b.length;if(size>limit)throw new Error('body_limit');chunks.push(b);}
  return Buffer.concat(chunks).toString('utf8');
}
function reply(status){return Response.json({ok:status===200},{status,headers:{'Cache-Control':'no-store'}});}
let singleton;
function runtime(env=process.env){
  if(singleton)return singleton;
  for(const name of ['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_PUBLIC_ORIGIN','TELEGRAM_DATABASE_URL','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY'])if(!env[name])throw new Error('Missing bot configuration');
  const origin=new URL(env.TELEGRAM_PUBLIC_ORIGIN);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Use an HTTPS origin');
  if(!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN)||env.TELEGRAM_WEBHOOK_SECRET.length<32)throw new Error('Invalid bot credentials');
  const store=new Store(poolFromEnv(env)),q=queue(env);
  singleton={service:new Service({store,queue:q,providers:providers(env),writesEnabled:env.TELEGRAM_WRITES_ENABLED==='1'}),queue:q};return singleton;
}
function handlers({env=process.env,getRuntime=()=>runtime(env)}={}) {
  return {
    async webhook(req){
      if(req.method!=='POST')return reply(405);
      if(env.TELEGRAM_ENABLED!=='1')return reply(503);
      if(!equal(req.headers.get('x-telegram-bot-api-secret-token'),env.TELEGRAM_WEBHOOK_SECRET))return reply(401);
      let input;try{input=parseUpdate(JSON.parse(await raw(req)));}catch{return reply(400);}
      if(!input)return reply(200);
      try {await getRuntime().service.ingest(env.TELEGRAM_BOT_TOKEN.split(':')[0],input);return reply(200);}catch{return reply(503);}
    },
    async worker(req){
      if(req.method!=='POST')return reply(405);
      if(env.TELEGRAM_ENABLED!=='1'||env.TELEGRAM_PROCESSING_ENABLED!=='1')return reply(503);
      let body,runtime;
      try{body=await raw(req,1024);runtime=getRuntime();if(!await runtime.queue.verify(req.headers.get('upstash-signature'),body))return reply(401);}catch{return reply(401);}
      let data;try{data=JSON.parse(body);}catch{return reply(400);}
      if(!data || typeof data!=='object' || Array.isArray(data))return reply(400);
      try{
        if(data.recover===true && Object.keys(data).length===1)await runtime.service.recover();
        else if(typeof data.jobId==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(data.jobId)&&Object.keys(data).length===1){const result=await runtime.service.process(data.jobId);if(result?.retry)return reply(503);}
        else return reply(400);
        return reply(200);
      } catch(e) {const response=reply(503);response.headers.set('Retry-After',String(Math.min(86400,Math.max(2,Number(e.retryAfter) || 2))));return response;}
    }
  };
}
module.exports={handlers,equal,raw,runtime};
