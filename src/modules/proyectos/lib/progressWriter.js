// Una escritura activa y una actualización pendiente, que siempre es la más reciente.
export function createProgressWriter(write, { intervalMs = 1000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let active = null, pending = null, reserved = null, lastWrite = 0;
  return function report(progress, phase, status = "processing") {
    if (reserved && status === reserved.status && phase === reserved.phase && Math.abs(progress - reserved.progress) < 4) return active || Promise.resolve();
    reserved = { progress, phase, status };
    pending = reserved;
    if (!active) active = (async () => {
      while (pending) {
        const delay = Math.max(0, intervalMs - (Date.now() - lastWrite));
        if (delay) await wait(delay);
        const next = pending;
        pending = null;
        lastWrite = Date.now();
        await write(next);
      }
    })().finally(() => { active = null; });
    return active;
  };
}
