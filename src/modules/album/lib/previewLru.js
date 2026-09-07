// Fase 3.1 Bloque 4 — LRU en RAM para el nivel "preview" (1000 px). Tamaño acotado:
// con 500/1.000/2.000 fotos la memoria no crece con el catálogo, solo con el trabajo
// activo (huecos visibles del spread actual).
export function createLru(max = 48, onEvict = null) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },
    put(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      if (map.size > max) {
        const k = map.keys().next().value;
        const v = map.get(k);
        map.delete(k);
        if (onEvict) { try { onEvict(v, k); } catch {} }
      }
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}