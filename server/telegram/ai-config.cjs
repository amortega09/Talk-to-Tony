'use strict';
function aiConfig(env=process.env){
  const provider=(env.AI_PROVIDER || (env.OPENAI_API_KEY?'openai':'ollama')).trim();
  if(!['openai','ollama'].includes(provider))throw new Error('Set AI_PROVIDER to openai or ollama');
  return {provider,model:provider==='openai'?(env.OPENAI_MODEL || 'gpt-6-luna').trim():null};
}
function explicitWorkDetails(draft,text,catalog,previous){
  const items=(draft.items || []).filter(i=>i.category==='work');if(items.length!==1)return draft;
  const escaped=name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const has=name=>new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`,'iu').test(text);
  const named=(name,prefix)=>new RegExp(`\\b${prefix}\\s+(?:company\\s+|project\\s+|task\\s+)?${escaped(name)}(?![\\p{L}\\p{N}])`,'iu').test(text);
  const companies=require('../../activity-model').companies(catalog);
  for(const a of draft.actions || [])if(a.type==='work_company_add'&&has(a.company)&&/\b(?:add|create|register)\s+(?:a\s+)?company\b/i.test(text)&&!companies.some(c=>c.name===a.company))companies.push({name:a.company,projects:[]});
  for(const a of draft.actions || [])if(a.type==='work_project_add'&&has(a.project)&&/\b(?:add|create|register|project|task)\b/i.test(text)){const c=companies.find(c=>c.name===a.company);if(c&&!c.projects.includes(a.project))c.projects.push(a.project);}
  const allProjects=[...new Set(companies.flatMap(c=>c.projects))];
  const slash=companies.flatMap(c=>allProjects.filter(p=>new RegExp(`${escaped(c.name)}\\s*[/|]\\s*${escaped(p)}(?![\\p{L}\\p{N}])`,'iu').test(text)).map(project=>({company:c.name,project})));
  const prior=(previous?.items || []).filter(i=>i.category==='work');const old=prior.length===1?prior[0].details || {}:{};
  const negative=/\b(?:not|never|except|without|don't|do not)\s+(?:for|at|company|employer|on|project|task)\b/i.test(text);
  let selected=companies.filter(c=>named(c.name,'(?:for|at|company|employer)'));
  if(!selected.length)selected=companies.filter(c=>text.trim().toLowerCase()===c.name.toLowerCase());
  let projects=allProjects.filter(p=>named(p,'(?:on|project|task)'));
  if(!projects.length)projects=allProjects.filter(p=>text.trim().toLowerCase()===p.toLowerCase());
  const company=negative?'':slash.length===1?slash[0].company:selected.length===1?selected[0].name:selected.length? '':old.company || '';
  const project=negative?'':slash.length===1?slash[0].project:projects.length===1?projects[0]:projects.length?'':old.project || '';
  items[0].details={...items[0].details,...(company?{company}:{company:''}),...(project?{project}:{project:''})};
  return draft;
}
function allowsNull(schema){return schema.type==='null'||schema.type?.includes?.('null')||schema.enum?.includes(null)||schema.anyOf?.some(allowsNull);}
// OpenAI requires every property on the wire. Optional values use null and are
// restored to omission before the original application schema validates them.
function strictSchema(schema){
  const result=structuredClone(schema);
  delete result.uniqueItems;delete result.minLength;delete result.maxLength;
  if('const' in result){result.enum=[result.const];delete result.const;}
  if(result.enum&&!result.type)result.type=[...new Set(result.enum.map(v=>v===null?'null':typeof v))];
  if(result.oneOf){result.anyOf=result.oneOf;delete result.oneOf;}
  if(result.anyOf)result.anyOf=result.anyOf.map(strictSchema);
  if(result.items)result.items=strictSchema(result.items);
  if(result.properties){
    const required=schema.required || [];
    result.properties=Object.fromEntries(Object.entries(result.properties).map(([key,value])=>{
      const field=strictSchema(value);
      if(['date','end_date'].includes(key))field.pattern='^\\d{4}-\\d{2}-\\d{2}$';
      if(['start','end'].includes(key))field.pattern=key==='end'?'^(?:(?:[01]\\d|2[0-3]):(?:00|30)|24:00)$':'^(?:[01]\\d|2[0-3]):(?:00|30)$';
      return [key,required.includes(key)||allowsNull(value)?field:{anyOf:[field,{type:'null'}]}];
    }));
    result.required=Object.keys(result.properties);result.additionalProperties=false;
  }
  return result;
}
function fromWire(value,schema){
  if(value===null)return value;
  const branches=schema.oneOf || schema.anyOf;
  if(branches){const selected=branches.find(s=>s.properties?.type?.const===value?.type||s.properties?.type?.enum?.includes(value?.type)) || branches.find(s=>s.type!== 'null');return selected?fromWire(value,selected):value;}
  if(Array.isArray(value))return value.map(v=>fromWire(v,schema.items || {}));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key,v])=>!(v===null&&schema.properties?.[key]&&!(schema.required || []).includes(key)&&!allowsNull(schema.properties[key]))).map(([key,v])=>[key,fromWire(v,schema.properties?.[key] || {})]));
  return value;
}
function reasoningEffort(text,previous){
  return !previous&&/\bfrom\b.+\b(?:to|until)\b/i.test(text)&&!/\?|\b(?:edit|change|move|correct|update|replace|delete|remove|actually|instead|extend|shorten|rename|copy|repeat|same|what|which|how|read|query|show)\b|\badd\s+(?:a\s+)?(?:company|project|task)\b/i.test(text)?'low':'medium';
}
function openaiRequest(model,instructions,input,schema,effort='medium'){
  return {model,store:false,instructions,input:'Return only the required JSON object.\n'+input,text:{format:{type:'json_schema',name:'diary_plan',strict:true,schema:strictSchema(schema)}},
    ...(/^gpt-(?:5|6)(?:[.-]|$)/.test(model)?{reasoning:{effort}}:{}),max_output_tokens:effort==='low'?4096:8192};
}
function openaiText(result){
  if(result?.status!=='completed')throw new Error('Incomplete model response');
  const parts=(result.output || []).filter(x=>x.type==='message').flatMap(x=>x.content || []);
  if(parts.some(x=>x.type==='refusal'))throw new Error('Model refused the request');
  const text=parts.filter(x=>x.type==='output_text').map(x=>x.text).join('');
  if(!text)throw new Error('Missing model response');return text;
}
module.exports={aiConfig,openaiRequest,openaiText,strictSchema,fromWire,explicitWorkDetails,reasoningEffort};
