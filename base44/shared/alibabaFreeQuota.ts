// Account-specific free-quota policy verified in Alibaba Singapore on 2026-10-15.
// Free Quota Only must remain enabled in Alibaba. This is trial quota, not unlimited free API.
export const ALIBABA_FREE_MODELS = ['qwen3.8-max'];
export const ALIBABA_FREE_UNTIL = '2026-10-30T16:00:00.000Z'; // Conservative: start of expiry day in Singapore.
export function isAlibaba(endpoint:string) {
 try {const u=new URL(endpoint);return u.protocol==='https:'&&(/^(?:dashscope|dashscope-intl)\.aliyuncs\.com$/.test(u.hostname)||/^ws-[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(u.hostname));}catch{return false;}
}
export function freeQuotaAllowed(rec:any,model:string,now=Date.now()) {
 return rec.free_quota_only===true&&ALIBABA_FREE_MODELS.includes(model)&&
  Array.isArray(rec.free_quota_models)&&rec.free_quota_models.includes(model)&&
  Number.isFinite(Date.parse(rec.free_quota_until))&&now<Math.min(Date.parse(rec.free_quota_until),Date.parse(ALIBABA_FREE_UNTIL));
}
export function assertFreeQuota(rec:any,model:string,now=Date.now()) {
 if(!isAlibaba(rec.endpoint)) return;
 if(!freeQuotaAllowed(rec,model,now)) {const e:any=new Error('Alibaba bloqueado: solo se permite el modelo con cuota gratuita verificada y vigente. Revisa Free Quota Only; no se ha enviado la petición.');e.freeQuotaOnly=true;throw e;}
}
