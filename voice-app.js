/* Adapter used only by voice. The base application's event handlers are unchanged. */
(() => {
  const A=DayVoiceActions;
  const helpers={parseObjective:parseObjectiveLine,serializeObjectives:serializeObjectiveItems,roughPlans:roughPlansForDay,roughPlanBlock,categories:DayVoiceDraft.categories};
  function local(date) {
    if(date!=='2000-01-01')return date===ymd(current)?JSON.parse(JSON.stringify(data)):loadLocal(date);
    const day=loadLocal(date);
    const settings=localStorage.getItem('day_settings');
    if(settings)day.__settings__={category:'settings',note:settings};else delete day.__settings__;
    for(const note of Object.values(notes))day['__note__'+note.id]={category:'note',note:JSON.stringify(note)};
    return day;
  }
  const archiveNeeded=text=>/\b(same|repeat|usual|routine|last|ago|before|history|move|change|delete|remove|goal|objective|complete|completed|done|note|extend|shorten|rename)\b|\d{4}-\d{2}-\d{2}|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);
  async function history({transcript='',signal,owner=USER_ID}) {
    if(archiveNeeded(transcript))return {...await DayVoiceContext.load({client:sb,userId:owner,storage:localStorage,signal}),scope:'archive'};
    const today=ymd(new Date()),viewed=ymd(current);
    const dates=[...new Set(['2000-01-01',today,DayEventRange.shift(today,-1),DayEventRange.shift(today,1),viewed,DayEventRange.shift(viewed,-1)])];
    const days=await DayVoiceStore.read({client:sb,owner,dates,signal,local});
    return {rows:Object.entries(days).flatMap(([date,day])=>Object.entries(day).map(([start_time,b])=>({date,start_time,...b,subcategory:b.sub || ''}))),source:sb?'cloud':'local',complete:true,scope:'recent',dates};
  }
  function snapshot(history,transcript) {
    const days=A.daysFromRows(history.rows),all=A.targets(days,helpers);
    const tokens=transcript.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const selectedId=editing?.length?`activity:${ymd(current)}:${editing[0]}`:!document.getElementById('insightScreen').hidden && !currentInsight && activeNoteId?'note:'+activeNoteId:null;
    const score=t=>(t.id===selectedId || transcript.includes(t.id)?1000:0)+(t.date===ymd(current)?3:0)+tokens.filter(w=>w.length>2 && (t.activity || t.text || '').toLowerCase().includes(w)).length*5;
    let budget=12000;const targets=all.sort((a,b)=>score(b)-score(a)).filter(t=>{const size=JSON.stringify(t).length;if(size>budget)return false;budget-=size;return true;}).slice(0,80);
    let selected=null;
    if(editing?.length)selected=targets.find(t=>t.kind==='activity' && t.date===ymd(current) && t.start<=editing[0] && t.end>editing[0]);
    else if(!document.getElementById('insightScreen').hidden && !currentInsight && activeNoteId)selected=targets.find(t=>t.id==='note:'+activeNoteId);
    else if(!document.getElementById('plannerScreen').hidden && plannerSelectedTask>=0)selected=targets.find(t=>t.kind==='objective' && t.date===ymd(plannerDate) && t.horizon==='daily' && t.index===plannerSelectedTask);
    else if(diaryTargetSelected>=0){
      const horizon=activeObjectiveHorizon==='short'?'shortTermObjectives':activeObjectiveHorizon==='long'?'longTermObjectives':'daily';
      const date=horizon!=='daily'?'2000-01-01':activeObjectiveHorizon==='tomorrow'?DayEventRange.shift(ymd(current),1):ymd(current);
      selected=targets.find(t=>t.kind==='objective' && t.date===date && t.horizon===horizon && t.index===diaryTargetSelected);
    }
    return {days,catalog:targets,complete:history.complete,app:{screen:!document.getElementById('calendarScreen').hidden?'calendar':!document.getElementById('plannerScreen').hidden?'planner':!document.getElementById('insightScreen').hidden?(currentInsight?.id || 'notes'):'day',selected_target:selected?.id || null,targets,targets_limited:all.length>targets.length}};
  }
  async function review(draft,snapshot,owner) {
    if(!snapshot.complete && draft.actions?.some(a=>a.type!=='navigate'))throw Error('Saved history is incomplete. Reconnect before changing or querying saved records.');
    const dates=[...new Set((draft.actions || []).flatMap(a=>[a.date,a.end_date]).filter(A.dateOK))];
    // Include every destination date, including intervening days of a changed range.
    for(const a of draft.actions || [])if(a.type==='activity_update') {
      const target=snapshot.catalog.find(t=>t.id===a.target);
      if(target){const r=DayEventRange.build(a.date || target.date,a.start || target.start,a.end_date || a.date || target.date,a.end || target.end);if(!r.error)for(const d of r.days)if(!dates.includes(d.date))dates.push(d.date);}
    }
    const missing=dates.filter(date=>!snapshot.days[date]);
    if(missing.length)Object.assign(snapshot.days,await DayVoiceStore.read({client:sb,owner,dates:missing,local}));
    if(USER_ID!==owner)throw Error('Your account changed. Reopen voice.');
    const result=A.plan({draft,days:snapshot.days,catalog:snapshot.catalog,range:DayEventRange,helpers});
    result.owner=owner;result.localBefore=Object.fromEntries([...new Set(result.patches.map(p=>p.date))].map(date=>[date,local(date)]));
    return result;
  }
  async function reviewEntries(draft,owner) {
    const plan=DayVoiceDraft.plan(draft,DayEventRange);if(plan.errors.length)return null;
    const dates=[...new Set([...plan.slots.map(p=>p.date),...plan.reflections.map(p=>p.date)])];
    const days=await DayVoiceStore.read({client:sb,owner,dates,local});
    if(USER_ID!==owner)throw Error('Your account changed. Reopen voice.');
    const next=JSON.parse(JSON.stringify(days)),summaries=[];
    const conflicts=plan.slots.filter(p=>days[p.date]?.[p.slot]).length;
    if(conflicts)summaries.push(`Applying this draft replaces ${conflicts} existing half-hour blocks. Say “save” or choose Save to confirm.`);
    for(const p of plan.slots)next[p.date][p.slot]=p.block;
    for(const r of plan.reflections){const previous=next[r.date].__reflect__?.note || '';next[r.date].__reflect__={category:'reflection',note:previous===r.text?previous:[previous,r.text].filter(Boolean).join('\n\n')};}
    const patches=[];
    for(const date of dates)for(const slot of Object.keys(next[date]))if(!A.same(days[date][slot],next[date][slot]))patches.push({date,slot,before:A.normal(days[date][slot]),after:A.normal(next[date][slot])});
    return {owner,patches,summaries,navigation:[],answers:[],localBefore:Object.fromEntries(dates.map(date=>[date,local(date)]))};
  }
  function onApplied(patches) {
    const changed=new Map();
    for(const p of patches) {
      const day=changed.get(p.date) || local(p.date);changed.set(p.date,day);
      if(p.after)day[p.slot]=p.after;else delete day[p.slot];
      if(p.date==='2000-01-01' && p.slot==='__settings__') {
        const settings=JSON.parse(p.after?.note || '{}');shortTermObjectives=settings.shortTermObjectives || '';longTermObjectives=settings.longTermObjectives || '';
        localStorage.setItem('day_settings',JSON.stringify(settings));
      } else if(p.date==='2000-01-01' && p.slot.startsWith('__note__')) {
        const id=p.slot.slice('__note__'.length);clearTimeout(noteSaveTimers.get(id));noteSaveTimers.delete(id);
        if(p.after)notes[id]=JSON.parse(p.after.note);else delete notes[id];saveNotesLocal();
      }
    }
    for(const [date,day] of changed){saveLocal(date,day);if(date===ymd(current))data=day;}
    render();if(!document.getElementById('calendarScreen').hidden)renderCalendar();if(!document.getElementById('plannerScreen').hidden)renderPlanner();
    if(!document.getElementById('insightScreen').hidden && !currentInsight)renderNotes();
  }
  async function apply(review) {
    if(RECOVERY_MODE)throw Error('Recovery mode is read-only.');
    const applied=await DayVoiceStore.apply({patches:review.patches,client:sb,owner:review.owner,currentOwner:()=>USER_ID,local,localBefore:review.localBefore,onApplied,same:A.same});
    setStatus('ok',sb?'Synced':'Saved locally');return applied;
  }
  function undoReview(patches,owner) {
    return {owner,patches:patches.map(p=>({...p,before:p.after,after:p.before})),summaries:['Undo the last voice change'],navigation:[],answers:[],localBefore:Object.fromEntries([...new Set(patches.map(p=>p.date))].map(date=>[date,local(date)]))};
  }
  async function navigate(action) {
    closeCalendar();closePlanner();closeInsight();closeInsightsMenu();closeStats();
    if(action.date)await goto(new Date(action.date+'T12:00:00'));
    if(action.screen==='calendar')openCalendar();else if(action.screen==='planner')openPlanner();else if(action.screen!=='day')openInsight(action.screen);
  }
  window.DayVoiceApp={reviewEntries,history,archiveNeeded,snapshot,review,apply,undoReview,navigate};
})();
