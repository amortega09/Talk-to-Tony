'use strict';
// Explicit operator migration. Uses the scoped bot role, fresh rows, a private
// backup, version checks and one transaction; never imports the supplied export.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const M=require('../activity-model');
const A=require('../voice-actions');
function planRows(rows,{projectNames=[]}={}){
  const settings=JSON.parse(rows.find(r=>r.date==='2000-01-01'&&r.start_time==='__settings__')?.note || '{}');
  projectNames=[...new Set([...(settings.workProjects || []),...projectNames])];
  const changes=[];let timed=0,review=0;
  for(const row of rows){
    if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(row.start_time))continue;
    timed++;
    const before=A.normal(row),after=M.normalize(before,{history:true,customCats:settings.customCats || [],projectNames});
    if(after.details?.needs_review)review++;
    if(!A.same(before,after))changes.push({id:row.id,date:row.date,slot:row.start_time,version:row.version,before,after});
  }
  const subs={},areas={};
  for(const [category,names] of Object.entries(settings.subs || {}))for(const name of names){const b=M.normalize({category,sub:name},{customCats:settings.customCats || [],projectNames});(subs[b.category] ||= new Set()).add(b.sub);areas[M.key(b.sub)]=b.category;}
  for(const row of rows){if(!/^[0-2]\d:[03]0$/.test(row.start_time))continue;const b=M.normalize(A.normal(row),{history:true,customCats:settings.customCats || [],projectNames});if(b.sub){(subs[b.category] ||= new Set()).add(b.sub);areas[M.key(b.sub)]=b.category;}}
  const nextSettings={...settings,workProjects:projectNames,subs:Object.fromEntries(Object.entries(subs).map(([cat,set])=>[cat,[...set].filter(Boolean)])),activityAreas:{...settings.activityAreas,...areas},categoryMigrationVersion:Math.max(2,settings.categoryMigrationVersion || 0),organizationVersion:M.version};
  const settingsRow=rows.find(r=>r.date==='2000-01-01'&&r.start_time==='__settings__');
  if(!settingsRow)throw Error('No existing settings row. Refusing to invent one during a history migration.');
  const before=A.normal(settingsRow),after={...before,note:JSON.stringify(nextSettings)};
  if(!A.same(before,after))changes.push({id:settingsRow.id,date:settingsRow.date,slot:settingsRow.start_time,version:settingsRow.version,before,after});
  return {version:M.version,timed,review,changes};
}
function exportRows(rows,owner){
  const days={},notes=[],settings=JSON.parse(rows.find(r=>r.start_time==='__settings__')?.note || '{}');let noteProjects=[];
  const parse=(value,fallback)=>{try{return JSON.parse(value)}catch{return fallback}};
  for(const row of rows){
    if(row.date==='2000-01-01'){
      if(row.start_time.startsWith('__note__')){const n=parse(row.note,null);if(n&&!n.deleted)notes.push(n);}
      if(row.start_time==='__note_projects__')noteProjects=parse(row.note,{}).projects || [];
      continue;
    }
    const day=days[row.date] ||= {checkin:{energy:null,satisfaction:null},gym:null,reflection:'',objectives:'',day_status:null,rough_plans:[],event_reminders:[],blocks:[]};
    if(/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(row.start_time))day.blocks.push({start_time:row.start_time,category:row.category,category_label:M.labels[row.category] || row.category,subcategory:row.subcategory || '',note:row.note || '',details:row.details || {}});
    else if(row.start_time==='__reflect__')day.reflection=row.note || '';
    else if(row.start_time==='__plan__')day.objectives=row.note || '';
    else if(row.start_time==='__checkin__')day.checkin=parse(row.note,day.checkin);
    else if(row.start_time==='__gym__')day.gym=parse(row.note,null);
    else if(row.start_time==='__day_status__')day.day_status={type:row.subcategory || '',label:row.note || ''};
    else if(row.start_time==='__rough_plan__')day.rough_plans=parse(row.note,(row.note || '').split('\n').filter(Boolean));
    else if(row.start_time==='__event_reminders__')day.event_reminders=parse(row.note,[]);
  }
  return {exported_at:new Date().toISOString(),user_id:owner,organization_version:M.version,settings,work_projects:settings.workProjects || [],targets:{short_term:settings.shortTermObjectives || '',long_term:settings.longTermObjectives || ''},notes,note_projects:noteProjects,days};
}
function report(plan){
 const groups=new Map();for(const c of plan.changes){if(c.date==='2000-01-01')continue;const name=`${c.before.category} / ${c.before.sub || '(no activity)'} → ${c.after.category} / ${c.after.sub || '(no activity)'}${M.describe(c.after)?' · '+M.describe(c.after):''}${c.after.details?.needs_review?' [review]':''}`;groups.set(name,(groups.get(name)||0)+1);}
 return `# Diary organisation\n\n${plan.timed} timed blocks checked (${plan.timed/2} hours).\n${plan.changes.filter(c=>c.date!=='2000-01-01').length} blocks reorganised or flagged.\n${plan.review} blocks retain their classification for review.\n\nDates, durations, notes, objectives and workout content are preserved. Transport combinations count once.\n\n`+[...groups].map(([name,n])=>`- ${name}: ${n} blocks (${n/2} hours)`).join('\n')+'\n';
}
async function main(){
 if(fs.existsSync('.env'))process.loadEnvFile('.env');
 const {poolFromEnv,Store}=require('../server/telegram/store.cjs');
 const pool=poolFromEnv();
 try{
  const {owner}=await new Store(pool).owner();
  const command=process.argv[2] || 'plan';
  const ownerFile=command==='plan'?process.argv[3]:null;
  if(command==='plan'){if(!ownerFile)throw Error('Pass the owner export path explicitly');const supplied=JSON.parse(fs.readFileSync(ownerFile,'utf8'));assert.equal(owner,supplied.user_id,'Scoped database owner does not match supplied diary');}
  const read=async c=>(await c.query("select b.*,date::text as date,id::text || ':' || xmin::text as version from public.blocks b where user_id=$1 order by b.date,b.start_time",[owner])).rows;
  if(command==='plan'){
    const projectNames=process.argv[4]?JSON.parse(fs.readFileSync(process.argv[4],'utf8')):[];
    if(!Array.isArray(projectNames)||projectNames.some(p=>typeof p!=='string'||p.length>300))throw Error('Invalid project vocabulary');
    const rows=await read(pool),plan=planRows(rows,{projectNames}),stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const dir=path.resolve('.day-voice/migrations',stamp);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    for(const [name,value] of [['before-rows.json',rows],['before-export.json',exportRows(rows,owner)],['plan.json',{...plan,owner,outputDirectory:path.dirname(path.resolve(ownerFile))}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2),{mode:0o600});
    fs.writeFileSync(path.join(dir,'review.md'),report(plan),{mode:0o600});
    fs.writeFileSync('/tmp/day-organization-plan-path',dir,{mode:0o600});
    console.log(JSON.stringify({backup:dir,blocks:plan.timed,changes:plan.changes.length,review:plan.review}));return;
  }
  if(!['apply','rollback'].includes(command))throw Error('Use plan, apply or rollback');
  const dir=process.argv[3];if(!dir)throw Error('Pass the private backup directory explicitly');
  const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'),'utf8'));assert.equal(plan.owner,owner);
  const c=await pool.connect();
  try{
    await c.query('begin');await c.query("set local lock_timeout='10s';set local statement_timeout='60s'");
    const live=(await c.query("select b.*,date::text as date,id::text || ':' || xmin::text as version from public.blocks b where user_id=$1 order by b.date,b.start_time for update",[owner])).rows;
    const index=new Map(live.map(r=>[String(r.id),r]));
    let committed;
    if(command==='rollback')committed=JSON.parse(fs.readFileSync(path.join(dir,'committed-rows.json'),'utf8'));
    for(const p of plan.changes){
      const row=index.get(String(p.id));assert.ok(row,'A source record was deleted');
      const expected=command==='apply'?p.before:p.after;
      assert.ok(A.same(row,expected),'A source record changed since the migration snapshot');
      if(command==='apply')assert.equal(row.version,p.version,'A source version changed');
      else assert.equal(row.version,committed.find(r=>String(r.id)===String(p.id))?.version,'A record changed after migration; rollback will not overwrite it');
      const next=command==='apply'?p.after:p.before;
      const result=await c.query('update public.blocks set category=$3,subcategory=$4,note=$5,details=$6::jsonb,updated_at=clock_timestamp() where user_id=$1 and id=$2',[owner,p.id,next.category,next.sub || '',next.note || '',JSON.stringify(next.details || {})]);assert.equal(result.rowCount,1);
    }
    // Verify row identities, all time slots and all non-settings content before committing.
    const after=await read(c);assert.equal(after.length,live.length);
    for(const row of after){const old=index.get(String(row.id));assert.ok(old);assert.equal(row.date,old.date);assert.equal(row.start_time,old.start_time);if(row.start_time!=='__settings__')assert.equal(row.note,old.note);}
    fs.writeFileSync(path.join(dir,command==='apply'?'committed-rows.json':'rolled-back-rows.json'),JSON.stringify(after,null,2),{mode:0o600});
    await c.query('commit');
    if(command==='apply'){
      const destination=path.join(plan.outputDirectory,'day-organized-'+new Date().toISOString().slice(0,10)+'.json');fs.writeFileSync(destination,JSON.stringify(exportRows(after,owner),null,2),{mode:0o600});
      fs.writeFileSync(path.join(plan.outputDirectory,'day-organisation-review-'+new Date().toISOString().slice(0,10)+'.md'),report(plan),{mode:0o600});
      console.log(JSON.stringify({applied:plan.changes.length,rows:after.length,export:destination,backup:dir}));
    }else console.log('Rollback committed.');
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 }finally{await pool.end();}
}
module.exports={planRows,exportRows,report};
if(require.main===module)main().catch(e=>{console.error('Migration stopped:',e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
