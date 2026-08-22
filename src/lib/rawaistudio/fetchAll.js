import { base44 } from "@/api/base44Client";

// Pagina automáticamente filter() para traer TODOS los registros de una consulta
// grande (4000+ fotos). filter() por defecto solo devuelve ~100 registros; sin
// esto, la página del proyecto mostraría solo una fracción de las fotos y la
// descarga perdería las restantes. Recorre páginas de `pageSize` en `pageSize`
// hasta que una página devuelva menos resultados que el tamaño de página.
export async function filterAll(entityName, query, sort = "-created_date", pageSize = 500) {
  const all = [];
  let skip = 0;
  while (true) {
    const batch = await base44.entities[entityName].filter(query, sort, pageSize, skip);
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
  }
  return all;
}