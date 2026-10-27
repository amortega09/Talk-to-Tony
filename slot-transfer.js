/* Pure selection planner, shared by the page and transfer tests. */
(function(root){
  function plan(sourceDay,source,destination,slots){
    const selected=[...new Set(slots)].filter(s=>source[s]);
    if(!selected.length)throw Error('Select an entry to move first.');
    if(selected.some(s=>!/^(0\d|1\d|2[0-3]):(00|30)$/.test(s)))throw Error('Select recorded time slots.');
    if(selected.some(s=>destination[s]))throw Error('Yesterday already has entries at those times. Nothing moved.');
    const day=new Date(sourceDay+'T12:00:00');
    if(Number.isNaN(day.getTime()))throw Error('Invalid day.');
    day.setDate(day.getDate()-1);
    const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    const from=structuredClone(source),to=structuredClone(destination),expected={};
    for(const slot of selected){expected[slot]={category:source[slot].category,note:source[slot].note || '',sub:source[slot].sub || ''};to[slot]=structuredClone(source[slot]);delete from[slot];}
    return {date,from,to,expected,count:selected.length};
  }
  const api={plan};if(typeof module==='object')module.exports=api;else root.DaySlotTransfer=api;
})(typeof globalThis!=='undefined'?globalThis:this);
