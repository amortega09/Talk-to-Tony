'use strict';
const shift=(date,n)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const valid=date=>/^\d{4}-\d{2}-\d{2}$/.test(date || '')&&!Number.isNaN(Date.parse(date))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function resolve(text,today){
 if(!valid(today))throw Error('Invalid reference date');
 const t=String(text).toLowerCase();
 const iso=t.match(/\b\d{4}-\d{2}-\d{2}\b/);if(iso)return valid(iso[0])?iso[0]:null;
 if(/\byesterday\b/.test(t))return shift(today,-1);if(/\btomorrow\b/.test(t))return shift(today,1);if(/\btoday\b/.test(t))return today;
 const named=t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/);
 if(named){const d=`${named[3] || today.slice(0,4)}-${String(months.indexOf(named[2])+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;return valid(d)?d:null;}
 const weekday=t.match(/\b(?:(last|this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
 if(weekday){const now=new Date(today+'T12:00:00Z').getUTCDay(),want=weekdays.indexOf(weekday[2]);let delta=want-now;
 if(weekday[1]==='next'){if(delta<=0)delta+=7;}else if(weekday[1]==='last'){if(delta>=0)delta-=7;}else if(weekday[1]==='this'){delta=((want+6)%7)-((now+6)%7);}else if(delta>0)delta-=7;
 return shift(today,delta);}
 return null;
}
module.exports={resolve,shift,valid};
// Find the actual London instant; gaps during the spring clock change are invalid.
function localInstant(date,clock){
 if(!valid(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock || ''))return null;
 const wanted=date+' '+clock,base=Date.parse(date+'T'+clock+':00Z');
 const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(const delta of [-120,-60,0,60,120]){const instant=base+delta*60000,parts=Object.fromEntries(fmt.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));if(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`===wanted)return instant;}
 return null;
}
module.exports.localInstant=localInstant;
