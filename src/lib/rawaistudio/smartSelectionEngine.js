import { applyBurstSelectionPolicy } from "./selectionPolicy";
// RAW AI Studio — pipeline de CULLING profesional (multicapa, local-first).
//
// INGEST → PASS 1 (fast cull cliente: integridad + métricas + EXIF captura + pHash)
// → AGRUPACIÓN por escena (tiempo de captura + similitud visual)
// → PASS 2 (deep cull IA: análisis comparativo por grupo, scoring multidimensional,
//    pesos por género, estados comparativos) con concurrencia controlada
// → DECISIÓN (estados + confianza, conservadora, sin descarte por una sola métrica)
// → DEDUP entre grupos (casi-duplicados en seleccionados de grupos distintos)
// → ADAPTADOR compatible con el Editor.
//
// PRIORIDAD: PRECISIÓN > CONSERVACIÓN > RANKING > ESTABILIDAD > VELOCIDAD.
// Los RAW nunca se suben: solo su preview JPEG embebida (decodificada en el navegador)
// se envía a la IA de selección. Se envía el grupo COMPLETO a la IA (sin truncar por
// sharpness/exposure); el backend parte grupos >12 en dos llamadas comparativas.
import { base44 } from "@/api/base44Client";
import { extractRawPreview, placeholderPreview } from "./rawPreviewReader";
import { groupIntoScenes } from "./groupIntoScenes";
import { runPool } from "./promisePool";
import { computePHash } from "./perceptualHash";
import { readCaptureTimeFromBytes } from "./captureTime";
import { readCameraMetadataFromBytes, readAsShotWhiteBalance } from "./cameraMetadata";
import { analyzeSkinTone } from "./skinToneAnalysis";
import { decodePreviewImage } from "./previewDecodeCache";
import { prepareSelectionPreview } from "./selectionPreviewValidation";
import { invokeSelectionWithRecovery } from "./selectionServiceRecovery";

// Concurrencia aumentada para acelerar el culling: más previews en paralelo (importación)
// y más ráfagas analizadas simultáneamente (selección IA). Los VLM modernos y el backend
// toleran esta carga sin degradar la precisión.
const PREVIEW_CONCURRENCY = 10;
const BATCH_CONCURRENCY = 1;

// Umbral MUY estricto para considerar dos seleccionados de grupos distintos como
// casi-duplicados (mu más bajo que el de agrupación). Solo se fusionan los
// verdaderamente idénticos: si el momento/expresión/composición difieren, la
// distancia pHash será mayor y NO se fusionan.
const DEDUP_PHASH_THRESHOLD = 4;

export const STATUSES = ["TOP_PICK", "SELECT", "REVIEW", "REJECT"];

// Métrica técnica pura (solo para fallback y ordenar dentro de un grupo cuando la IA
// falla). NO es la puntuación final: el ranking lo decide la IA comparando el grupo.
export function scoreOf(p) {
  const sharp = p.preview?.sharpness ?? 0;
  const exp = p.preview?.exposureScore ?? 0.5;
  return sharp * 0.6 + exp * 0.4;
}

// items: [{id, file}] -> [{id, file, preview, captureTime, phash, cameraInfo, technical}]
// PASS 1: lee el buffer UNA vez y reutiliza para preview + EXIF + cámara + pHash.
export async function extractPreviews(items, onProgress, onTiming) {
  let done = 0;
  return runPool(items, PREVIEW_CONCURRENCY, async (item) => {
    const extractionStart = performance.now();
    let bytes = null;
    try { bytes = new Uint8Array(await item.file.arrayBuffer()); } catch { bytes = null; }
    let preview;
    try { preview = await extractRawPreview(item.file, 800, { bytes: bytes || undefined, hiResMaxEdge: 2400 }); }
    catch { preview = placeholderPreview(); }

    if (preview?.base64 && !preview.isPlaceholder) {
      try { preview.decodedSource = await decodePreviewImage(preview.base64); } catch {}
    }
    const phash = preview?.dataUrl ? await computePHash(preview.dataUrl, preview.decodedSource) : null;
    let captureTime = null, focal = null, aperture = null, iso = null;
    let cameraInfo = null;
    let asShotWB = null;
    if (bytes) {
      try { const t = readCaptureTimeFromBytes(bytes); ({ captureTime, focal, aperture, iso } = t); } catch {}
      try { cameraInfo = readCameraMetadataFromBytes(bytes); } catch {}
      try { asShotWB = readAsShotWhiteBalance(bytes); } catch {}
    }
    const extractionMs = performance.now() - extractionStart;
    let skinStats = null;
    let skinMs = 0;
    if (preview?.base64 && !preview.isPlaceholder) {
      const skinStart = performance.now();
      try { skinStats = await analyzeSkinTone(preview.base64, preview.decodedSource); } catch { skinStats = null; }
      skinMs = performance.now() - skinStart;
    }
    onTiming?.({ extractionMs, skinMs });

    const corrupt = !preview || preview.isPlaceholder;
    const technical = {
      sharpness: preview?.sharpness ?? 0,
      exposureScore: preview?.exposureScore ?? 0.5,
      avgLuminance: preview?.histogram?.avgLuminance ?? null,
      captureTime, focal, aperture, iso,
      corrupt,
    };

    return { ...item, preview, phash, captureTime, cameraInfo, technical, asShotWB, skinStats };
  }, () => { done += 1; onProgress?.(done); });
}

