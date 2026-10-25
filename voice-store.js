/* Voice-only persistence: bounded, owner-scoped reads and checked, undoable patches. */
(function(root) {
  async function read({client,owner,dates,signal,local}) {
    if(!client)return Object.fromEntries(dates.map(date=>[date,local(date)]));
    if(!owner)throw Error('Please sign in.');
    const days=Object.fromEntries(dates.map(date=>[date,{}]));
    for(let offset=0;;offset+=500) {
      let q=client.from('blocks').select('date,start_time,category,note,subcategory').eq('user_id',owner).in('date',dates).order('date').order('start_time').range(offset,offset+499);
      if(signal && q.abortSignal)q=q.abortSignal(signal);
      const {data,error}=await q;if(error || !Array.isArray(data))throw Error('Could not check saved records. Nothing new was applied.');
      for(const r of data)if(days[r.date])days[r.date][r.start_time]={category:r.category,note:r.note || '',sub:r.subcategory || ''};
      if(data.length<500)return days;
    }
  }
  async function apply({patches,client,owner,currentOwner,local,localBefore,onApplied,same}) {
    const applied=[];
    const checkOwner=()=>{if(currentOwner()!==owner)throw Error('Your account changed. Reopen voice.');};
    checkOwner();
    const dates=[...new Set(patches.map(p=>p.date))];
    const fresh=await read({client,owner,dates,local});checkOwner();
    for(const p of patches) {
      if(!same(fresh[p.date]?.[p.slot],p.before))throw Error('An affected record changed since the preview. Make a fresh voice draft.');
      if(client && localBefore?.[p.date]?.[p.slot] && !same(localBefore[p.date][p.slot],p.before))throw Error('Local and cloud versions differ for an affected record. Sync that day before applying voice changes.');
      if(localBefore && !same(local(p.date)?.[p.slot],localBefore[p.date]?.[p.slot]))throw Error('You edited an affected record since the preview. Make a fresh voice draft.');
    }
    const groups=[];
    const writes=patches.filter(p=>p.after);if(writes.length)groups.push(writes);
    for(const date of dates){const removes=patches.filter(p=>p.date===date && !p.after);if(removes.length)groups.push(removes);}
    try {
      for(const group of groups) {
        checkOwner();
        if(client) {
          let response;
          if(group[0].after)response=await client.from('blocks').upsert(group.map(p=>({user_id:owner,date:p.date,start_time:p.slot,category:p.after.category,note:p.after.note || '',subcategory:p.after.sub || '',updated_at:new Date().toISOString()})),{onConflict:'user_id,date,start_time'}).select('date,start_time');
          else response=await client.from('blocks').delete().eq('user_id',owner).eq('date',group[0].date).in('start_time',group.map(p=>p.slot)).select('date,start_time');
          if(response.error || response.data?.length!==group.length)throw Error('Cloud save could not be confirmed. Some changes may have reached the server. Refresh the affected days before trying again.');
        }
        checkOwner();applied.push(...group);onApplied(group);
      }
      return applied;
    } catch(error) {error.applied=applied;throw error;}
  }
  const api={read,apply};if(typeof module!=='undefined' && module.exports)module.exports=api;else root.DayVoiceStore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
