'use strict';
// Prepare an owner-scoped, reversible update; apply via organize-history.cjs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const M=require('../activity-model'),A=require('../voice-actions'),{exportRows,report}=require('./organize-history.cjs');
function planHierarchy(rows,catalog){
 const settingsRow=rows.find(r=>r.date==='2000-01-01'&&r.start_time==='__settings__');if(!settingsRow)throw Error('Existing settings are required.');
 const settings=JSON.parse(settingsRow.note),companies=M.companies(catalog || settings.workCompanies),changes=[];
 let timed=0,review=0,work=0,assigned=0;
 for(const row of rows){
  if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(row.start_time))continue;timed++;
  const before=A.normal(row);let after=before;
  if(row.category==='work'){
   work++;const details=M.details(before.details);
   if(!details.company&&details.project){const matches=companies.filter(c=>c.projects.some(p=>M.key(p)===M.key(details.project)));if(matches.length===1){details.company=matches[0].name;details.project=matches[0].projects.find(p=>M.key(p)===M.key(details.project));assigned++;}}
   after=M.withDetails(before,details);if(M.workError(after,companies))after=M.withDetails(after,{...details,needs_review:true});
  }
  if(after.details?.needs_review)review++;
  if(!A.same(before,after))changes.push({id:row.id,date:row.date,slot:row.start_time,version:row.version,before,after});
 }
 const before=A.normal(settingsRow),after={...before,note:JSON.stringify({...settings,workCompanies:companies,workHierarchyVersion:1})};
 if(!A.same(before,after))changes.push({id:settingsRow.id,date:settingsRow.date,slot:settingsRow.start_time,version:settingsRow.version,before,after});
 return {version:1,timed,review,work,assigned,changes};
}
async function main(){
 if(fs.existsSync('.env'))process.loadEnvFile('.env');
 const ownerExport=process.argv[2];if(!ownerExport)throw Error('Pass an owner export path, then an optional explicit company/project JSON catalogue.');
 const {Store,poolFromEnv}=require('../server/telegram/store.cjs'),pool=poolFromEnv();
 try{
  const {owner}=await new Store(pool).owner();assert.equal(owner,JSON.parse(fs.readFileSync(ownerExport,'utf8')).user_id);
  const rows=(await pool.query("select b.*,b.date::text as date,id::text || ':' || xmin::text as version from public.blocks b where user_id=$1 order by b.date,b.start_time",[owner])).rows;
  const catalog=process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):undefined,plan=planHierarchy(rows,catalog);
  const dir=path.resolve('.day-voice/work-hierarchy',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
  for(const [name,value] of [['before-rows.json',rows],['before-export.json',exportRows(rows,owner)],['plan.json',{...plan,owner,outputDirectory:path.dirname(path.resolve(ownerExport))}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2),{mode:0o600});
  fs.writeFileSync(path.join(dir,'review.md'),report(plan),{mode:0o600});
  console.log(JSON.stringify({backup:dir,workBlocks:plan.work,explicitlyAssigned:plan.assigned,changes:plan.changes.length,reviewBlocks:plan.review}));
 }finally{await pool.end();}
}
module.exports={planHierarchy};if(require.main===module)main().catch(e=>{console.error('Work hierarchy planning stopped:',e.message);process.exitCode=1;});
