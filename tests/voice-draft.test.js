const test = require('node:test'), assert = require('node:assert/strict');
const voice = require('../voice-draft'), range = require('../event-range');
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
 const elements={},store=structuredClone(initial);const get=id=>elements[id] ||= {value:'',disabled:false,hidden:false,inert:false,textContent:'',innerHTML:'',addEventListener(){},focus(){}};
 const ctx={document:{getElementById:get},localStorage:{getItem(){return null;},setItem(){}},DayVoiceDraft:voice,DayEventRange:range,window:{confirm:()=>confirm},navigator:{},RECOVERY_MODE:false,USER_ID:'test',sb,
 SLOTS:[],to12:x=>x,catLabel:x=>x,escapeHtml:x=>x,loadLocal:date=>structuredClone(store[date]||{}),saveLocal:(date,day)=>store[date]=structuredClone(day),current:new Date('2026-10-20T12:00Z'),data:{},REFLECT_KEY:'__reflect__',ymd:()=> '2026-10-20',render(){},setStatus(){},setTimeout,clearTimeout,AbortController,Blob,URL,Intl};
 vm.createContext(ctx);const source=fs.readFileSync(require.resolve('../voice.js'),'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.testVoice = { state, save, buttons, close, record };})();');vm.runInContext(source,ctx);ctx.testVoice.state.draft=draft([item()]);get('voiceSave').disabled=false;return {ctx,store,get};
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
