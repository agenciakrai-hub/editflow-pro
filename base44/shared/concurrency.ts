// Legacy concurrency helper used by the (now dormant) cloud processBatch function.
// Kept as a fallback until the local-agent DevelopEngine flow is fully validated.
export async function runWithConcurrency(items: any[], limit: number, worker: (item: any, index: number) => Promise<any>) {
  const results: any[] = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}