// Reintentos limitados solo para lecturas: nunca duplicar una creación o petición IA.
export async function readWithRateLimitRecovery(read, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const limited = error?.response?.status === 429 || error?.status === 429 || /rate limit exceeded/i.test(error?.message || "");
      if (!limited || attempt >= 2) throw error;
      const retryAfter = Number(error?.response?.headers?.['retry-after']);
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(10000, retryAfter * 1000) : (attempt + 1) * 2000);
    }
  }
}
