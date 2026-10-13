export async function albumReadRetry(read, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const status = error?.response?.status ?? error?.status;
      const rateLimited = status === 429 || /rate limit/i.test(error?.message || '');
      if (!rateLimited || attempt >= 2) throw error;
      await wait(1000 * (attempt + 1));
    }
  }
}
export async function readAlbumPages(entity, query, sort) {
  const rows = [], size = 400;
  for (let skip = 0; ; skip += size) {
    const page = await albumReadRetry(() => entity.filter(query, sort, size, skip));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
export async function writeAlbumBatches(entity, method, rows) {
  const result = [];
  for (let offset = 0; offset < rows.length; offset += 400) {
    result.push(...await entity[method](rows.slice(offset, offset + 400)));
  }
  return result;
}
