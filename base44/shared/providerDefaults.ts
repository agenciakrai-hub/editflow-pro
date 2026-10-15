import { isAlibaba, freeQuotaAllowed } from './alibabaFreeQuota.ts';
// Preferencias de trabajo, no clasificación de capacidades. El catálogo confirmado
// y la prueba visual siguen siendo obligatorios; nunca se inventan identificadores.
const PREFERENCES = [
 'gemini-3.8-flash','qwen3.8-flash','gemini-3.6-flash','claude-sonnet-5','gemini-3.5-flash-lite',
 'gemma-4-31b-it','gemma-3-12b-it','llama-3.2-11b-vision-instruct','gemma-3-4b-it',
 'nemotron-3-nano-omni-30b-a3b-reasoning','deepseek-v4.1-flash','glm-5.3-flash','kimi-k2.6','llama-3.2-90b-vision-instruct','kimi-k3','gemini-3.1-flash-lite','gemini-2.5-flash',
 'qwen3.8-max','gemini-2.5-pro','gemini-2.5-flash-lite','gemini','krai-gemini','chatgpt-kiko','krai-chatgpt','krai-auto'
];
const SPECIALIZED = /(?:embed|guard|safety|calibration|ising|lyria|tts|transcrib|robotic|realtime|live|parse|deplot|code|reward|detector|audio|image|diffusion|:batch|:free|preview|experimental|(?:^|[-/])exp(?:$|[-/]))/i;
export const TASKS = ['seleccion','ajustes','album','video'];
export function webSession(p: any) {
 try {const u=new URL(p.endpoint);return /\/api\/gateway\/v1\/?$/.test(u.pathname)||u.hostname.endsWith('.hstgr.cloud');}catch{return false;}
}
function priority(id: string) {const stem=id.split('/').at(-1)||id;const i=PREFERENCES.indexOf(stem);return i<0?1000:i;}
export function candidateModels(p: any): string[] {
 const meta=new Map((p.available_models_meta||[]).map((m:any)=>[m.id,m]));
 return [...new Set<string>((p.available_models||[]).map(String))].filter(id=>{
  const m:any=meta.get(id);if(isAlibaba(p.endpoint)&&!freeQuotaAllowed(p,id))return false;return ((isAlibaba(p.endpoint)&&freeQuotaAllowed(p,id))||m?.caps?.vision===true||(!webSession(p)&&m?.probe_status==='error'&&m?.caps?.vision!==false))&&!SPECIALIZED.test(id)&&!id.startsWith('~')&&priority(id)<1000;
 }).sort((a,b)=>priority(a)-priority(b)||a.localeCompare(b));
}
export function healthyModel(p:any,id:string,now=Date.now()) {
 const m=(p.available_models_meta||[]).find((m:any)=>m.id===id);
 const age=now-Date.parse(m?.probed_at||'');
 return m?.caps?.vision===true&&m.probe_status==='ok'&&Number.isFinite(age)&&age>=0&&age<3600000;
}
export function supportsImageCount(id:string,count:number) {
 return count<=1||!/^(?:meta\/)?llama-3\.2-(?:11b|90b)-vision-instruct$/.test(id);
}
export function defaultsPlan(providers:any[],now=Date.now()) {
 const rows=providers.filter(p=>p.enabled!==false).map(p=>{
  const candidates=p.last_ok===true?candidateModels(p):[];
  const usable=webSession(p)?candidates:candidates.filter(id=>healthyModel(p,id,now));
  const models=usable.slice(0,3);
  const patch:any=Object.fromEntries(TASKS.map(t=>[t+'_models',t==='ajustes'?models:models.filter(id=>supportsImageCount(id,2))]));
  // El transporte de edición de fotografía implementado en esta app es KRAI /execute.
  patch.edicion_models=/\/api\/gateway\/v1\/?$/.test(new URL(p.endpoint).pathname)?(p.available_models_meta||[]).filter((m:any)=>m.caps?.image_edit===true&&(p.available_models||[]).includes(m.id)).map((m:any)=>m.id).sort((a:string,b:string)=>(a==='gemini-image'?-1:0)-(b==='gemini-image'?-1:0)||a.localeCompare(b)).slice(0,3):[];
  return {id:p.id,name:p.name,web_session:webSession(p),unavailable:p.last_ok!==true,confirmed_models:models,candidates:candidates.slice(0,9),patch};
 });
 const direct=rows.filter(r=>!r.web_session&&r.patch.seleccion_models.length).sort((a,b)=>{
  const pa=providers.find(p=>p.id===a.id),pb=providers.find(p=>p.id===b.id);
  const rank=(r:any,p:any)=>priority(r.patch.seleccion_models[0])+(p.endpoint.includes('generativelanguage.googleapis.com')?-0.2:0);
  return rank(a,pa)-rank(b,pb);
 });
 const first=direct[0];const config:any={model_defaults_policy:'verified-three-v1'};
 if(first){for(const t of ['seleccion','ajustes','album']){config['active_'+t]='custom:'+first.id;config['active_model_'+t]=first.patch[t+'_models'][0];}
 config.active_video_chain=direct.map(r=>'custom:'+r.id);config.active_model_video=first.patch.video_models[0];}
 return {rows,config,ready:!!first};
}

