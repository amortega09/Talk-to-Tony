/* Read-only diary retrieval and deterministic context selection. No model writes. */
(function (root) {
  const categories = new Set(['sleep','work','exercise','gym','food','learn','social','chores','travel','relax','other']);
  const text = (value, length = 400) => typeof value === 'string' ? value.slice(0, length) : '';
  const parse = value => { try { const parsed=JSON.parse(value || '{}');return parsed && typeof parsed==='object' && !Array.isArray(parsed)?parsed:{}; } catch { return {}; } };
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value;
  const shift = (date, days) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
  const words = value => [...new Set((String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 2 && !new Set(['the','and','was','for','from','until','today','yesterday','this','that','then','same','usual','with','have','had','did','please','like']).has(w)))];
  const clock = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  const slotMinutes = slot => /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot || '') ? Number(slot.slice(0,2))*60+Number(slot.slice(3)) : null;
  async function load({client, userId, storage, signal, pageSize = 1000}) {
    const rows = [];
    if (client) {
      if (!userId) return {rows, source:'cloud', complete:false, problem:'Sign in to load diary history.'};
      try {
        for (let offset=0; ; offset+=pageSize) {
          if (signal?.aborted) throw Object.assign(new Error('Cancelled'),{name:'AbortError'});
          let query=client.from('blocks').select('user_id,date,start_time,category,note,subcategory').eq('user_id',userId).order('date',{ascending:false}).order('start_time',{ascending:true}).range(offset,offset+pageSize-1);
          if (signal && query.abortSignal) query=query.abortSignal(signal);
          const result=await query;
          if (result.error) throw new Error('Diary unavailable');
          if (!Array.isArray(result.data)) throw new Error('Invalid diary response');
          rows.push(...result.data.filter(row=>row.user_id===userId));
          if (result.data.length<pageSize) break;
        }
        return {rows, source:'cloud', complete:true};
      } catch (error) {
        if (signal?.aborted) throw error;
        return {rows, source:'cloud', complete:false, problem:'Some saved history could not be loaded.'};
      }
    }
    // Recovery/local mode only. Never mix unscoped browser caches into signed-in cloud history.
    for (let index=0; index<(storage?.length || 0); index++) {
      const key=storage.key(index);
      if (!key?.startsWith('day_data_')) continue;
      const date=key.slice(9); if (!validDate(date)) continue;
      const day=parse(storage.getItem(key));
      for (const [start_time, block] of Object.entries(day || {})) if (block && typeof block==='object') rows.push({date,start_time,...block,subcategory:block.sub || ''});
    }
    rows.push({date:'2000-01-01',start_time:'__settings__',note:storage?.getItem('day_settings') || '{}'});
    for (const note of Object.values(parse(storage?.getItem('day_notes_v1'))).filter(n=>n && typeof n==='object')) rows.push({date:'2000-01-01',start_time:'__note__'+note.id,note:JSON.stringify(note)});
    return {rows, source:'local', complete:true};
  }
  function select(history, {today, viewedDate, transcript, maxChars=18000}) {
    const rows=history.rows || [], settings=parse(rows.find(r=>r.start_time==='__settings__')?.note);
    const labels=Object.fromEntries((Array.isArray(settings.customCats)?settings.customCats:[]).filter(c=>c && c.id).map(c=>[c.id,text(c.label,120)]));
    // User-confirmed pronunciation; only relevant when this activity exists in this owner's diary.
    const pronunciation = activity => activity.toLowerCase()==='moeve' ? 'moo-ay-vay' : '';
    const terms=words(transcript), match = value => {const hay=words(value);return terms.filter(w=>hay.includes(w)).length;};
    const anchors=new Set([today,shift(today,-1),viewedDate,shift(viewedDate,-1)]);
    for (const date of (String(transcript).match(/\d{4}-\d{2}-\d{2}/g) || []).slice(0,8)) if(validDate(date)) anchors.add(date);
    if (/\btomorrow\b/i.test(transcript)) anchors.add(shift(today,1));
    if (/day before yesterday/i.test(transcript)) anchors.add(shift(today,-2));
    if (/last week/i.test(transcript)) for(let n=7;n<=13;n++) anchors.add(shift(today,-n));
    const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    weekdays.forEach((name,day)=>{
      if(!new RegExp('\\b'+name+'\\b','i').test(transcript))return;
      const currentDay=new Date(today+'T12:00Z').getUTCDay();
      if(new RegExp('next '+name,'i').test(transcript))anchors.add(shift(today,(day-currentDay+7)%7 || 7));
      else anchors.add(shift(today,-((currentDay-day+7)%7 || 7)));
    });
    let period=null;
    if(/last month/i.test(transcript)){const d=new Date(today+'T12:00Z');d.setUTCDate(1);const end=shift(d.toISOString().slice(0,10),-1);d.setUTCMonth(d.getUTCMonth()-1);period=[d.toISOString().slice(0,10),end];}
    const excerpt = (value,limit) => { const raw=text(value,100000), lower=raw.toLowerCase();const found=terms.map(t=>lower.indexOf(t)).filter(i=>i>=0);const start=found.length && Math.min(...found)>limit/2?Math.max(0,Math.min(...found)-100):0;return (start?'…':'')+raw.slice(start,start+limit); };
    const projectSettings=parse(rows.find(r=>r.start_time==='__note_projects__')?.note);
    const projects=Object.fromEntries((Array.isArray(projectSettings.projects)?projectSettings.projects:[]).filter(p=>p && p.id).map(p=>[p.id,text(p.name,160)]));
    const days=new Map(), notes=[];
    for(const row of rows) {
      if(row.date==='2000-01-01') {
        if(row.start_time?.startsWith('__note__')) {const n=parse(row.note);if(!n.deletedAt && !n.deleted && n.title)notes.push({project:projects[n.projectId] || '',title:text(n.title,160),body:excerpt(n.body,1000),truncated:(n.body?.length || 0)>1000});}
        continue;
      }
      if(!validDate(row.date))continue;
      if(!days.has(row.date))days.set(row.date,{slots:new Map(),metadata:[]});
      const day=days.get(row.date), minute=slotMinutes(row.start_time);
      if(minute!==null) {
        const reusableNote=typeof row.note==='string' && row.note.length<=120 && !/^(?:\[GCal\]|__gym_)/.test(row.note)?row.note:'';
        const raw=text(row.subcategory || row.sub || labels[row.category] || reusableNote || row.category,160);
        const mapped=settings.activityAreas?.[raw.toLowerCase()] || row.category;
        const category=categories.has(mapped)?mapped:'other';
        const note=excerpt(row.note,240);
        day.slots.set(minute,{category,activity:raw,note,note_truncated:(row.note?.length || 0)>240,kind:row.date>today || /^\[GCal\]/.test(note)?'planned':'logged'});
      } else if(['__reflect__','__plan__','__rough_plan__','__gym__','__checkin__','__day_status__'].includes(row.start_time)) {
        day.metadata.push({type:row.start_time.replaceAll('__',''),text:excerpt(row.note,800),truncated:(row.note?.length || 0)>800});
      }
    }
    const intervals=[], catalog=new Map();
    for(const [date,day] of days) {
      let last;
      for(const [minute,block] of [...day.slots].sort(([a],[b])=>a-b)) {
        if(last && last.end===clock(minute) && ['activity','category','kind','note'].every(k=>last[k]===block[k]))last.end=clock(minute+30);
        else {last={date,start:clock(minute),end_date:date,end:clock(minute+30),...block};intervals.push(last);}
      }
    }
    for(const item of intervals) {
      const key=item.category+'\0'+item.activity.toLowerCase();
      if(!catalog.has(key))catalog.set(key,{activity:item.activity,category:item.category,days:new Set(),hours:0,last_date:item.date,patterns:new Map()});
      const value=catalog.get(key);value.last_date=value.last_date>item.date?value.last_date:item.date;
      if(item.kind==='logged') {
        value.days.add(item.date);value.hours+=(Number(item.end.slice(0,2))*60+Number(item.end.slice(3))-slotMinutes(item.start))/60;
        const time=item.start+'–'+item.end;if(!value.patterns.has(time))value.patterns.set(time,[]);value.patterns.get(time).push(item.date);
      }
    }
    for(const [category,values] of Object.entries(settings.subs || {}))for(const label of Array.isArray(values)?values:[]) {
      const key=category+'\0'+String(label).toLowerCase();if(!catalog.has(key))catalog.set(key,{activity:text(label,160),category:categories.has(category)?category:'other',days:new Set(),hours:0,last_date:'',patterns:new Map()});
    }
    const ranked=[...catalog.values()].sort((a,b)=>match(b.activity+' '+pronunciation(b.activity))-match(a.activity+' '+pronunciation(a.activity)) || b.days.size-a.days.size || b.last_date.localeCompare(a.last_date));
    const routines=ranked.map(a=>{
      const patterns=[...a.patterns].map(([time,dates])=>[time,dates.filter(d=>d>=shift(today,-60))]).filter(([,dates])=>dates.length);
      const observed=new Set(patterns.flatMap(([,dates])=>dates));
      const common=patterns.sort((a,b)=>b[1].length-a[1].length)[0];
      if(!common || common[1].length<3 || common[1].length<observed.size*0.6)return null;
      const [start,end]=common[0].split('–');return {activity:a.activity,category:a.category,common_start:start,common_end:end,observed_days:observed.size,matching_days:common[1].length,period_start:shift(today,-60),example_dates:common[1].sort().slice(-3)};
    }).filter(Boolean).slice(0,12);
    const dated=[...days.keys()].filter(d=>d<=today).sort();
    const output={source:history.source,status:history.complete?'ready':'partial',coverage:{days_available:dated.length,first_date:dated[0] || null,last_date:dated.at(-1) || null,history_load_complete:history.complete,selection_limited:false},activities:[],routines:[],goals:{short_term:text(settings.shortTermObjectives,1200),long_term:text(settings.longTermObjectives,1200)},entries:[],day_notes:[],notes:[],day_coverage:[]};
    const fits=()=>JSON.stringify(output).length<=maxChars;
    function add(list,value){list.push(value);if(!fits()){list.pop();output.coverage.selection_limited=true;return false;}return true;}
    for(const value of ranked.slice(0,80)) {if(JSON.stringify(output.activities).length>3500){output.coverage.selection_limited=true;break;}add(output.activities,{activity:value.activity,...(pronunciation(value.activity)?{pronunciation:pronunciation(value.activity)}:{}),category:value.category,days_logged:value.days.size,hours_logged:value.hours,last_date:value.last_date || null});}
    for(const value of routines){if(JSON.stringify(output.routines).length>1800)break;add(output.routines,value);}
    const score = (date,value) => (anchors.has(date)?10000:period && date>=period[0] && date<=period[1]?8000:0)+match(value)*100+(date>=shift(today,-14) && date<=today?20:0);
    const dayNotes=[...days].flatMap(([date,day])=>day.metadata.map(n=>({date,...n}))).sort((a,b)=>score(b.date,b.text)-score(a.date,a.text)||b.date.localeCompare(a.date));
    const selected=intervals.sort((a,b)=>score(b.date,b.activity+' '+b.note)-score(a.date,a.activity+' '+a.note)||b.date.localeCompare(a.date)||a.start.localeCompare(b.start));
    // Exact intervals for explicitly referenced/recent anchor days take priority over prose.
    for(const value of selected.filter(x=>anchors.has(x.date))) {
      if(JSON.stringify(output.entries).length>8500 || output.entries.length>=80)break;
      add(output.entries,value);
    }
    for(const value of dayNotes.filter(n=>anchors.has(n.date)||match(n.text)>0).slice(0,4))add(output.day_notes,value);
    for(const value of notes.sort((a,b)=>match(b.title+' '+b.project+' '+b.body)-match(a.title+' '+a.project+' '+a.body)).filter(n=>match(n.title+' '+n.project+' '+n.body)>0).slice(0,2))add(output.notes,value);
    const already=new Set(output.entries);
    for(const value of selected) {
      if(already.has(value))continue;
      if(!anchors.has(value.date) && !match(value.activity+' '+value.note) && !(period && value.date>=period[0] && value.date<=period[1]) && value.date<shift(today,-14))continue;
      if(output.entries.length>=80){output.coverage.selection_limited=true;break;}
      add(output.entries,value);
    }
    function refreshCoverage() {
      output.day_coverage=[...new Set([...anchors,...output.entries.map(x=>x.date)])].sort().map(date=>{
        const available=intervals.filter(x=>x.date===date).length,included=output.entries.filter(x=>x.date===date).length;
        return {date,activities_available:available,activities_included:included,complete:history.complete && available===included};
      });
    }
    refreshCoverage();
    while(!fits() && output.entries.length){output.entries.pop();output.coverage.selection_limited=true;refreshCoverage();}
    return output;
  }
  const api={load,select};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.DayVoiceContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
