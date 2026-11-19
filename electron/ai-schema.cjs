const { formats } = require('./home-structured.cjs');
const str = {type:'string'}, optionalString = {type:['string','null']}, optionalInteger = {type:['integer','null']};
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array = items => ({type:'array',items});
const ganttChange = object({
  action:{type:'string',enum:['add','update','remove']}, taskNumber:optionalInteger,
  title:optionalString, notes:optionalString, start:optionalString, end:optionalString,
  progress:optionalInteger, milestone:{type:['boolean','null']}, parentNumber:optionalInteger,
  predecessorNumbers:{type:['array','null'],items:{type:'integer'}}, color:optionalString,
});
const HOME_TOOLS = {
  list_files:{}, search_files:{query:str}, read_file:{path:str,offset:optionalInteger,length:optionalInteger},
  read_gantt:{path:str,offset:optionalInteger}, edit_gantt:{path:str,revision:str,changes:array(ganttChange)},
  file_relations:{path:str}, analyze_data:{path:str}, list_task_lists:{}, list_tasks:{listId:str}, read_agenda:{offset:optionalInteger},
  create_file:{path:str,content:str}, update_file:{path:str,revision:str,content:str}, link_files:{path:str,target:str},
  create_structured_file:{path:str,format:{type:'string',enum:formats},data:optionalString},
  create_task_list:{title:str}, create_task:{listId:str,title:str,notes:optionalString,due:optionalString,parentId:optionalString},
  link_task:{path:str,listId:str,taskId:str},
};
const HOME_RESPONSE_SCHEMA = object({
  kind:{type:'string',enum:['question','step','done']},text:optionalString,plan:array(str),
  actions:array({anyOf:Object.entries(HOME_TOOLS).map(([tool,args])=>object({tool:{type:'string',enum:[tool]},label:str,args:object(args)}))}),
});
const NOTE_RESPONSE_SCHEMA = object({
  kind:{type:'string',enum:['answer','edit','tasks']},text:optionalString,
  tasks:array(object({title:str,notes:optionalString,due:optionalString,parentTitle:optionalString})),
});
function validateResult(value,schema) {
  if(schema.anyOf)return schema.anyOf.some(option=>validateResult(value,option));
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const type=value===null?'null':Array.isArray(value)?'array':typeof value==='number'&&Number.isInteger(value)?'integer':typeof value;
  if(!types.includes(type)&&!(type==='integer'&&types.includes('number')))return false;
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(type==='object'){
    if((schema.required||[]).some(key=>!Object.hasOwn(value,key)))return false;
    if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties||{},key)))return false;
    return Object.entries(schema.properties||{}).every(([key,property])=>!Object.hasOwn(value,key)||validateResult(value[key],property));
  }
  if(type==='array')return value.every(item=>validateResult(item,schema.items));
  return true;
}
module.exports={HOME_RESPONSE_SCHEMA,NOTE_RESPONSE_SCHEMA,validateResult};