// withPreview -> { keep: Set<id>, meta: Map<id, {...}> }
export async function runAiBurstSelection(withPreview, onProgress, {shouldCancel=()=>false,onBatch}={}) {
 const trace={started_at:new Date().toISOString(),started_ms:Date.now(),photo_count:withPreview.length,stages:{},bursts:[],decision_contract:"burst-winner-v2"};
 const keep=new Set(),meta=new Map(),deferredErrors=[];
 const planned=withPreview.every(p=>p.selectionBurstId);
 let groups;
 if(planned){
   const map=new Map();
   for(const p of withPreview){if(!map.has(p.selectionBurstId))map.set(p.selectionBurstId,{id:p.selectionBurstId,files:[]});map.get(p.selectionBurstId).files.push(p);}
   groups=[...map.values()];
 } else groups=groupIntoScenes(withPreview);
 trace.stages.grouping={scene_count:groups.length,real_bursts:groups.filter(g=>g.files.length>1).length,singletons:groups.filter(g=>g.files.length===1).length};
 let done=0,consecutiveFailures=0;
 for(const group of groups){
   if(shouldCancel())return {keep,meta,trace,canceled:true};
   let result, lastMeta={};
   const start=Date.now();
   try {
     for(const photo of group.files){
       const prepared=await prepareSelectionPreview(photo.preview,photo.file,extractRawPreview);
       if(!prepared) {
         const error=new Error(`Vista previa ilegible: ${photo.file?.name || photo.id}. Usa «Reparar vistas previas».`);
         error.selectionDiagnostics={failure_stage:"preview_preflight",unreadable_count:1};
         throw error;
       }
       photo.preview=prepared;
     }
     const byId=new Map(group.files.map(p=>[String(p.id),p]));
     let candidates=[...byId.keys()];
     if(candidates.length!==group.files.length)throw new Error("Identidades duplicadas en la ráfaga");
     // Transport at most eight previews per request. Intermediate winners are NOT saved.
     do {
       const next=[];
       for(let offset=0;offset<candidates.length;offset+=8){
         if(shouldCancel())return {keep,meta,trace,canceled:true};
         const ids=candidates.slice(offset,offset+8);
         const response=await invokeSelectionWithRecovery(payload=>base44.functions.invoke("rawAiSmartSelect",payload),{
           decision_contract:"burst-winner-v2",
           bursts:[{burst_id:group.id,photos:ids.map(id=>({id,preview_base64:byId.get(id).preview.base64}))}]
         },{shouldCancel});
         const g=response?.data?.groups?.[group.id];
         lastMeta=g?._meta || {};
         const compared=g?.comparisons?.flatMap(round=>round.compared_ids) || [];
         if(!g || lastMeta.fallback || g.decision_contract!=="burst-winner-v2" ||
             !ids.includes(g.winner_id) || g.keep_ids?.length!==1 || g.keep_ids[0]!==g.winner_id ||
             compared.length!==ids.length || new Set(compared).size!==ids.length || ids.some(id=>!compared.includes(id))) {
           throw new Error(lastMeta.error || "El proveedor no devolvió una comparación completa y una única ganadora");
         }
         next.push(g.winner_id);result=g;
       }
       candidates=next;
     }while(candidates.length>1);
     if(shouldCancel())return {keep,meta,trace,canceled:true};
     const winner=candidates[0];
     const batchMeta=new Map(group.files.map(p=>[p.id,{
       groupId:group.id,groupSize:group.files.length,status:String(p.id)===winner?"TOP_PICK":"REVIEW",
       groupRank:String(p.id)===winner?1:2,scores:null,confidence:null,confidenceTier:"COMPARATIVE_WINNER",
       reason:result.reason,category_note:String(p.id)===winner?result.reason:"Alternativa de la misma ráfaga",
       analysisComplete:true,comparisonComplete:true,missingDimensions:[],rejectReasons:[],
       comparedWith:group.files.filter(other=>other.id!==p.id).map(other=>other.id),complementary:false,
     }]));
     const batchKeep=new Set();applyBurstSelectionPolicy(batchKeep,batchMeta,group.files);
     // A whole burst is committed only after its final comparison succeeds.
     await onBatch?.({keep:batchKeep,meta:batchMeta});
     for(const id of batchKeep)keep.add(id);
     for(const [id,m]of batchMeta)meta.set(id,m);
     done+=group.files.length;consecutiveFailures=0;onProgress?.(done,withPreview.length);
     trace.bursts.push({burst_id:group.id,photo_count:group.files.length,winner_id:winner,provider:lastMeta.provider,model:lastMeta.model,duration_ms:Date.now()-start,fallback:false});
   }catch(error){
     if(shouldCancel())return {keep,meta,trace,canceled:true};
     error.selectionDiagnostics={...error.selectionDiagnostics,provider_used:lastMeta.provider,model_used:lastMeta.model,http_status:lastMeta.http_status,
       burst_id:group.id,burst_size:group.files.length,failure_kind:lastMeta.failure_kind || "burst_comparison",pending_photo_ids:group.files.map(p=>p.id)};
     deferredErrors.push(error);consecutiveFailures++;
     trace.bursts.push({burst_id:group.id,photo_count:group.files.length,fallback:true,error:error.message});
     // A sustained rate limit affects the provider: do not send other bursts into it.
     if(Number(lastMeta.http_status)===429) {
       error.message="El proveedor sigue limitando las peticiones tras las pausas de recuperación. Resultados guardados conservados; continúa más tarde. "+error.message;
       throw error;
     }
     // Keep isolated bad bursts pending, but stop a systemic outage.
     if(consecutiveFailures>=3) {error.message="Tres ráfagas consecutivas no se pudieron comparar. Resultados anteriores conservados. "+error.message;throw error;}
   }
 }
 trace.ended_ms=Date.now();trace.total_duration_ms=trace.ended_ms-trace.started_ms;
 trace.result={kept:keep.size,processed:meta.size,pending:withPreview.length-meta.size};
 return {keep,meta,trace,deferred_errors:deferredErrors,selection_fallback:false};
}

