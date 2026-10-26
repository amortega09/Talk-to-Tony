'use strict';
const fs=require('node:fs');
if(fs.existsSync('.env'))process.loadEnvFile('.env');
const {Store,poolFromEnv}=require('../server/telegram/store.cjs');
const {queue,jsonRequest}=require('../server/telegram/providers.cjs');
async function main(){
  const cmd=process.argv[2],env=process.env;
  if(cmd==='check'){
    const names=['TELEGRAM_BOT_TOKEN','TELEGRAM_BOT_USERNAME','TELEGRAM_WEBHOOK_SECRET','TELEGRAM_PUBLIC_ORIGIN','TELEGRAM_DATABASE_URL','GROQ_API_KEY','OLLAMA_API_KEY','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY'];
    for(const name of names)console.log(`${name}: ${env[name]?'set':'missing'}`);
    return;
  }
  if(cmd==='link'){
    if(!/^[A-Za-z0-9_]+bot$/i.test(env.TELEGRAM_BOT_USERNAME || ''))throw new Error('Configure TELEGRAM_BOT_USERNAME');
    const pool=poolFromEnv(env);try{const token=await new Store(pool).link();console.log(`Single-use link (expires in 10 minutes; keep private):\nhttps://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}`);}finally{await pool.end();}return;
  }
  if(cmd==='webhook'){
    const origin=new URL(env.TELEGRAM_PUBLIC_ORIGIN);if(origin.protocol!=='https:' || origin.origin!==env.TELEGRAM_PUBLIC_ORIGIN.replace(/\/$/,''))throw new Error('Configure an HTTPS origin');
    if((env.TELEGRAM_WEBHOOK_SECRET || '').length<32)throw new Error('Set a long random webhook secret');
    const r=await jsonRequest(fetch,`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,{url:new URL('/api/telegram/webhook',origin).href,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],max_connections:1,drop_pending_updates:false});
    if(!r.ok)throw new Error('Telegram rejected the webhook');console.log('Webhook registered.');return;
  }
  if(cmd==='schedule'){await queue(env).schedule();console.log('Recovery schedule created. Run this once; inspect QStash before creating another.');return;}
  console.log('Usage: npm run telegram:admin -- check|link|webhook|schedule\nReads ignored .env. check is offline; other commands require configured services.');
}
main().catch(()=>{console.error('Setup failed. Check private configuration and provider status; no credential details were logged.');process.exitCode=1;});
