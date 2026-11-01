'use strict';
const dates=require('./dates.cjs'),{label}=require('./day-summary.cjs');
const compact=date=>date.replaceAll('-','');
function callback(verb,connection,date){return `${verb}:${connection.replaceAll('-','')}:${date==='today'?date:compact(date)}`;}
function navigation(connection,date){
 const button=(text,value)=>({text,callback_data:callback('day',connection,value)});
 return [button('◀',dates.shift(date,-1)),button('📅 '+date,date),button('Today','today'),button('▶',dates.shift(date,1))];
}
function card(connection,date){return {text:`📅 Selected diary day: ${label(date)}\nUndated diary entries use this day. Type /day YYYY-MM-DD to choose any date.`,discussionDate:date,reply_markup:{inline_keyboard:[[...navigation(connection,date)],[{text:'View diary',callback_data:callback('dview',connection,date)},{text:'Find gaps',callback_data:callback('dgaps',connection,date)}]]}};}
function parse(value){const m=/^(day|dview|dgaps):([a-f0-9]{32}):(today|\d{8})$/.exec(value || '');if(!m)return null;const h=m[2],date=m[3]==='today'?'today':`${m[3].slice(0,4)}-${m[3].slice(4,6)}-${m[3].slice(6)}`;if(date!=='today'&&!dates.valid(date))return null;return {verb:m[1],id:`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,date};}
function decorate(payload,connection){
 if(!dates.valid(payload.discussionDate)||payload.reply_markup?.keyboard)return payload;
 const rows=payload.reply_markup?.inline_keyboard || [];if(rows.some(row=>row.some(b=>b.callback_data?.startsWith('day:'))))return payload;
 return {...payload,reply_markup:{inline_keyboard:[...rows,navigation(connection,payload.discussionDate)]}};
}
module.exports={card,parse,decorate,navigation};
