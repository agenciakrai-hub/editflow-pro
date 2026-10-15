// Retry only explicit, completed provider failures. Never retry an ambiguous transport timeout.
export function transientSelectionFailure(data) {
 const groups = Object.values(data?.groups || {});
 return groups.length > 0 && groups.every(group => {
   const meta = group?._meta || {};
   const message = String(meta.error || meta.failover_reason || "");
   return meta.fallback && [500, 502, 503, 504].includes(Number(meta.http_status)) &&
     !/quota|credit|billing|payment|insufficient|cuota|saldo/i.test(message);
 });
}
export async function invokeSelectionWithRecovery(invoke, payload, {shouldCancel = () => false, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
 let response;
 for (let attempt = 0; attempt < 3; attempt++) {
   if (shouldCancel()) return null;
   response = await invoke(payload);
   if (!transientSelectionFailure(response?.data) || attempt === 2) return response;
   // Short intervals permit cancellation while backing off.
   for (let remaining = attempt === 0 ? 5000 : 15000; remaining > 0; remaining -= 500) {
     if (shouldCancel()) return null;
     await wait(Math.min(500, remaining));
   }
 }
 return response;
}
