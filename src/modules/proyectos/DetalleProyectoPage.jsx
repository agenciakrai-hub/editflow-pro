import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getProject, getCatalogBinding, listFingerprints, updateCatalogBinding, bulkUpdateFingerprints } from "./hooks/useProjectStore";
import { useFileSync } from "./hooks/useFileSync";
// Solo IMPORTA (no modifica) utilidades del motor de Selección existente.
import { isRawFile, isHiddenOrSystemFile } from "@/lib/rawaistudio/rawPreviewReader";
import { extractPreviews } from "@/lib/rawaistudio/smartSelectionEngine";
import { computeFingerprint, matchFingerprints } from "./lib/projectFingerprint";
import { buildSelectedPhotosArray, loadSelectionIntoSession } from "./lib/recoverSelection";
import SyncStatusCard from "./components/SyncStatusCard";
import ResyncDialog from "./components/ResyncDialog";
import VolverAEditarButton from "./components/VolverAEditarButton";
import { useToast } from "@/components/ui/use-toast";

// Reabre un proyecto: comprueba accesibilidad de carpeta RAW y .lrcat (🟢/🟡/🔴), y si la
// carpeta sigue accesible re-extrae previews y recupera automáticamente la selección
// guardada por fingerprint. Nunca mueve/copia/modifica/sube archivos.
export default function DetalleProyectoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { checking, checkSync, resyncFolder, resyncCatalog } = useFileSync();

  const [project, setProject] = useState(null);
  const [binding, setBinding] = useState(null);
  const [fingerprints, setFingerprints] = useState([]);
  const [sync, setSync] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);

  const recoverFromFolder = async (folderHandle, savedFingerprints) => {
    const raws = [];
    for await (const [name, entryHandle] of folderHandle.entries()) {
      if (entryHandle.kind !== "file") continue;
      if (isHiddenOrSystemFile(name) || !isRawFile(name)) continue;
      raws.push(await entryHandle.getFile());
    }
    const inputItems = raws.map((f, i) => ({ id: String(i), file: f }));
    const withPreview = await extractPreviews(inputItems, () => {}, () => {});
    const withFingerprint = await Promise.all(
      withPreview.map(async (p) => ({
        ...p,
        fingerprint: await computeFingerprint({ file: p.file, preview: p.preview, relativePath: p.file.name }),
      }))
    );
    const candidateList = withFingerprint.map((p) => ({
      id: p.id,
      file: p.file,
      preview: p.preview,
      cameraInfo: p.cameraInfo,
      asShotWB: p.asShotWB,
      skinStats: p.skinStats,
      ...p.fingerprint,
    }));
    // Enriquece candidatos con el identificador de catálogo Lightroom (lr_local_id), si el
    // plugin ya recopiló un snapshot (acción lr-collect-ids). Fuente secundaria: solo ayuda
    // a desambiguar; si no hay snapshot, el flujo sigue funcionando igual que antes.
    try {
      const res = await base44.functions.invoke("editflow-engine", { action: "lr-catalog-ids" });
      const catalogPhotos = res?.data?.photos || [];
      if (catalogPhotos.length) {
        const byFileName = new Map(catalogPhotos.map((p) => [String(p.fileName || "").toLowerCase(), p.localId]));
        candidateList.forEach((c) => {
          const lrId = byFileName.get(String(c.filename || "").toLowerCase());
          if (lrId) c.lr_local_id = lrId;
        });
      }
    } catch {
      // Sin plugin configurado todavía: se ignora, la desambiguación cae a revisión manual.
    }

    const result = matchFingerprints(savedFingerprints, candidateList);
    setMatches(result);

    const flagged = result.filter((r) => r.ambiguous).map((r) => ({ id: r.saved.id, needs_review: true }));
    const lrIdUpdates = result
      .filter((r) => r.matched && r.candidate?.lr_local_id && !r.saved.lr_local_id)
      .map((r) => ({ id: r.saved.id, lr_local_id: r.candidate.lr_local_id }));
    if (flagged.length) await bulkUpdateFingerprints(flagged);
    if (lrIdUpdates.length) await bulkUpdateFingerprints(lrIdUpdates);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [p, b, fps] = await Promise.all([getProject(id), getCatalogBinding(id), listFingerprints(id)]);
    setProject(p);
    setBinding(b);
    setFingerprints(fps);
    if (b) {
      const s = await checkSync(b.catalog_handle_ref, b.raw_folder_handle_ref);
      setSync(s);
      if (s.folderOk && s.folderHandle) await recoverFromFolder(s.folderHandle, fps);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, checkSync]);

  useEffect(() => {
    load();
  }, [load]);

  const doResyncFolder = async () => {
    setResyncing(true);
    try {
      const handle = await resyncFolder(binding.raw_folder_handle_ref);
      await updateCatalogBinding(binding.id, { raw_folder_name: handle.name });
      const s = await checkSync(binding.catalog_handle_ref, binding.raw_folder_handle_ref);
      setSync(s);
      await recoverFromFolder(handle, fingerprints);
      toast({ title: "Carpeta RAW re-sincronizada" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo re-sincronizar", description: e?.message, variant: "destructive" });
    }
    setResyncing(false);
  };

  const doResyncCatalog = async () => {
    setResyncing(true);
    try {
      const handle = await resyncCatalog(binding.catalog_handle_ref);
      await updateCatalogBinding(binding.id, { catalog_filename: handle.name });
      const s = await checkSync(binding.catalog_handle_ref, binding.raw_folder_handle_ref);
      setSync(s);
      toast({ title: "Catálogo re-sincronizado" });
    } catch (e) {
      if (e?.name !== "AbortError") toast({ title: "No se pudo re-sincronizar", description: e?.message, variant: "destructive" });
    }
    setResyncing(false);
  };

  const volverAEditar = () => {
    const selected = buildSelectedPhotosArray(matches);
    if (!selected.length) {
      toast({ title: "Sin fotos recuperadas", description: "Re-sincroniza la carpeta RAW primero", variant: "destructive" });
      return;
    }
    loadSelectionIntoSession(selected);
    navigate("/ajustes-ia");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando proyecto…
      </div>
    );
  }

  if (!project) {
    return <p className="text-sm text-muted-foreground">Proyecto no encontrado.</p>;
  }

  const selectedCount =
    matches.filter((m) => m.matched && (m.saved.selection_status === "TOP_PICK" || m.saved.selection_status === "SELECT")).length ||
    fingerprints.filter((f) => f.selection_status === "TOP_PICK" || f.selection_status === "SELECT").length;
  const ambiguousCount = matches.filter((m) => m.ambiguous).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.event_date || "Sin fecha"} · {fingerprints.length} fotos · {selectedCount} seleccionadas
          </p>
        </div>
        <button
          onClick={() => navigate("/proyectos")}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Mis proyectos
        </button>
      </div>

      {binding && sync && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SyncStatusCard
            title="Carpeta RAW"
            status={sync.folderOk ? "synced" : sync.catalogOk ? "partial" : "missing"}
            message={
              !sync.folderOk
                ? "La carpeta de fotografías ha cambiado de ubicación. Selecciona la nueva carpeta para volver a sincronizar."
                : binding.raw_folder_name
            }
          />
          <SyncStatusCard
            title="Catálogo Lightroom"
            status={sync.catalogOk ? "synced" : sync.folderOk ? "partial" : "missing"}
            message={
              !sync.catalogOk
                ? "El catálogo de Lightroom ha cambiado de ubicación. Selecciona el nuevo catálogo para volver a sincronizar."
                : binding.catalog_filename || "No asociado"
            }
          />
        </div>
      )}

      {binding && !sync?.folderOk && (
        <ResyncDialog
          message="La carpeta de fotografías ha cambiado de ubicación. Selecciona la nueva carpeta para volver a sincronizar."
          buttonLabel="Seleccionar nueva carpeta RAW"
          onResync={doResyncFolder}
          loading={resyncing || checking}
        />
      )}

      {binding && binding.catalog_handle_ref && !sync?.catalogOk && (
        <ResyncDialog
          message="El catálogo de Lightroom ha cambiado de ubicación. Selecciona el nuevo catálogo para volver a sincronizar."
          buttonLabel="Seleccionar nuevo catálogo .lrcat"
          onResync={doResyncCatalog}
          loading={resyncing || checking}
        />
      )}

      {ambiguousCount > 0 && (
        <p className="text-xs text-yellow-500">
          {ambiguousCount} foto(s) con emparejamiento ambiguo — marcadas para revisión manual, no se recuperaron automáticamente.
        </p>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <ul className="divide-y divide-border max-h-96 overflow-auto">
          {fingerprints.map((f) => {
            const m = matches.find((mm) => mm.saved.id === f.id);
            const recovered = m?.matched;
            return (
              <li key={f.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="truncate font-mono text-xs text-foreground/80">{f.filename}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {f.selection_status}
                  {sync?.folderOk && (recovered ? " · recuperada" : " · sin recuperar")}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <VolverAEditarButton onClick={volverAEditar} disabled={!sync?.folderOk} count={selectedCount} />
    </div>
  );
}