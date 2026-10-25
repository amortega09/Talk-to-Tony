const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(r=>setImmediate(r));
function setup() {
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),elements={};
 for(const [,id] of html.matchAll(/id="([^"]+)"/g))elements[id]={value:'',textContent:'',hidden:true,disabled:false,innerHTML:'',dataset:{},listeners:{},parentElement:{hidden:false},focus(){},addEventListener(type,fn){this.listeners[type]=fn;}};
 elements.voiceModel.value='auto';const storage=new Map();const calls=[];let nextDraft;
 const ctx={console,setTimeout,clearTimeout,AbortController,URL,Blob,Date,Intl,window:{APP_CONFIG:{},location:{href:'http://localhost/'}},navigator:{},document:{getElementById:id=>elements[id] || null,activeElement:null,addEventListener(){}},
 localStorage:{get length(){return storage.size;},key:n=>[...storage.keys()][n],getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v)},
 fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/status')?{token:'test',models:['test-model'],recommended_model:'test-model',api_key_ready:true,transcription_ready:true}:nextDraft};},
 DayEventRange:require('../event-range'),DayVoiceDraft:require('../voice-draft'),DayDiaryAgent:require('../diary-agent'),DayVoiceActions:require('../voice-actions'),DayVoiceStore:require('../voice-store'),DayVoiceContext:require('../voice-context'),
 USER_ID:'synthetic',sb:null,RECOVERY_MODE:false,current:new Date('2026-10-25T12:00:00'),data:{'09:00':{category:'work',sub:'CFD',note:''}},editing:null,diaryTargetSelected:-1,currentInsight:null,activeNoteId:null,
 customCats:[],customSubs:{},activityAreas:{},categoryMigrationVersion:0,shortTermObjectives:'',longTermObjectives:'',gymExercises:[],notes:{},noteSaveTimers:new Map(),
 ymd:d=>d.toISOString().slice(0,10),SLOTS:Array.from({length:48},(_,i)=>`${String(i>>1).padStart(2,'0')}:${i%2?'30':'00'}`),to12:x=>x,catLabel:x=>x,escapeHtml:x=>String(x).replaceAll('<','&lt;'),
 loadLocal:date=>JSON.parse(storage.get('day_data_'+date) || '{}'),saveLocal:(date,data)=>storage.set('day_data_'+date,JSON.stringify(data)),render(){},renderPlanner(){},renderCalendar(){},renderNotes(){},saveNotesLocal(){},setStatus(){},
 closeCalendar(){},closePlanner(){},closeInsight(){},closeInsightsMenu(){},closeStats(){},openCalendar(){},openPlanner(){},openInsight(id){ctx.opened=id;},goto:async d=>{ctx.current=d;}};
 ctx.window.DaySpeech={prepare:async()=>{},release(){},supported:()=>false};
 vm.createContext(ctx);
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 for(const name of ['parseObjectiveLine','serializeObjectiveItem','serializeObjectiveItems','roughPlansForDay','roughPlanBlock']) {const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start)+2;vm.runInContext(source.slice(start,end),ctx);}
 vm.runInContext("const ROUGH_PLAN_KEY='__rough_plan__'",ctx);
 ctx.saveLocal('2026-10-25',ctx.data);
 vm.runInContext(fs.readFileSync(require.resolve('../voice-app.js'),'utf8'),ctx);ctx.DayVoiceApp=ctx.window.DayVoiceApp;
 vm.runInContext(fs.readFileSync(require.resolve('../voice.js'),'utf8'),ctx);
 return {ctx,elements,calls,setDraft:d=>nextDraft=d,async open(){await elements.voiceOpen.listeners.click();},async say(text){elements.voiceTranscript.value=text;elements.voiceTranscript.listeners.input();await elements.voiceBuild.listeners.click();await tick();}};
}
const draft=actions=>({reply:'Review this change.',questions:[],items:[],reflections:[],actions});
test('voice edit → preview → spoken save → spoken undo changes only the selected activity',async()=>{
 const s=setup();await s.open();s.setDraft(draft([{type:'activity_update',target:'activity:2026-10-25:09:00',start:'10:00',end:'10:30'}]));
 await s.say('Move CFD to ten today');assert.equal(s.elements.voiceSave.disabled,false);assert.match(s.elements.voiceActions.innerHTML,/CFD/);assert.ok(s.ctx.data['09:00']);
 await s.say('save');assert.equal(s.ctx.data['09:00'],undefined);assert.equal(s.ctx.data['10:00'].sub,'CFD');assert.equal(s.elements.voiceUndo.hidden,false);
 await s.say('undo');assert.equal(s.ctx.data['09:00'].sub,'CFD');assert.equal(s.ctx.data['10:00'],undefined);assert.equal(s.calls.filter(c=>c.url.endsWith('/draft')).length,1);
});
test('new entries also support spoken save and undo',async()=>{
 const s=setup();await s.open();s.setDraft({reply:'Review lunch.',questions:[],actions:[],reflections:[],items:[{date:'2026-10-25',start:'12:00',end_date:'2026-10-25',end:'12:30',category:'food',activity:'Lunch',note:''}]});
 await s.say('Lunch from noon to twelve thirty');assert.equal(s.elements.voiceSave.disabled,false);
 await s.say('save');assert.equal(s.ctx.data['12:00'].sub,'Lunch');assert.equal(s.ctx.data['09:00'].sub,'CFD');await s.say('undo');assert.equal(s.ctx.data['12:00'],undefined);
});
test('navigation uses existing screen functions without a drafting request',async()=>{
 const s=setup();await s.open();await s.say('open patterns');assert.equal(s.ctx.opened,'patterns');assert.equal(s.calls.filter(c=>c.url.endsWith('/draft')).length,0);
});
test('unresolved target questions cannot be saved and do not change diary data',async()=>{
 const s=setup();await s.open();s.setDraft({...draft([]),questions:['Which CFD session?']});await s.say('Delete CFD');
 assert.equal(s.elements.voiceSave.disabled,true);await s.say('save');assert.ok(s.ctx.data['09:00']);assert.equal(s.calls.filter(c=>c.url.endsWith('/draft')).length,1);
});
test('closing during a model request discards its response without a preview or write',async()=>{
 const s=setup();await s.open();let release;
 s.ctx.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>release=resolve)});
 const pending=s.say('Delete CFD');while(!release)await tick();
 s.elements.voiceClose.listeners.click();release(draft([{type:'activity_delete',target:'activity:2026-10-25:09:00'}]));await pending;
 assert.ok(s.ctx.data['09:00']);assert.equal(s.elements.voiceDialog.hidden,true);assert.equal(s.elements.voiceSave.disabled,true);
});
test('an account change during interpretation cannot write or display the old draft',async()=>{
 const s=setup();await s.open();let release;
 s.ctx.fetch=async()=>({ok:true,json:()=>new Promise(resolve=>release=resolve)});
 const pending=s.say('Delete CFD');while(!release)await tick();s.ctx.USER_ID='other';
 release(draft([{type:'activity_delete',target:'activity:2026-10-25:09:00'}]));await pending;
 assert.ok(s.ctx.data['09:00']);assert.equal(s.elements.voiceSave.disabled,true);
});
test('computed day queries answer without a save and never write records',async()=>{
 const s=setup();await s.open();s.setDraft(draft([{type:'query_day',date:'2026-10-25'}]));await s.say('What did I record today?');
 assert.match(s.elements.voiceStatus.textContent,/CFD: 0.5h/);assert.ok(s.ctx.data['09:00']);assert.equal(s.elements.voiceSave.hidden,true);
});
test('local commands remain usable when the model connection is unavailable',async()=>{
 const s=setup();s.ctx.fetch=async()=>{throw Error('offline');};await s.open();await s.say('open notes');assert.equal(s.ctx.opened,'notes');
});
test('daily and long-term goals select the correct current target',async()=>{
 const s=setup();s.ctx.diaryTargetSelected=0;s.ctx.activeObjectiveHorizon='long';
 const history={complete:true,rows:[{date:'2026-10-25',start_time:'__plan__',category:'plan',note:'[ ] Daily goal'},{date:'2000-01-01',start_time:'__settings__',category:'settings',note:'{"longTermObjectives":"[ ] Long goal"}'}]};
 assert.equal(s.ctx.DayVoiceApp.snapshot(history,'Complete this goal').app.selected_target,'objective:2000-01-01:longTermObjectives:0');
});
