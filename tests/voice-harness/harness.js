const $=id=>document.getElementById(id);
const clean=value=>String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
function evaluate(expected,draft,plan) {
  const failures=[],items=draft.items;
  if(expected.items){
    if(items.length!==expected.items.length)failures.push(`Expected ${expected.items.length} activities, got ${items.length}`);
    for(const [activity,category,date,start,end_date,end] of expected.items)if(!items.some(i=>clean(i.activity)===clean(activity) && i.category===category && i.date===date && i.start===start && i.end_date===end_date && i.end===end))failures.push(`Missing/wrong: ${activity} ${date} ${start} → ${end_date} ${end}`);
    if(plan.errors.length)failures.push(...plan.errors);
    if(draft.questions.length)failures.push('Unexpected clarification');
  }
  for(const fields of expected.partial_items || [])if(!items.some(item=>Object.entries(fields).every(([key,value])=>item[key]===value)))failures.push('Missing partial activity: '+JSON.stringify(fields));
  for(const word of expected.note_contains || [])if(!items.some(item=>(item.activity+' '+item.note).toLowerCase().includes(word.toLowerCase())))failures.push('Lost detail: '+word);
  if(expected.count!==undefined && items.length!==expected.count)failures.push(`Expected ${expected.count} activities, got ${items.length}`);
  if(expected.question && !draft.questions.length)failures.push('Expected a clarification');
  if(expected.null_start && !items.every(i=>i.start===null))failures.push('Ambiguous start was invented');
  if(expected.unknown && !items.every(i=>i.start===null || i.end===null))failures.push('Unknown time was invented');
  if(expected.reflections!==undefined && draft.reflections.length!==expected.reflections)failures.push('Wrong reflection count');
  for(const word of expected.reflection_contains || [])if(!draft.reflections.some(r=>r.text.toLowerCase().includes(word)))failures.push('Reflection lost '+word);
  return failures;
}
async function recordThroughCodec(blob) {
  const context=new AudioContext(),stream=context.createMediaStreamDestination();
  const source=context.createBufferSource();source.buffer=await context.decodeAudioData(await blob.arrayBuffer());source.connect(stream);
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
  const recorder=new MediaRecorder(stream.stream,mime?{mimeType:mime}:undefined),chunks=[];
  try {
    return await new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onerror=()=>reject(Error('MediaRecorder failed'));
      recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));
      source.onended=()=>setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},150);
      context.resume().then(()=>{recorder.start();source.start();},reject);
    });
  } finally {stream.stream.getTracks().forEach(track=>track.stop());await context.close();}
}
let report={cases:[]};
async function post(path,value){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Harness-Token':window.HARNESS_TOKEN},body:JSON.stringify(value)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
function display(){
  $('results').replaceChildren();
  for(const result of report.cases){const card=document.createElement('article'),title=document.createElement('strong'),detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');title.textContent=(result.passed?'PASS · ':'FAIL · ')+result.label;title.className=result.passed?'pass':'fail';summary.textContent='Spoken words, transcript and assertions';pre.textContent=JSON.stringify(result,null,2);detail.append(summary,pre);card.append(title,detail);$('results').append(card);}
  $('summary').textContent=`${report.cases.filter(c=>c.passed).length}/${report.cases.length} scenarios passed`;
}
async function run(failedOnly=false,ids=null){
  $('benchmark').disabled=$('run').disabled=$('retry').disabled=$('targeted').disabled=true;
  const suite=await (await fetch('/suite')).json();
  const old=report.cases;
  const engine='Whisper base.en q8 / Transformers.js 3.8.1 / Ollama Gemma4:31b';
  if((!failedOnly && !ids) || report.engine!==engine)report={started_at:new Date().toISOString(),engine,history_source:suite.source,cases:[]};
  delete report.finished_at;
  for(const scenario of suite.cases){
    if(ids && !ids.includes(scenario.id))continue;
    if(failedOnly && !old.some(c=>c.id===scenario.id && !c.passed))continue;
    const agent=DayDiaryAgent.create(),out={id:scenario.id,label:scenario.label,passed:true,turns:[]};let previous=null;
    for(let index=0;index<scenario.turns.length;index++){
      const turn=scenario.turns[index],result={spoken:turn.say,expected:turn.expected};const started=performance.now();
      try{
        $('status').textContent=`${scenario.label} · turn ${index+1}: transcribing…`;
        let blob=await (await fetch(`/audio/${scenario.id}-${index}.wav`)).blob();
        if(scenario.record){$('status').textContent='Recording through the browser codec…';blob=await recordThroughCodec(blob);result.recording_mime=blob.type;result.recording_bytes=blob.size;}
        const audioStart=performance.now();const recognized=await DaySpeech.transcribe(blob,message=>$('status').textContent=scenario.label+' · '+message);result.transcription_seconds=(performance.now()-audioStart)/1000;result.transcript=recognized.text;
        if(turn.expected.silence)throw Error('Silence incorrectly produced text');
        const outcome=await agent.run({userId:'harness',transcript:recognized.text,previous,context:{today:'2026-10-14',viewed_date:'2026-10-14',local_time:'18:00',timezone:'Europe/London'},recall:async({query})=>DayVoiceContext.select({rows:suite.rows,source:suite.source,complete:true},{today:'2026-10-14',viewedDate:'2026-10-14',transcript:query}),think:payload=>{ $('status').textContent=scenario.label+' · organising…';return post('/draft',{...payload,model:'auto'}); }});
        previous=outcome.draft;result.draft=outcome.draft;result.plan=DayVoiceDraft.plan(outcome.draft,DayEventRange);result.context={days:outcome.diary.coverage.days_available,entries:outcome.diary.entries.length,routines:outcome.diary.routines.length,chars:JSON.stringify(outcome.diary).length};result.failures=evaluate(turn.expected,outcome.draft,result.plan);result.passed=!result.failures.length;
      }catch(error){result.error=error.message;result.passed=!!turn.expected.silence && /No microphone audio/.test(error.message);}
      result.seconds=(performance.now()-started)/1000;out.turns.push(result);out.passed=out.passed && result.passed;
    }
    agent.reset();report.cases=report.cases.filter(c=>c.id!==out.id);report.cases.push(out);display();await post('/report',report);
  }
  report.finished_at=new Date().toISOString();await post('/report',report);$('status').textContent='Finished. Report saved locally. No diary entries were written.';$('benchmark').disabled=$('run').disabled=$('retry').disabled=$('targeted').disabled=false;
}
$('run').onclick=()=>run().catch(e=>{$('status').textContent=e.message;$('benchmark').disabled=$('run').disabled=$('retry').disabled=$('targeted').disabled=false;});$('retry').onclick=()=>run(true).catch(e=>$('status').textContent=e.message);

$('targeted').onclick=()=>run(false,['yen_graduation','custom_name','recording_codec']).catch(e=>$('status').textContent=e.message);
fetch('/report').then(r=>r.ok?r.json():null).then(saved=>{if(saved?.cases){report=saved;display();}});

$('benchmark').onclick=async()=>{
 $('benchmark').disabled=$('run').disabled=$('retry').disabled=$('targeted').disabled=true;
 try{
  const blob=await(await fetch('/audio/yen_graduation-0.wav')).blob();
  DaySpeech.cancel();let start=performance.now();
  const cold=await DaySpeech.transcribe(blob,message=>$('speed').textContent='Cold run · '+message);
  const cold_seconds=(performance.now()-start)/1000;
  DaySpeech.cancel();start=performance.now();$('speed').textContent='Preparing model before recording…';await DaySpeech.prepare();
  const preparation_seconds=(performance.now()-start)/1000;
  start=performance.now();const warm=await DaySpeech.transcribe(blob,message=>$('speed').textContent='Prepared run · '+message);
  const prepared_seconds=(performance.now()-start)/1000;
  report.speed_benchmark={cold_seconds,preparation_seconds,prepared_seconds,same_transcript:cold.text===warm.text,transcript:warm.text};await post('/report',report);
  $('speed').textContent=`After stop: cold ${cold_seconds.toFixed(2)}s → prepared ${prepared_seconds.toFixed(2)}s. Preparation ${preparation_seconds.toFixed(2)}s runs before stop. Same transcript: ${cold.text===warm.text}.`;
 }catch(error){$('speed').textContent=error.message;}
 finally{$('benchmark').disabled=$('run').disabled=$('retry').disabled=$('targeted').disabled=false;}
};