// ADAPTADOR: produce la forma que el Editor espera (aiSelected, selectedForEdit,
// colorLabel, rating, groupId, reason, overallScore) + campos extra del culling
// (status, scores, rejectReasons, confidence, category, groupRank, analysisComplete,
// missingDimensions) que el Editor ignora pero la UI de revisión y el XMP usan.
// Mantiene el contrato del Editor.
const STATUS_COLOR = { TOP_PICK: "green", SELECT: "green", REVIEW: "yellow", REJECT: "red" };
const STATUS_RATING = { TOP_PICK: 5, SELECT: 5, REVIEW: 3, REJECT: 0 };

export function buildPhotoFromSelection(p, keep, meta) {
  const m = meta.get(p.id) || {};
  const status = m.status || (keep.has(p.id) ? "SELECT" : "REVIEW");
  const selected = status === "SELECT" || status === "TOP_PICK";
  return {
    id: p.id, file: p.file, preview: p.preview, manualRotation: 0,
    aiSelected: selected, selectedForEdit: selected,
    colorLabel: STATUS_COLOR[status] || "none",
    rating: STATUS_RATING[status] ?? 0,
    groupId: m.groupId || null, groupSize: m.groupSize || 1,
    complementary: !!m.complementary, reason: m.reason || null,
    overallScore: m.scores?.overall ?? 0,
    status,
    scores: m.scores || null,
    rejectReasons: m.rejectReasons || [],
    confidence: m.confidence ?? null,
    category: m.category || null,
    groupRank: m.groupRank ?? null,
    captureTime: p.captureTime ?? null,
    cameraInfo: p.cameraInfo || null,
    asShotWB: p.asShotWB || null,
    skinStats: p.skinStats || null,
    confidenceTier: m.confidenceTier || "UNCERTAIN_REVIEW",
    comparedWith: m.comparedWith || [],
    analysisComplete: m.analysisComplete ?? false,
    missingDimensions: m.missingDimensions || [],
    previewWarning: m.previewWarning || false,
    selectionFallback: !!m.selection_fallback,
    fallbackReason: m.fallback_reason || null,
  };
}