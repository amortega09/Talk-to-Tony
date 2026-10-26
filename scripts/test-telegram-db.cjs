'use strict';
// Fresh isolated PostgreSQL cluster, Unix socket only, no production URL accepted.
const {mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
const dir=mkdtempSync(join(tmpdir(),'day-telegram-test-'));
const bindir=process.env.PG_BINDIR || '/opt/homebrew/opt/postgresql@16/bin';
function run(name,args,options={}){const r=spawnSync(join(bindir,name),args,{encoding:'utf8',...options});if(r.status!==0)throw new Error(`${name} failed: ${r.stderr || r.stdout}`);return r;}
let started=false;
try {
  run('initdb',['-D',join(dir,'data'),'-A','trust','-U','postgres','--no-locale']);
  run('pg_ctl',['-D',join(dir,'data'),'-l',join(dir,'log'),'-o',`-k '${dir}' -h '' -p 5432`,'-w','start']);started=true;
  const result=spawnSync(process.execPath,['--test','tests/telegram-db.integration.cjs'],{stdio:'inherit',env:{...process.env,DAY_BOT_TEST_SOCKET:dir}});
  process.exitCode=result.status || 0;
} catch(e){console.error(e.message);if(started)console.error(readFileSync(join(dir,'log'),'utf8'));process.exitCode=1;}
finally {if(started)run('pg_ctl',['-D',join(dir,'data'),'-m','immediate','-w','stop']);rmSync(dir,{recursive:true,force:true});}
