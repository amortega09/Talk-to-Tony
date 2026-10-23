const test = require('node:test'), assert = require('node:assert/strict');
const voice = require('../voice-draft'), range = require('../event-range'), historyContext=require('../voice-context');
const item = changes => ({ date:'2026-10-20',start:'09:00',end_date:'2026-10-20',end:'12:00',category:'work',activity:'CFD',note:'',...changes });
const draft = items => ({ reply:'Review this draft.',questions:[],items,reflections:[] });
test('valid drafts generate app-native slots and preserve activity names',()=>{
 const result=voice.plan(draft([item()]),range);assert.deepEqual(result.errors,[]);assert.equal(result.slots.length,6);assert.equal(result.slots[0].block.sub,'CFD');
});
test('unknown times, invalid categories, overlaps, unsupported boundaries and long ranges block saving',()=>{
 for(const items of [[item({start:null})],[item({category:'madeup'})],[item(),item()],[item({start:'09:15'})],[item({end_date:'2026-11-20'})]])assert.ok(voice.plan(draft(items),range).errors.length);
});
test('overnight drafts and dated reflections retain correct days',()=>{
 const d=draft([item({start:'23:00',end_date:'2026-10-21',end:'01:00'})]);d.reflections=[{date:'2026-10-20',text:'A good day'}];
 const result=voice.plan(d,range);assert.equal(result.errors.length,0);assert.equal(result.slots.length,4);assert.equal(result.slots[2].date,'2026-10-21');assert.equal(result.reflections[0].text,'A good day');
});
test('only exact loopback HTTP helper origins are accepted',()=>{
 assert.equal(voice.helperOrigin('http://127.0.0.1:8765'),'http://127.0.0.1:8765');
 for(const url of ['https://example.com','http://127.0.0.1.evil.com','http://user:password@localhost:8765','http://localhost:8765/path','http://localhost:8765/?token=secret'])assert.throws(()=>voice.helperOrigin(url));
});
const fs=require('node:fs'),vm=require('node:vm');
function app({initial={},confirm=true,sb=null}={}) {
 const elements={},store=structuredClone(initial);const get=id=>elements[id] ||= {value:'',disabled:false,hidden:false,inert:false,dataset:{},textContent:'',innerHTML:'',addEventListener(){},focus(){}};
 const ctx={document:{getElementById:get},localStorage:{getItem(){return null;},setItem(){}},DayVoiceDraft:voice,DayEventRange:range,DayVoiceContext:historyContext,DayDiaryAgent:require('../diary-agent'),window:{confirm:()=>confirm},navigator:{},RECOVERY_MODE:false,USER_ID:'test',sb,
 activityOptions:()=>[],SLOTS:[],to12:x=>x,catLabel:x=>x,escapeHtml:x=>x,loadLocal:date=>structuredClone(store[date]||{}),saveLocal:(date,day)=>store[date]=structuredClone(day),current:new Date('2026-10-20T12:00Z'),data:{},REFLECT_KEY:'__reflect__',ymd:()=> '2026-10-20',render(){},setStatus(){},setTimeout,clearTimeout,AbortController,Blob,URL,Intl};
 vm.createContext(ctx);const source=fs.readFileSync(require.resolve('../voice.js'),'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.testVoice = { state, save, buttons, close, record, connect, open, build, recordInBrowser };})();');vm.runInContext(source,ctx);ctx.testVoice.state.draft=draft([item()]);get('voiceSave').disabled=false;return {ctx,store,get};
}
test('saving reviewed draft preserves unrelated slots and appends reflections',async()=>{
 const {ctx,store}=app({initial:{'2026-10-20':{'08:00':{category:'food',note:'Breakfast'},__reflect__:{note:'Existing thought'}}}});
 ctx.testVoice.state.draft.reflections=[{date:'2026-10-20',text:'New thought'}];await ctx.testVoice.save();
 assert.equal(store['2026-10-20']['08:00'].note,'Breakfast');assert.equal(store['2026-10-20']['11:30'].sub,'CFD');assert.equal(store['2026-10-20'].__reflect__.note,'Existing thought\n\nNew thought');assert.equal(ctx.testVoice.state.draft,null);
});
test('declining replacement and failed cloud preflight make no local changes',async()=>{
 const initial={'2026-10-20':{'09:00':{category:'sleep'}}};const cancelled=app({initial,confirm:false});await cancelled.ctx.testVoice.save();assert.deepEqual(cancelled.store,initial);
 const query={then(resolve){resolve({error:{message:'offline'}});}};for(const method of ['select','eq','in','order','range'])query[method]=()=>query;
 const failed=app({initial,sb:{from:()=>query}});await failed.ctx.testVoice.save();assert.deepEqual(failed.store,initial);assert.match(failed.get('voiceStatus').textContent,/Nothing was saved/);
});

