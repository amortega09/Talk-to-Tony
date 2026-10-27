'use strict';
const {Client,Receiver}=require('@upstash/qstash');
const {UserError,contract,normalizeTimes,validate,alignSleep}=require('./domain.cjs');
class ProviderError extends Error {
  constructor(code,retryAfter=0){super('A provider is temporarily unavailable.');this.code=code;this.retryAfter=retryAfter;}
}
function retrySeconds(value){if(!value)return 0;const n=/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value)-Date.now())/1000);return Number.isFinite(n)?Math.min(86400,Math.max(0,n)):0;}
async function bounded(response,limit) {
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new UserError('The uploaded file is too large.');}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new UserError('The uploaded file is too large.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonRequest(fetch,url,body,headers={},timeout=12000) {
  let response;
  try {response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}
  catch {throw new ProviderError('provider_network');}
  if(!response.ok){await response.body?.cancel();throw new ProviderError(response.status===429?'provider_limit':response.status===401||response.status===403?'provider_auth':'provider_http',retrySeconds(response.headers.get('retry-after')));}
  try {return JSON.parse((await bounded(response,1000000)).toString());}catch {throw new ProviderError('provider_response');}
}
// Parse complete Ogg pages and Opus granule positions. Metadata alone is not a
// duration limit; never send an arbitrary attachment to the speech provider.
function opusDuration(buffer) {
  let offset=0,serial,sequence=0,granule=0n,preSkip=0,ended=false,packetComplete=false;
  while(offset<buffer.length){
    if(ended || offset+27>buffer.length || buffer.toString('ascii',offset,offset+4)!=='OggS' || buffer[offset+4]!==0)throw new UserError('Send a Telegram voice note in OGG/Opus format.');
    const flags=buffer[offset+5],s=buffer.readUInt32LE(offset+14),seq=buffer.readUInt32LE(offset+18),count=buffer[offset+26];
    if(offset+27+count>buffer.length || seq!==sequence++)throw new UserError('The voice recording is incomplete. Please send it again.');
    if(serial===undefined)serial=s;else if(serial!==s)throw new UserError('Multiple audio streams are not supported.');
    const start=offset+27+count;let size=0;for(let i=0;i<count;i++)size+=buffer[offset+27+i];
    if(start+size>buffer.length)throw new UserError('The voice recording is incomplete.');
    if(offset===0){if(!(flags&2)||size<19||buffer.toString('ascii',start,start+8)!=='OpusHead'||buffer[start+9]!==1)throw new UserError('Send a mono Telegram voice note.');preSkip=buffer.readUInt16LE(start+10);}
    const g=buffer.readBigUInt64LE(offset+6);if(g!==0xffffffffffffffffn){if(g<granule)throw new UserError('Invalid audio timing.');granule=g;}
    if(granule>BigInt(120*48000+preSkip))throw new UserError('Keep voice notes under two minutes.');
    packetComplete=count>0 && buffer[offset+26+count]<255;
    ended=!!(flags&4);offset=start+size;
  }
  // Telegram iOS can omit EOS on a complete final page. Require a finished
  // packet and positive audio timing, rather than that optional-in-practice flag.
  if(!packetComplete || granule<=BigInt(preSkip))throw new UserError('The voice recording has no complete audio.');
  return Number(granule-BigInt(preSkip))/48000;
}
function providers(env=process.env,fetch=globalThis.fetch) {
  const token=env.TELEGRAM_BOT_TOKEN;
  const telegram=async(method,body)=>{
    const r=await jsonRequest(fetch,`https://api.telegram.org/bot${token}/${method}`,body);
    if(!r.ok)throw new ProviderError('telegram_response');return r.result;
  };
  return {
    async send(chatId,payload){return telegram('sendMessage',{chat_id:chatId,text:payload.text,reply_markup:payload.reply_markup,link_preview_options:{is_disabled:true}});},
    async acknowledge(id){return telegram('answerCallbackQuery',{callback_query_id:id});},
    async transcribe(voice){
      if(!env.GROQ_API_KEY)throw new UserError('Voice is not configured yet. Send text for now.','voice_disabled');
      const file=await telegram('getFile',{file_id:voice.fileId});
      if(!file.file_path || !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) || file.file_path.includes('..') || file.file_path.startsWith('/') || file.file_size>10000000)throw new UserError('This voice recording cannot be downloaded.');
      let response;
      try {response=await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`,{redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new ProviderError('audio_download');}
      if(!response.ok){await response.body?.cancel();throw new ProviderError('audio_download');}
      const bytes=await bounded(response,10000000),seconds=opusDuration(bytes);
      // Do not permit a spoofed duration to bypass the reserved audio quota.
      if(seconds>voice.duration+2)throw new UserError('Audio duration did not match the voice note. Please resend it.');
      const form=new FormData();form.set('file',new Blob([bytes],{type:'audio/ogg'}),'voice.ogg');form.set('model','whisper-large-v3-turbo');form.set('language','en');form.set('response_format','verbose_json');
      let r;try{r=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`},body:form,signal:AbortSignal.timeout(20000)});}catch{throw new ProviderError('speech_network');}
      if(!r.ok){await r.body?.cancel();throw new ProviderError(r.status===429?'speech_limit':'speech_http',retrySeconds(r.headers.get('retry-after')));}
      let value;try{value=JSON.parse((await bounded(r,200000)).toString());}catch{throw new ProviderError('speech_response');}
      const text=value.text?.trim();
      if(!text || text.length>12000 || /^\[(?:silence|blank_audio)\]$/i.test(text) || (value.segments?.length && value.segments.every(s=>s.no_speech_prob>0.8)))throw new UserError('I could not hear clear speech. Try again or send text.');
      return text;
    },
    async interpret(text,context,previous){
      if(!env.OLLAMA_API_KEY)throw new UserError('AI interpretation is not configured yet.','model_disabled');
      const transcript=normalizeTimes(text),data={transcript,context,previous_draft:previous || null};
      if(JSON.stringify(data).length>60000)throw new UserError('This request is too large. Split it into smaller changes.');
      const model=contract.model;
      data.conversation_rule='Be warm and concise. Current database diary, targets and current_day are authoritative. Conversation and recent_changes are historical and may have been moved, deleted or overwritten on the web. Never claim an entry is currently saved based only on conversation or receipts. Zero current_day.recorded_slots means no timed activities saved today. Use context.conversation for follow-ups, dates being discussed, and recent_changes with exact saved patches. Only edit entries identified by the user. If a correction refers to earlier changes, use activity_update with current target IDs, never create duplicate items. Ask a brief question if the scope or date is unclear. Answer read-only questions naturally without calling them drafts. Never claim a change was saved; the server confirms saving.';
      data.format_rule='Reuse exact labels from context.app.activity_formats. Category-only entries such as Sleep or Gym use their category label. Do not invent a new label when a saved one fits. Preserve existing names on edits unless explicitly asked to rename.';
      const result=await jsonRequest(fetch,'https://ollama.com/api/chat',{model,stream:false,messages:[{role:'system',content:contract.system+'\nRequired JSON schema: '+JSON.stringify(contract.schema)},{role:'user',content:JSON.stringify(data)}],options:{temperature:0,num_ctx:32768,num_predict:2500},think:contract.thinking[model]}, {Authorization:`Bearer ${env.OLLAMA_API_KEY}`},40000);
      let draft;
      try{let content=result.message.content.trim();if(content.startsWith('```')&&content.endsWith('```'))content=content.split('\n').slice(1,-1).join('\n');draft=JSON.parse(content);}catch{throw new UserError('The AI returned an invalid draft. Please retry.','model_invalid');}
      // The model sometimes represents an absent new-entry note as null.
      // Normalize only that empty optional content; action edits stay strict.
      if(Array.isArray(draft?.items))for(const item of draft.items)if(item && item.note===null)item.note='';
      return alignSleep(validate(draft),transcript,context.today);
    }
  };
}
function queue(env=process.env,fetch=globalThis.fetch) {
  const url=new URL('/api/telegram/worker',env.TELEGRAM_PUBLIC_ORIGIN).href;
  const client=new Client({token:env.QSTASH_TOKEN,baseUrl:'https://qstash.upstash.io',retry:{retries:0},devMode:false});
  const receiver=new Receiver({currentSigningKey:env.QSTASH_CURRENT_SIGNING_KEY,nextSigningKey:env.QSTASH_NEXT_SIGNING_KEY,devMode:false});
  return {url,
    publish:(jobId,stage='work')=>jsonRequest(fetch,`https://qstash.upstash.io/v2/publish/${url}`,{jobId},{Authorization:`Bearer ${env.QSTASH_TOKEN}`,'Upstash-Retries':'3','Upstash-Retry-Delay':'min(30000,1000*pow(2,retried))','Upstash-Timeout':'55s','Upstash-Deduplication-Id':require('node:crypto').createHash('sha256').update(`${jobId}:${stage}`).digest('hex')},5000),
    verify:(signature,body)=>receiver.verify({signature,body,url}),
    schedule:()=>client.schedules.create({destination:url,cron:'*/15 * * * *',body:JSON.stringify({recover:true}),headers:{'Content-Type':'application/json'}})
  };
}
module.exports={ProviderError,bounded,jsonRequest,opusDuration,providers,queue};
