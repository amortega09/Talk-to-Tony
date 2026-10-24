#!/usr/bin/env python3
"""Local, opt-in audio→Whisper→diary-agent→Ollama evaluation. Never writes diary entries.
Run: python3 scripts/voice-harness.py [--export /path/to/day-export.json]
Generated audio and reports stay in ignored .day-voice/harness/.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import desktop
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'.day-voice/harness'
ASSETS={'/'+name:ROOT/name for name in ['speech-transcriber.js','speech-worker.js','voice-context.js','diary-agent.js','event-range.js','voice-draft.js']}
ASSETS['/harness.js']=ROOT/'tests/voice-harness/harness.js'


def synthetic_history():
    rows=[]
    def interval(date,start,end,activity,category):
        for minute in range(start,end,30):rows.append({'date':date,'start_time':f'{minute//60:02}:{minute%60:02}','category':category,'subcategory':activity,'note':''})
    for date in ['2026-10-08','2026-10-09','2026-10-12','2026-10-13']:interval(date,510,570,'Weekday Morning Routine','chores')
    interval('2026-10-13',570,720,'CFD','work');interval('2026-10-13',780,1050,'CFD','work')
    interval('2026-10-13',720,780,'Lunchtime routine','relax');interval('2026-10-13',1050,1080,'Walk','exercise')
    interval('2026-08-18',600,720,'Moeve','work')
    return rows


def exported_history(path):
    source=json.loads(path.read_text());rows=[]
    for date,day in source.get('days',{}).items():
        if date=='2000-01-01':continue
        for block in day.get('blocks',[]):
            category=block.get('category','other');label=block.get('subcategory') or (block.get('category_label') if category.startswith('c_') else '')
            rows.append({'date':date,'start_time':block['start_time'],'category':category if category in desktop.CATEGORIES else 'other','subcategory':label or '', 'note':block.get('note','')})
        for field,slot,category in [('reflection','__reflect__','reflection'),('objectives','__plan__','plan')]:
            if day.get(field):rows.append({'date':date,'start_time':slot,'category':category,'note':day[field]})
        if day.get('checkin'):rows.append({'date':date,'start_time':'__checkin__','category':'checkin','note':json.dumps(day['checkin'])})
    targets=source.get('targets',{})
    rows.append({'date':'2000-01-01','start_time':'__settings__','note':json.dumps({'shortTermObjectives':targets.get('short_term',''),'longTermObjectives':targets.get('long_term','')})})
    for note in source.get('notes',[]):
        if isinstance(note,dict):rows.append({'date':'2000-01-01','start_time':'__note__'+str(note.get('id','')),'note':json.dumps(note)})
    return rows


def copy_expectations(cases,rows):
    """Independent oracle: exact contiguous saved CFD intervals, preserving gaps."""
    source=sorted((r for r in rows if r['date']=='2026-10-13' and r.get('subcategory')=='CFD' and not r.get('note','').startswith('[GCal]')),key=lambda r:r['start_time'])
    intervals=[]
    for row in source:
        hour,minute=map(int,row['start_time'].split(':'));start=hour*60+minute;end=start+30
        clock=lambda value:f'{value//60:02}:{value%60:02}'
        if intervals and intervals[-1][-1]==clock(start):intervals[-1][-1]=clock(end)
        else:intervals.append(['CFD','work','2026-10-14',clock(start),'2026-10-14',clock(end)])
    if not intervals:raise ValueError('Export fixture needs saved CFD intervals on 2026-10-13; use the default synthetic suite instead.')
    next(c for c in cases if c['id']=='repeat_cfd')['turns'][0]['expected']['items']=intervals


def prepare(cases,voice='Daniel'):
    audio={};(DATA/'audio').mkdir(parents=True,exist_ok=True)
    for case in cases:
        if not re.fullmatch('[a-z_]+',case['id']):raise ValueError('Invalid case ID')
        for index,turn in enumerate(case['turns']):
            name=f"{case['id']}-{index}.wav";target=DATA/'audio'/name
            fingerprint=hashlib.sha256((voice+'|'+turn['say']).encode()).hexdigest();stamp=target.with_suffix('.sha')
            if not target.exists() or not stamp.exists() or stamp.read_text()!=fingerprint:
                if case.get('silence'):
                    with wave.open(str(target),'wb') as output:output.setnchannels(1);output.setsampwidth(2);output.setframerate(16000);output.writeframes(b'\0'*32000)
                else:
                    if not shutil.which('say') or not shutil.which('ffmpeg'):raise SystemExit('Audio preparation requires macOS say and ffmpeg.')
                    source=target.with_suffix('.aiff')
                    subprocess.run(['say','-v',voice,'-r','165','-o',str(source),turn['say']],check=True)
                    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),'-ar','16000','-ac','1',str(target)],check=True)
                    source.unlink(missing_ok=True)
                stamp.write_text(fingerprint)
            audio['/audio/'+name]=target
    return audio


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--export',type=Path);parser.add_argument('--port',type=int,default=8878);parser.add_argument('--voice',default='Daniel');args=parser.parse_args()
    cases=json.loads((ROOT/'tests/voice-harness/cases.json').read_text());rows=exported_history(args.export) if args.export else synthetic_history()
    if args.export:copy_expectations(cases,rows)
    audio=prepare(cases,args.voice);token=secrets.token_urlsafe(24);origin=f'http://127.0.0.1:{args.port}'
    suite={'source':'private-export' if args.export else 'synthetic-diary','rows':rows,'cases':cases}
    (DATA/'suite.json').write_text(json.dumps(suite))
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def send(self,status,value,mime='application/json'):
            body=value if isinstance(value,bytes) else json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.send_header('X-Frame-Options','DENY');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_GET(self):
            if self.headers.get('Host')!=f'127.0.0.1:{args.port}':return self.send(403,{'error':'Invalid host'})
            path=self.path.split('?')[0]
            if path=='/':return self.send(200,(ROOT/'tests/voice-harness/index.html').read_bytes()+f'<script>window.HARNESS_TOKEN={json.dumps(token)};</script>'.encode(),'text/html')
            if path=='/suite':return self.send(200,suite)
            if path=='/report' and (DATA/'latest.json').exists():return self.send(200,json.loads((DATA/'latest.json').read_text()))
            target=(ASSETS|audio).get(path)
            if target:return self.send(200,target.read_bytes(),'audio/wav' if path.endswith('.wav') else 'text/javascript')
            return self.send(404,{'error':'Not found'})
        def do_POST(self):
            if self.headers.get('Host')!=f'127.0.0.1:{args.port}' or self.headers.get('Origin')!=origin or self.headers.get('X-Harness-Token')!=token:return self.send(403,{'error':'Local harness token required'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=2_000_000:raise ValueError('Invalid request size')
                value=json.loads(self.rfile.read(length))
                if not isinstance(value,dict):raise ValueError('Expected an object')
                if self.path=='/draft':return self.send(200,desktop.interpret(value,timeout=60))
                if self.path=='/report':(DATA/'latest.json').write_text(json.dumps(value,indent=2));return self.send(200,{'saved':True})
                return self.send(404,{'error':'Not found'})
            except (ValueError,OSError) as error:return self.send(400,{'error':str(error)})
    print(f'Voice harness: {origin}',flush=True);print('No diary writes. Report: .day-voice/harness/latest.json',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()


if __name__=='__main__':main()
