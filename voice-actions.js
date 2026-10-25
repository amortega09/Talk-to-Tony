/* Voice-only plans. Model output never executes JavaScript or writes storage. */
(function(root) {
  const types = ['navigate','activity_update','activity_delete','objective_add','objective_complete','objective_remove','rough_plan_add','checkin','day_status','note_append','query_day'];
  const screens = ['day','calendar','planner','patterns','notes','goals','subs','gym'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
  const normal = b => b ? {category:b.category,note:b.note || '',sub:b.sub || b.subcategory || ''} : null;
  const parse = value => { try { const result=JSON.parse(value || '{}');return result && typeof result==='object' && !Array.isArray(result)?result:{}; } catch { return {}; } };
  const dateOK = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date !== '2000-01-01' && !isNaN(Date.parse(date)) && new Date(date+'T12:00Z').toISOString().slice(0,10)===date;
  const clock = n => `${String(Math.floor(n/2)).padStart(2,'0')}:${n%2?'30':'00'}`;
  const textOK = value => typeof value==='string' && !!value.trim() && value.length<=4000;
  function daysFromRows(rows) {
    const days={};
    for(const r of rows) (days[r.date] ||= {})[r.start_time]=normal(r);
    return days;
  }
  function targets(days, helpers) {
    const result=[];
    for(const [date,day] of Object.entries(days)) {
      for(let n=0;n<48;) {
        const start=n, block=day[clock(n++)];if(!block)continue;
        while(n<48 && same(block,day[clock(n)]))n++;
        result.push({id:`activity:${date}:${clock(start)}`,kind:'activity',date,start:clock(start),end:clock(n),activity:block.sub || block.category,category:block.category});
      }
      const goalGroups=date==='2000-01-01' ? ['shortTermObjectives','longTermObjectives'] : ['daily'];
      const settings=parse(day.__settings__?.note);
      for(const horizon of goalGroups) {
        const source=horizon==='daily'?day.__plan__?.note:settings[horizon];
        const items=(source || '').split(/\r?\n/).map(helpers.parseObjective).filter(i=>i.text);
        items.forEach((item,index)=>result.push({id:`objective:${date}:${horizon}:${index}`,kind:'objective',date,horizon,index,text:item.text,completed:item.completed}));
      }
      if(date==='2000-01-01')for(const [slot,block] of Object.entries(day)) {
        if(!slot.startsWith('__note__'))continue;const note=parse(block.note);
        if(note.id && note.title && !note.deleted)result.push({id:`note:${note.id}`,kind:'note',date,slot,text:note.title});
      }
    }
    return result;
  }
  function plan({draft,days,catalog,range,helpers}) {
    const next=clone(days), summaries=[], navigation=[], answers=[];
    const get=date=>next[date] ||= {};
    const actions=draft.actions || [];
    if(!Array.isArray(actions) || actions.length>16)throw Error('Too many voice actions.');
    const selected=new Set();
    for(const action of actions) {
      if(!action || !types.includes(action.type))throw Error('Unsupported voice action.');
      const allowed=['type','target','date','start','end_date','end','category','activity','text','status','screen','horizon','completed','energy','satisfaction'];
      if(Object.keys(action).some(k=>!allowed.includes(k)))throw Error('Unsupported action field.');
      for(const key of allowed.filter(k=>!['completed','energy','satisfaction'].includes(k)))if(action[key]!=null && (typeof action[key]!=='string' || action[key].length>4000))throw Error('Invalid action text.');
      const a=action, target=a.target?catalog.find(t=>t.id===a.target):null;
      if(a.target && !target)throw Error('That selection is no longer available. Describe it again.');
      if(target && selected.has(target.id))throw Error('Give one change per selected item at a time.');
      if(target)selected.add(target.id);
      const requireDate=()=>{if(!dateOK(a.date))throw Error('Choose a valid date for this action.');return get(a.date);};
      const requireTarget=kind=>{if(target?.kind!==kind)throw Error(`Choose the exact ${kind} to change.`);return get(target.date);};
      if(a.type==='navigate') {
        if(!screens.includes(a.screen) || (a.date && !dateOK(a.date)))throw Error('Choose a valid screen and date.');
        navigation.push(a);summaries.push(`Open ${a.screen}${a.date?' · '+a.date:''}`);
      } else if(a.type==='activity_update' || a.type==='activity_delete') {
        const day=requireTarget('activity');
        const old=range.build(target.date,target.start,target.date,target.end);
        const original=clone(day[target.start]);if(!original)throw Error('That activity has changed.');
        for(const d of old.days)for(const slot of d.slots)delete get(d.date)[slot];
        if(a.type==='activity_update') {
          const destination=range.build(a.date || target.date,a.start || target.start,a.end_date || a.date || target.date,a.end || target.end);
          if(destination.error || destination.hours>168 || destination.days.some(d=>!dateOK(d.date)))throw Error(destination.error || 'Choose at most seven days.');
          if(a.category && !helpers.categories.includes(a.category))throw Error('Choose a supported category.');
          for(const d of destination.days)for(const slot of d.slots) {
            if(get(d.date)[slot])throw Error(`The new time overlaps an entry on ${d.date} at ${slot}. Choose another time.`);
            get(d.date)[slot]={...original,...(a.activity?{sub:a.activity}:{}),...(a.category?{category:a.category}:{}),...(a.text!=null?{note:a.text}:{})};
          }
          summaries.push(`Change ${target.activity}: ${target.date} ${target.start}–${target.end} → ${a.date || target.date} ${a.start || target.start}–${a.end || target.end}${a.activity?' · name: '+a.activity:''}${a.category?' · category: '+a.category:''}${a.text!=null?' · note: '+(a.text || '(clear)'):''}`);
        } else summaries.push(`Delete ${target.activity} · ${target.date} ${target.start}–${target.end}`);
      } else if(a.type.startsWith('objective_')) {
        let date,horizon,day;
        if(a.type==='objective_add') {horizon=a.horizon || 'daily';date=horizon==='daily'?a.date:'2000-01-01';day=horizon==='daily'?requireDate():get(date);if(!textOK(a.text) || /[\r\n]|<!--day-link:/.test(a.text))throw Error('Give one goal at a time.');}
        else {day=requireTarget('objective');date=target.date;horizon=target.horizon;}
        if(!['daily','shortTermObjectives','longTermObjectives'].includes(horizon))throw Error('Choose a goal horizon.');
        if(horizon!=='daily'){date='2000-01-01';day=get(date);}
        const settings=parse(day.__settings__?.note);
        const source=horizon==='daily'?day.__plan__?.note:settings[horizon];
        const items=(source || '').split(/\r?\n/).map(helpers.parseObjective).filter(i=>i.text);
        if(a.type==='objective_add')items.push({text:a.text.trim(),completed:false});
        else {
          const item=items[target.index];if(!item || item.text!==target.text)throw Error('The goal list changed. Make a fresh draft.');
          if(a.type==='objective_remove')items.splice(target.index,1);
          else {
            if(typeof a.completed!=='boolean')throw Error('Specify whether this goal is complete.');
            item.completed=a.completed;
            if(item.linkId)for(const [linkedDate,linkedDay] of Object.entries(next)) {
              if(linkedDate===date)continue;
              const linked=(linkedDay.__plan__?.note || '').split(/\r?\n/).map(helpers.parseObjective).filter(i=>i.text);
              if(linked.some(i=>i.linkId===item.linkId)){for(const i of linked)if(i.linkId===item.linkId)i.completed=a.completed;linkedDay.__plan__={category:'plan',note:helpers.serializeObjectives(linked)};}
            }
          }
        }
        const note=helpers.serializeObjectives(items);
        if(horizon==='daily'){if(note)day.__plan__={category:'plan',note};else delete day.__plan__;}
        else {settings[horizon]=note;day.__settings__={...day.__settings__,category:'settings',note:JSON.stringify(settings)};}
        summaries.push(`${a.type.replaceAll('_',' ')} · ${a.text || target.text}${horizon==='daily'?' · '+date:''}`);
      } else if(a.type==='rough_plan_add') {
        const day=requireDate();if(!textOK(a.text))throw Error('Describe the plan.');
        const plans=helpers.roughPlans(day);if(!plans.includes(a.text.trim()))plans.push(a.text.trim());day.__rough_plan__=helpers.roughPlanBlock(plans);
        summaries.push(`Add plan · ${a.date}: ${a.text}`);
      } else if(a.type==='checkin') {
        const day=requireDate(),ratings=parse(day.__checkin__?.note);
        if(a.energy==null && a.satisfaction==null)throw Error('Give an energy or satisfaction score from 1 to 5.');
        for(const key of ['energy','satisfaction'])if(a[key]!=null){if(!Number.isInteger(a[key]) || a[key]<1 || a[key]>5)throw Error('Ratings must be 1–5.');ratings[key]=a[key];}
        day.__checkin__={category:'checkin',note:JSON.stringify(ratings)};
        summaries.push(`Rate ${a.date}${a.energy!=null?' · energy '+a.energy+'/5':''}${a.satisfaction!=null?' · satisfaction '+a.satisfaction+'/5':''}`);
      } else if(a.type==='day_status') {
        const day=requireDate(),labels={holiday:'Holiday',travel:'Travel day',sick:'Sick day',off:'Day off',clear:'Clear day label'};
        if(!Object.hasOwn(labels,a.status))throw Error('Choose holiday, travel, sick, off, or clear.');
        if(a.status==='clear')delete day.__day_status__;else day.__day_status__={category:'calendar_status',note:labels[a.status],sub:a.status};
        summaries.push(`${a.date} · ${labels[a.status]}`);
      } else if(a.type==='note_append') {
        const day=requireTarget('note');if(!textOK(a.text))throw Error('Say what to add to the note.');
        const note=parse(day[target.slot]?.note);if(!note.id || note.deleted)throw Error('That note is unavailable.');
        note.body=[note.body,a.text.trim()].filter(Boolean).join('\n\n');note.updatedAt=new Date().toISOString();day[target.slot]={...day[target.slot],note:JSON.stringify(note)};
        summaries.push(`Append to “${note.title}”: ${a.text}`);
      } else if(a.type==='query_day') {
        const day=requireDate(),totals={};let count=0;
        for(let n=0;n<48;n++){const block=day[clock(n)];if(!block || /^\[GCal\]/.test(block.note || ''))continue;count++;const name=block.sub || block.category;totals[name]=(totals[name] || 0)+0.5;}
        answers.push(`${a.date}: ${count/2} hours recorded${count?' · '+Object.entries(totals).map(([name,h])=>`${name}: ${h}h`).join(', '):''}. Unrecorded time is unknown; entries may include plans.`);
      }
    }
    const patches=[];
    for(const date of new Set([...Object.keys(days),...Object.keys(next)]))for(const slot of new Set([...Object.keys(days[date] || {}),...Object.keys(next[date] || {})])) {
      const before=normal(days[date]?.[slot]),after=normal(next[date]?.[slot]);if(!same(before,after))patches.push({date,slot,before,after});
    }
    if(patches.length>500)throw Error('Split this into smaller changes.');
    return {patches,summaries,navigation,answers};
  }
  function localCommand(text,{today,viewedDate,shift}) {
    const value=text.trim().toLowerCase().replace(/[.!?]+$/,'');
    if(/^(save|save it|save changes|apply|apply changes|confirm)$/.test(value))return {control:'save'};
    if(/^(cancel|cancel draft|discard|discard draft)$/.test(value))return {control:'cancel'};
    if(/^(undo|undo that|undo last change)$/.test(value))return {control:'undo'};
    const date=/^(?:show|open|go to) (today|yesterday|tomorrow|previous day|next day)$/.exec(value);
    if(date)return {actions:[{type:'navigate',screen:'day',date:date[1]==='today'?today:shift(date[1].includes('day') && !['yesterday','tomorrow'].includes(date[1])?viewedDate:today,['yesterday','previous day'].includes(date[1])?-1:1)}]};
    const screen=/^(?:show|open|go to) (calendar|planner|patterns|notes|goals|activities|gym)$/.exec(value);
    if(screen)return {actions:[{type:'navigate',screen:screen[1]==='activities'?'subs':screen[1]}]};
    return null;
  }
  const api={types,screens,normal,same,dateOK,daysFromRows,targets,plan,localCommand};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.DayVoiceActions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