export const DEFAULT_PROBE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADr0lEQVR4nO3TsQ0AMAzDsPz/dHuGBhPgbi+6d0eofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofQKh/AKH+AYT6BxDqH0CofwCh/gGE+gcQ6h9AqH8Aof4BhPoHEOofjKv31713hAQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApglAANMEIIBpAhDANAEIYJoABDBNAAKYJgABTBOAAKYJQADTBCCAaQIQwDQBCGCaAAQwTQACmCYAAUwTgACmCUAA0wQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApglAANMEIIBpAhDANAEIYJoABDBNAAKYJgABTBOAAKYJQADTBCCAaQIQwDQBCGCaAAQwTQACmCYAAUwTgACmCUAA0wQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApglAANMEIIBpAhDANAEIYJoABDBNAAKYJgABTBOAAKYJQADTBCCAaQIQwDQBCGCaAAQwTQACmCYAAUwTgACmCUAA0wQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApglAANMEIIBpAhDANAEIYJoABDBNAAKYJgABTBOAAKYJQADTBCCAaQIQwDQBCGCaAAQwTQACmCYAAUwTgACmCUAA0wQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApglAANMEIIBpAhDANAEIYJoABDBNAAKYJgABTBOAAKYJQADTBCCAaQIQwDQBCGCaAAQwTQACmCYAAUwTgACmCUAA0wQggGkCEMA0AQhgmgAEME0AApgmAAFME4AApn2J4NKjH7VvkAAAAABJRU5ErkJggg==";
export function validProbeAnswer(text:string): boolean {
 try {
  const clean=text.replace(/```(?:json)?/g,'').trim();
  const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
  if(start<0||end<=start) return false;
  const value=JSON.parse(clean.slice(start,end+1));
  const positions=Object.fromEntries(Object.entries(value).map(([k,v])=>[k.toLowerCase().replace(/[^a-z]/g,''),String(v).trim().toLowerCase()]));
  const values=['topleft','topright','bottomleft','bottomright'].map(k=>positions[k]);
  return values.every((v,i)=>[['red','#ff0000'],['green','lime','lime green','#00ff00'],['blue','#0000ff'],['yellow','#ffff00']][i].includes(v));
 }catch{return false;}
}
export function recentSelection(job:any,now=Date.now()) {
 const raw=String(job.updated_date||job.created_date||'');
 const time=Date.parse(raw&&!/(Z|[+-]\d\d:\d\d)$/.test(raw)?raw+'Z':raw);
 return !Number.isFinite(time)||now-time<30*60*1000;
}
