const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({silent=false,decode,autoReady=true}={}) {
 const workers=[],contexts=[];
 const samples=Float32Array.from({length:160},(_,i)=>silent?0:Math.sin(i)*0.1);
 class Audio { constructor(...args){contexts.push(args);} async decodeAudioData(){return decode ? decode() : {duration:0.01,length:samples.length,numberOfChannels:2,getChannelData:()=>samples};} }
 class Worker {constructor(url,options){this.url=url;this.options=options;workers.push(this);}postMessage(data){this.data=data;if(data.type==='prepare' && autoReady)queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));}terminate(){this.terminated=true;}}
 const ctx={window:{Worker,WebAssembly:{},OfflineAudioContext:Audio,MediaRecorder:{},location:{href:'https://day.example/'}},document:{currentScript:{src:'https://day.example/app/speech-transcriber.js'}},navigator:{mediaDevices:{getUserMedia(){}}},URL,Float32Array,Blob,setTimeout,clearTimeout,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../speech-transcriber.js'),'utf8'),ctx);
 return {speech:ctx.window.DaySpeech,workers,contexts};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('portable speech decodes at 16kHz, mixes channels and returns worker text',async()=>{
 const {speech,workers,contexts}=setup();const request=speech.transcribe(new Blob(['synthetic audio']));await tick();
 assert.deepEqual(contexts[0],[1,1,16000]);assert.equal(workers.length,1);assert.equal(workers[0].options.type,'module');assert.equal(workers[0].data.audio.length,160);
 assert.match(workers[0].url.href,/\/app\/speech-worker.js/);
 workers[0].onmessage({data:{type:'result',text:'Synthetic transcript'}});assert.equal((await request).text,'Synthetic transcript');
});
test('silence does not start inference or produce imagined activity text',async()=>{
 const {speech,workers}=setup({silent:true});await assert.rejects(speech.transcribe(new Blob(['silence'])),/No microphone audio/);assert.equal(workers.length,0);
});
test('closing during decoding cancels without starting an orphan worker',async()=>{
 let finish;const {speech,workers}=setup({decode:()=>new Promise(resolve=>finish=resolve)});
 const request=speech.transcribe(new Blob(['audio']));await tick();speech.cancel();await assert.rejects(request,{name:'AbortError'});
 finish({duration:1,length:1,numberOfChannels:1,getChannelData:()=>new Float32Array([0.1])});await tick();assert.equal(workers.length,0);
});
test('worker failure is recoverable and cancellation terminates active inference',async()=>{
 const {speech,workers}=setup();const first=speech.transcribe(new Blob(['audio']));await tick();workers[0].onerror();await assert.rejects(first,/couldn’t start/);assert.equal(workers[0].terminated,true);
 const second=speech.transcribe(new Blob(['audio']));await tick();assert.equal(workers.length,2);speech.cancel();await assert.rejects(second,{name:'AbortError'});assert.equal(workers[1].terminated,true);
});

test('preparation loads before recording and is reused for transcription',async()=>{
 const {speech,workers}=setup();await speech.prepare();assert.equal(workers.length,1);assert.equal(workers[0].data.type,'prepare');
 const request=speech.transcribe(new Blob(['audio']));await tick();assert.equal(workers.length,1);assert.equal(workers[0].data.type,'transcribe');
 workers[0].onmessage({data:{type:'result',text:'ready words'}});assert.equal((await request).text,'ready words');speech.cancel();
});
test('parallel preparation shares one worker and closing cancels it safely',async()=>{
 const {speech,workers}=setup({autoReady:false});const first=speech.prepare(),second=speech.prepare();assert.equal(first,second);assert.equal(workers.length,1);
 speech.cancel();await assert.rejects(first,{name:'AbortError'});assert.equal(workers[0].terminated,true);
 await new Promise(resolve=>setImmediate(resolve));
});
test('failed preparation is recoverable without microphone capture',async()=>{
 const {speech,workers}=setup({autoReady:false});const first=speech.prepare();workers[0].onerror();await assert.rejects(first,/couldn’t start/);
 const retry=speech.prepare();workers[1].onmessage({data:{type:'ready'}});await retry;assert.equal(workers.length,2);speech.cancel();
});
test('closing an idle prepared recogniser keeps it warm for the next opening',async()=>{
 const {speech,workers}=setup();await speech.prepare();speech.release();assert.notEqual(workers[0].terminated,true);
 await speech.prepare();assert.equal(workers.length,1);speech.cancel();assert.equal(workers[0].terminated,true);
});
test('release during inference cancels audio processing instead of retaining it',async()=>{
 const {speech,workers}=setup();const request=speech.transcribe(new Blob(['audio']));await tick();speech.release();await assert.rejects(request,{name:'AbortError'});assert.equal(workers[0].terminated,true);
});
