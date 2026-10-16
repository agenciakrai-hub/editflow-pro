// Retry completed invalid comparisons and explicit transient service errors only.
export function transientSelectionFailure(data) {
 const groups=Object.values(data?.groups || {});
 return groups.length>0 && groups.every(group=>{
   const m=group?._meta || {},message=String(m.error || m.failover_reason || "");
   return m.fallback && !/quota|credit|billing|payment|insufficient|cuota|saldo/i.test(message) &&
     (m.failure_kind==="invalid_comparison" || [500,502,503,504].includes(Number(m.http_status)));
 });
}
export async function invokeSelectionWithRecovery(invoke,payload,{shouldCancel=()=>false,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
 let response;
 for(let attempt=0;attempt<3;attempt++){
   if(shouldCancel())return null;
   response=await invoke(payload); // thrown timeout is ambiguous: never retry it here
   if(!transientSelectionFailure(response?.data) || attempt===2)return response;
   for(let remaining=attempt===0?5000:15000;remaining>0;remaining-=500){
     if(shouldCancel())return null;await wait(Math.min(500,remaining));
   }
 }
 return response;
}

