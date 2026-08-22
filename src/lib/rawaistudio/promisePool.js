// RAW AI Studio — ejecutor de tareas con concurrencia limitada en el navegador.
// Usado para paralelizar trabajo independiente (lectura de previews RAW, llamadas a la IA
// por lote) en vez de esperar una tarea a la vez, que es lo que hacía lento el análisis de
// carpetas grandes (miles de fotos).
export async function runPool(items, limit, worker, onItemDone) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    if (onItemDone) onItemDone(results[index], index);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}