test('closing voice capture stops microphone tracks without requesting transcription',async()=>{
 const {ctx,get}=app();let stopped=0;
 const stream={getTracks:()=>[{stop(){stopped++;}}]};
 class Recorder { static isTypeSupported(){return true;} constructor(){this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';this.onstop();} }
 ctx.MediaRecorder=Recorder;ctx.window.MediaRecorder=Recorder;ctx.navigator.mediaDevices={getUserMedia:async()=>stream};
 await ctx.testVoice.record();assert.equal(ctx.testVoice.state.recorder.state,'recording');
 ctx.testVoice.close();assert.ok(stopped>0);assert.equal(ctx.testVoice.state.stream,null);assert.equal(get('voiceDialog').hidden,true);
});

test('connecting defaults to the task-tested automatic model',async()=>{
 const {ctx,get}=app();
 ctx.fetch=async()=>({ok:true,json:async()=>({token:'test-token',models:['gpt-oss:120b','gemma4:31b'],default_model:'gemma4:31b',recommended_model:'gemma4:31b',api_key_ready:true,transcription_ready:true})});
 await ctx.testVoice.connect();
 assert.equal(get('voiceModel').value,'auto');assert.match(get('voiceModel').innerHTML,/gemma4:31b \(recommended\)/);assert.equal(ctx.testVoice.state.connected,true);
});

test('connecting does not choose an untested model when the recommendation is unavailable',async()=>{
 const {ctx,get}=app();
 ctx.fetch=async()=>({ok:true,json:async()=>({token:'test-token',models:['different-model'],default_model:'',recommended_model:null,api_key_ready:true,transcription_ready:true})});
 await ctx.testVoice.connect();
 assert.equal(get('voiceModel').value,'');assert.equal(get('voiceBuild').disabled,true);assert.match(get('voiceStatus').textContent,/choose an available model in Voice settings/);
});

const connectedResponse=()=>({ok:true,json:async()=>({token:'test-token',models:['gemma4:31b'],default_model:'gemma4:31b',recommended_model:'gemma4:31b',api_key_ready:true,transcription_ready:true})});
test('opening voice automatically connects, refreshes on reopen, and keeps settings collapsed',async()=>{
 const {ctx,get}=app();let calls=0;
 ctx.fetch=async()=>{calls++;return connectedResponse();};
 assert.equal(calls,0);
 await ctx.testVoice.open();
 assert.equal(calls,1);assert.equal(ctx.testVoice.state.connected,true);assert.equal(get('voiceSettings').open,false);
 ctx.testVoice.close();await ctx.testVoice.open();assert.equal(calls,2);assert.equal(ctx.testVoice.state.connected,true);
});
test('failed automatic connection offers a simple retry without exposing setup',async()=>{
 const {ctx,get}=app();ctx.fetch=async()=>{throw new TypeError('Failed to fetch');};
 await ctx.testVoice.open();
 assert.equal(ctx.testVoice.state.connected,false);assert.equal(get('voiceSettings').open,false);assert.equal(get('voiceRetry').hidden,false);assert.equal(get('voiceConnect').disabled,false);
 ctx.fetch=async()=>connectedResponse();await ctx.testVoice.connect();assert.equal(ctx.testVoice.state.connected,true);
});
test('closing and reopening during connection does not let the stale request change state',async()=>{
 const {ctx}=app();const pending=[];ctx.fetch=()=>new Promise(resolve=>pending.push(resolve));
 const first=ctx.testVoice.open();ctx.testVoice.close();const second=ctx.testVoice.open();
 pending[0](connectedResponse());await first;
 assert.equal(ctx.testVoice.state.busy,true);assert.equal(ctx.testVoice.state.connected,false);
 pending[1](connectedResponse());await second;
 assert.equal(ctx.testVoice.state.busy,false);assert.equal(ctx.testVoice.state.connected,true);
});

test('stopping a recording automatically transcribes and organises without saving',async()=>{
 const {ctx,store,get}=app();const calls=[];
 const stream={getTracks:()=>[{stop(){}}]};
 class Recorder { static isTypeSupported(){return true;} constructor(){this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';this.done=this.onstop();} }
 ctx.MediaRecorder=Recorder;ctx.window.MediaRecorder=Recorder;ctx.navigator.mediaDevices={getUserMedia:async()=>stream};
 ctx.fetch=async(url)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/transcribe')?{text:'Worked on design from nine until twelve.'}:draft([item()])};};
 const state=ctx.testVoice.state;state.draft=null;state.connected=true;state.keyReady=true;state.speechReady=true;state.origin='http://127.0.0.1:8765';
 await ctx.testVoice.record();const recorder=state.recorder;recorder.stop();await recorder.done;
 assert.equal(calls.length,2);assert.match(calls[0],/transcribe$/);assert.match(calls[1],/draft$/);assert.equal(state.phase,'review');assert.equal(state.draft.items.length,1);assert.deepEqual(store,{});assert.equal(get('voiceSave').disabled,false);
});
test('hosted browser speech processes on stop and sends only the signed-in session token',async()=>{
 const sb={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}};
 const {ctx,store}=app({sb});const calls=[];
 class Recognition { start(){} stop(){this.done=this.onend();} abort(){this.onend();} }
 ctx.window.SpeechRecognition=Recognition;ctx.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>draft([item()])};};
 const state=ctx.testVoice.state;state.hosted=true;state.origin='https://voice.example';state.draft=null;
 await ctx.testVoice.record();const recognition=state.recognition;
 recognition.onresult({results:[[{transcript:'Worked from nine until twelve.'}]]});recognition.stop();await recognition.done;
 assert.equal(calls.length,1);assert.match(calls[0].url,/draft$/);assert.equal(calls[0].options.headers.Authorization,'Bearer test-session');assert.equal(calls[0].options.headers['X-Day-Token'],undefined);assert.equal(state.phase,'review');assert.deepEqual(store,{});
});
test('closing browser speech aborts capture and does not process the transcript',async()=>{
 const {ctx}=app();let aborted=false,calls=0;
 class Recognition { start(){} abort(){aborted=true;this.onend();} }
 ctx.window.SpeechRecognition=Recognition;ctx.fetch=async()=>{calls++;};ctx.testVoice.state.hosted=true;
 await ctx.testVoice.record();ctx.testVoice.close();assert.equal(aborted,true);assert.equal(calls,0);assert.equal(ctx.testVoice.state.listening,false);
});
test('hosted API addresses require HTTPS and cannot contain credentials',()=>{
 assert.equal(voice.hostedOrigin('https://voice.example'),'https://voice.example');
 for(const url of ['http://voice.example','https://user:pass@voice.example','https://voice.example/?key=secret'])assert.throws(()=>voice.hostedOrigin(url));
});

test('Brave records locally and drafts through Ollama without the browser speech service or audio upload',async()=>{
 const sb={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}};
 const {ctx,store}=app({sb});let transcribed=0,recognitionStarted=0;const calls=[];
 ctx.navigator.brave={};ctx.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
 class Recorder { static isTypeSupported(){return true;} constructor(){this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';this.done=this.onstop();} }
 ctx.MediaRecorder=ctx.window.MediaRecorder=Recorder;
 ctx.window.SpeechRecognition=class {start(){recognitionStarted++;}};
 ctx.window.DaySpeech={supported:()=>true,transcribe:async()=>{transcribed++;return {text:'Worked from nine until twelve.'};},cancel(){}};
 ctx.fetch=async(url)=>{calls.push(url);return {ok:true,json:async()=>draft([item()])};};
 const state=ctx.testVoice.state;state.hosted=true;state.origin='https://voice.example';state.draft=null;
 await ctx.testVoice.record();const recorder=state.recorder;recorder.stop();await recorder.done;
 assert.equal(recognitionStarted,0);assert.equal(transcribed,1);assert.equal(calls.length,1);assert.match(calls[0],/draft$/);assert.equal(state.phase,'review');assert.deepEqual(store,{});
});
test('a native speech network failure selects the portable fallback and preserves the draft',async()=>{
 const {ctx,get}=app();
 class Recognition {start(){} stop(){this.onend();}}
 ctx.window.SpeechRecognition=Recognition;ctx.window.DaySpeech={supported:()=>true};
 ctx.testVoice.state.hosted=true;
 await ctx.testVoice.record();const recognition=ctx.testVoice.state.recognition;
 recognition.onerror({error:'network'});await recognition.onend();
 assert.match(get('voiceStatus').textContent,/built-in transcription/);assert.equal(ctx.testVoice.state.browserSpeechFailed,true);assert.equal(ctx.testVoice.state.draft.items.length,1);assert.equal(ctx.testVoice.state.listening,false);
});
test('microphone permissions and capture errors have distinct recovery messages',async()=>{
 for (const [code,message] of [['not-allowed',/access is blocked/],['audio-capture',/microphone isn’t available/],['no-speech',/No speech was detected/]]) {
  const {ctx,get}=app();class Recognition {start(){}}
  ctx.window.SpeechRecognition=Recognition;ctx.testVoice.state.hosted=true;
  await ctx.testVoice.record();ctx.testVoice.state.recognition.onerror({error:code});await ctx.testVoice.state.recognition.onend();
  assert.match(get('voiceStatus').textContent,message);
 }
});
test('failed recordings never request transcription or draft partial microphone data',async()=>{
 const {ctx,store}=app();let requests=0;
 ctx.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
 class Recorder { static isTypeSupported(){return true;} constructor(){this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';this.done=this.onstop();} }
 ctx.MediaRecorder=ctx.window.MediaRecorder=Recorder;ctx.fetch=async()=>{requests++;};
 await ctx.testVoice.record();const recorder=ctx.testVoice.state.recorder;recorder.onerror();await recorder.done;
 assert.equal(requests,0);assert.equal(ctx.testVoice.state.phase,'error');assert.deepEqual(store,{});
});

test('draft requests include scoped history and explain its coverage without saving',async()=>{
 const rows=[{user_id:'test',date:'2026-10-19',start_time:'09:00',category:'work',subcategory:'Lab',note:''}];const filters=[];
 const sb={from(){const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},range(){return Promise.resolve({data:rows});}};return q;}};
 const {ctx,get,store}=app({sb});let payload;
 get('voiceTranscript').value='Same lab work as yesterday';get('voiceModel').value='auto';
 ctx.fetch=async(_url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>draft([item()])};};
 await ctx.testVoice.build();
 assert.deepEqual(filters,[['user_id','test']]);assert.equal(payload.context.diary.entries[0].activity,'Lab');assert.equal(payload.context.diary.coverage.days_available,1);assert.match(get('voiceContextStatus').textContent,/1 saved diary day/);assert.deepEqual(store,{});
});
test('closing while history is loading cancels without sending the old context to Ollama',async()=>{
 const {ctx,get}=app();let finish,requests=0;
 ctx.DayVoiceContext={load:()=>new Promise(resolve=>finish=resolve),select:historyContext.select};
 get('voiceTranscript').value='Same as yesterday';ctx.fetch=async()=>{requests++;};
 const pending=ctx.testVoice.build();ctx.testVoice.close();finish({rows:[],source:'cloud',complete:true});await pending;
 assert.equal(requests,0);assert.equal(ctx.testVoice.state.history,null);
});
test('switching accounts during history retrieval cannot send the previous user history',async()=>{
 const {ctx,get}=app();let finish,requests=0;
 ctx.DayVoiceContext={load:()=>new Promise(resolve=>finish=resolve),select:historyContext.select};get('voiceTranscript').value='Same as yesterday';ctx.fetch=async()=>{requests++;};
 const pending=ctx.testVoice.build();ctx.USER_ID='other';finish({rows:[],source:'cloud',complete:true});await pending;assert.equal(requests,0);assert.equal(ctx.testVoice.state.history,null);
});
test('account changes during session refresh prevent old diary context being sent',async()=>{
 let finish,requests=0;const sb={auth:{getSession:()=>new Promise(resolve=>finish=resolve)}};
 const {ctx,get}=app({sb});ctx.DayVoiceContext={load:async()=>({rows:[],source:'cloud',complete:true}),select:historyContext.select};
 ctx.testVoice.state.hosted=true;get('voiceTranscript').value='Same as yesterday';ctx.fetch=async()=>{requests++;};
 const pending=ctx.testVoice.build();await new Promise(resolve=>setImmediate(resolve));ctx.USER_ID='other';finish({data:{session:{access_token:'old-owner-token',user:{id:'test'}}}});await pending;
 assert.equal(requests,0);assert.match(get('voiceStatus').textContent,/account changed/);
});
