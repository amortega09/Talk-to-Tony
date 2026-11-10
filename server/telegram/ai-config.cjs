'use strict';
function aiConfig(env=process.env){
  const provider=(env.AI_PROVIDER || (env.OPENAI_API_KEY?'openai':'ollama')).trim();
  if(!['openai','ollama'].includes(provider))throw new Error('Set AI_PROVIDER to openai or ollama');
  return {provider,model:provider==='openai'?(env.OPENAI_MODEL || 'gpt-5-nano').trim():null};
}
function explicitWorkDetails(draft,text,catalog){
  const items=(draft.items || []).filter(i=>i.category==='work');
  if(items.length!==1||/\b(?:not|don't|do not|except|without)\b/i.test(text))return draft;
  const named=(name,prefix)=>new RegExp(`\\b${prefix}\\s+(?:company\\s+|project\\s+|task\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'iu').test(text);
  const matches=require('../../activity-model').companies(catalog).filter(c=>named(c.name,'(?:for|at|company|employer)'));
  if(matches.length!==1)return draft;
  const projects=matches[0].projects.filter(p=>named(p,'(?:on|project|task)'));
  if(projects.length===1)items[0].details={...items[0].details,company:matches[0].name,project:projects[0]};
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
function openaiRequest(model,instructions,input,schema){
  return {model,store:false,instructions,input:'Return only the required JSON object.\n'+input,text:{format:{type:'json_schema',name:'diary_plan',strict:true,schema:strictSchema(schema)}},
    ...(/^gpt-5(?:-|$)/.test(model)?{reasoning:{effort:'medium'}}:{}),max_output_tokens:8192};
}
function openaiText(result){
  if(result?.status!=='completed')throw new Error('Incomplete model response');
  const parts=(result.output || []).filter(x=>x.type==='message').flatMap(x=>x.content || []);
  if(parts.some(x=>x.type==='refusal'))throw new Error('Model refused the request');
  const text=parts.filter(x=>x.type==='output_text').map(x=>x.text).join('');
  if(!text)throw new Error('Missing model response');return text;
}
module.exports={aiConfig,openaiRequest,openaiText,strictSchema,fromWire,explicitWorkDetails};
