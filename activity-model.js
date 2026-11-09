/* Shared activity organisation. Pure: never reads storage or writes records. */
(function(root){
  const labels={sleep:'Sleep',work:'Work & career',exercise:'Exercise',food:'Food',learn:'Learning',social:'Social',chores:'Life admin & chores',health:'Personal care & health',travel:'Travel',relax:'Leisure',other:'Other'};
  const modes=['Walk','Bike','Car','Taxi','Bus','Train','Tube / Metro','Tram','Plane','Ferry','Other'];
  const activities={sleep:['Sleep','Nap'],work:['Work','Focused work','Lab work','Meeting','Interview','Job search','Preparation','Presentation','Handover','Data analysis'],exercise:['Walking','Cycling','Gym','Football training','Football match','Tennis','Parkrun'],food:['Cooking','Eating','Eating out','Lunch break'],social:['Spending time together','Calling','Messaging','Social outing','Family time','Celebration'],relax:['TV','Film','YouTube','Reading','Games','Relaxing'],learn:['Reading','Course','Research','Practice'],chores:['Cleaning','Shopping','Finances','Organising','Chores'],health:['Morning routine','Shower','Appointment','Recovery'],travel:['Travel','Commuting'],other:['Other']};
  const key=s=>String(s || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const aliases={
    'watch tv':['relax','TV'],'watch film':['relax','Film'],'watch youtube':['relax','YouTube'],'watching football':['relax','Watching football'],'relax':['relax','Relaxing'],
    'calling someone':['social','Calling'],'phoning friends':['social','Calling'],'chatting to housemates':['social','Spending time together'],'meeting friends':['social','Spending time together'],'meeting family':['social','Family time'],'family':['social','Family time'],'meal out':['food','Eating out'],'restaurant':['food','Eating out'],
    'walk':['exercise','Walking'],'evening walk':['exercise','Walking'],'walking home':['travel','Travel',['Walk']],
    'train':['travel','Travel',['Train']],'metro':['travel','Travel',['Tube / Metro']],'public transport':['travel','Travel'],
    'car':['travel','Travel',['Car']],'bus':['travel','Travel',['Bus']],'plane':['travel','Travel',['Plane']],'uber':['travel','Travel',['Taxi']],
    'gym':['exercise','Gym'],'gym - back and arms':['exercise','Gym'],
    'lab':['work','Lab work'],'job interview':['work','Interview'],'job search':['work','Job search'],'prep':['work','Preparation'],'presentation work':['work','Presentation'],'meeting - presenting':['work','Meeting'],
    'weekday morning routine':['health','Morning routine'],'shower':['health','Shower'],'lunchtime routine':['food','Lunch break'],
    'hospital':['health','Appointment'],'dentist':['health','Appointment'],'opticians':['health','Appointment'],'appointment':['health','Appointment'],
    'cooking':['food','Cooking']
  };
  const projects=[]; // Project vocabulary belongs to each owner's synced settings.
  const ambiguous=new Set(['excursion','random','misc','mixture','pilot','pilota','anxious','stress','action','tasks']);
  function details(value){
    if(value==null)return {};
    if(typeof value!=='object'||Array.isArray(value))throw Error('Invalid activity details.');
    const out={};
    for(const name of ['company','project','destination','original_category','original_activity'])if(value[name]!=null){if(typeof value[name]!=='string'||value[name].length>300)throw Error('Activity details must be under 300 characters.');if(value[name].trim())out[name]=value[name].trim();}
    if(value.modes!=null){if(!Array.isArray(value.modes)||value.modes.some(m=>!modes.includes(m)))throw Error('Choose supported transport modes.');const chosen=new Set(value.modes);if(chosen.size)out.modes=modes.filter(m=>chosen.has(m));}
    if(value.needs_review===true)out.needs_review=true;
    return out;
  }
  function withDetails(block,value){const d=details(value);const out={...block};delete out.details;if(Object.keys(d).length)out.details=d;return out;}
  function normalize(block,{history=false,customCats=[],projectNames=[]}={}){
    let category=block.category,sub=block.sub || block.subcategory || '',d=details(block.details);
    if(!/^(?:sleep|work|exercise|gym|food|learn|social|chores|health|travel|relax|other|c_.*|Work)$/.test(category))return {...block};
    if((block.note || '').startsWith('[GCal]'))return {...block};
    const originalCategory=category,originalActivity=sub;
    if(category==='Work')category='work';
    if(category.startsWith('c_')){const c=customCats.find(c=>c.id===category);if(c){sub=sub || c.label;category='other';}}
    const name=key(sub || (category==='gym'?'Gym':''));
    const walking=['walk','walking','evening walk','walking home'].includes(name),cycling=['bike','cycling'].includes(name);
    const mapping=category==='travel'&&(walking||cycling)?['travel','Travel',[walking?'Walk':'Bike']]:aliases[name];
    // A conflicting stored purpose is evidence to review, not permission to guess.
    const conflict=category==='sleep' && name && !['sleep','nap'].includes(name);
    if(!conflict && mapping){[category,sub]=mapping;if(mapping[2]&&!d.modes)d.modes=mapping[2];}
    if(category==='gym'){category='exercise';sub='Gym';}
    const project=['work','other'].includes(category)&&projectNames.find(p=>key(p)===name);
    if(project){category='work';d.project=d.project || project;sub='Work';}
    if(category==='travel'){
      if(!sub)sub='Travel';
      if(!d.modes && /^(?:on )?(?:the )?train\b/i.test(block.note || ''))d.modes=['Train'];
      if(!d.modes && /^uber$/i.test((block.note || '').trim()))d.modes=['Taxi'];
      const destination=(block.note || '').match(/^to\s+([\p{L}][\p{L}\s'-]{0,90})$/iu);
      if(destination&&!d.destination)d.destination=destination[1].trim();
    }
    if(category!=='travel')delete d.modes;
    if(category!=='travel'&&category!=='health')delete d.destination;
    if(category!=='work'){delete d.project;delete d.company;}
    if(category==='health' && ['hospital','dentist','opticians'].includes(name) && !d.destination)d.destination=sub==='Appointment'?({hospital:'Hospital',dentist:'Dentist',opticians:'Opticians'}[name]):'';
    if(history && (conflict || ambiguous.has(name)))d.needs_review=true;
    if(history && (category!==originalCategory || sub!==originalActivity)){
      d.original_category=d.original_category || originalCategory;
      d.original_activity=d.original_activity || originalActivity;
    }
    return withDetails({...block,category,sub},d);
  }
  function breakdown(days){
    const projects={},transport={};let travelHours=0;
    for(const day of Object.values(days))for(const [slot,b] of Object.entries(day)){
      if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot)||!b||/^\[GCal\]/.test(b.note || ''))continue;
      if(b.category==='work'){const name=[b.details?.company || 'Company not recorded',b.details?.project || 'Project not recorded'].join(' / ');projects[name]=(projects[name] || 0)+.5;}
      if(b.category==='travel'){travelHours+=.5;const mode=b.details?.modes?.length?b.details.modes.join(' + '):'Mode not recorded';transport[mode]=(transport[mode] || 0)+.5;}
    }
    return {projects,transport,travelHours};
  }
  function companies(value){
    if(value==null)return [];
    if(!Array.isArray(value))throw Error('Invalid company list.');
    const result=[];
    for(const item of value){
      if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>300||!Array.isArray(item.projects))throw Error('Invalid company or project.');
      if(result.some(c=>key(c.name)===key(item.name)))throw Error('Company names must be unique.');
      const projects=[];
      for(const p of item.projects){if(typeof p!=='string'||!p.trim()||p.length>300)throw Error('Invalid project.');if(!projects.some(x=>key(x)===key(p)))projects.push(p.trim());}
      result.push({name:item.name.trim(),projects});
    }
    return result;
  }
  function workError(block,catalog){
    if(block?.category!=='work')return '';
    const d=details(block.details);
    if(!d.company)return 'Choose a company for this work entry.';
    const company=companies(catalog).find(c=>key(c.name)===key(d.company));
    if(!company)return 'Add or select a saved company for this work entry.';
    if(!d.project)return 'Choose a project under '+company.name+'.';
    if(!company.projects.some(p=>key(p)===key(d.project)))return 'Choose a project belonging to '+company.name+'.';
    return '';
  }
  function canonicalWork(block,catalog){
    if(block?.category!=='work')return block;
    const error=workError(block,catalog);if(error)throw Error(error);
    const d=details(block.details),company=companies(catalog).find(c=>key(c.name)===key(d.company));
    d.company=company.name;d.project=company.projects.find(p=>key(p)===key(d.project));delete d.needs_review;
    return withDetails(block,d);
  }
  function describe(block){const d=details(block?.details);return [d.modes?.join(' + '),d.destination,d.company,d.project].filter(Boolean).join(' · ');}
  function title(block){const name=block?.sub || block?.subcategory || (block?.category==='gym'?'Gym':labels[block?.category]) || block?.category || '';return [name,describe(block)].filter(Boolean).join(' · ');}
  const api={version:1,labels,modes,activities,projects,key,details,withDetails,normalize,describe,title,breakdown,companies,workError,canonicalWork};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DayActivity=api;
})(typeof globalThis!=='undefined'?globalThis:this);
