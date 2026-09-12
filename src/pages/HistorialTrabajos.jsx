import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Trash2, XCircle, RefreshCw, CheckCircle2, AlertCircle, Clock, Cpu, FileImage, Plug, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";

const STATUS_META = {
  processing: { label: "En proceso", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: Clock },
  pending: { label: "En cola", className: "bg-blue-100 text-blue-700 border-blue-200", Icon: Clock },
  running: { label: "En curso", className: "bg-amber-100 text-amber-700 border-amber-200", Icon: Loader2 },
  canceled: { label: "Cancelado", className: "bg-zinc-100 text-zinc-600 border-zinc-200", Icon: XCircle },
  completed: { label: "Completado", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  failed: { label: "Error", className: "bg-red-100 text-red-700 border-red-200", Icon: AlertCircle },
};

function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.failed;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function Progress({ value }) {
  const v = Math.round(value || 0);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{v}%</span>
    </div>
  );
}

const TABS = [
  { key: "processing", label: "Procesado de proyectos", icon: Cpu },
  { key: "selection", label: "Selección IA", icon: Sparkles },
  { key: "exports", label: "Exportaciones", icon: FileImage },
  { key: "lightroom", label: "Cola Lightroom", icon: Plug },
];

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "active", label: "En proceso / cola" },
  { key: "completed", label: "Completados" },
  { key: "failed", label: "Errores" },
];

function matchesFilter(status, filter) {
  if (filter === "all") return true;
  if (filter === "active") return status === "processing" || status === "pending" || status === "running";
  return status === filter;
}

export default function HistorialTrabajos() {
  const { toast } = useToast();
  const [tab, setTab] = useState("processing");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState(null);
  const [processing, setProcessing] = useState([]);
  const [selectionJobs, setSelectionJobs] = useState([]);
  const [exports_, setExports] = useState([]);
  const [lrJobs, setLrJobs] = useState([]);
  const [lrAllowed, setLrAllowed] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const me = user ?? await base44.auth.me().catch(() => null);
      if (!user && me) setUser(me);
      const [pp, sel, ex] = await Promise.all([
        base44.entities.ProjectProcessingJob.list("-updated_date", 100).catch(() => []),
        base44.entities.AlbumAISelection.list("-updated_date", 100).catch(() => []),
        base44.entities.ExportJob.list("-updated_date", 100).catch(() => []),
      ]);
      setProcessing(pp || []);
      setSelectionJobs(sel || []);
      setExports(ex || []);
      if (me?.role === "admin") {
        const lr = await base44.entities.LrJob.list("-updated_date", 100).catch((e) => {
          setLrAllowed(false);
          return [];
        });
        setLrJobs(lr || []);
        setLrAllowed(true);
      } else {
        setLrJobs([]);
        setLrAllowed(false);
      }
    } catch (e) {
      toast({ title: "No se pudo cargar el historial", description: e?.message, variant: "destructive" });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadAll(); }, []);

  // Auto-actualización en tiempo real: sondea cada 4s mientras haya trabajos activos
  // (procesado, selección o exportación en curso). Cuando todo termina, deja de sondear.
  const hasActive = processing.some((j) => j.status === "processing" || j.status === "pending" || j.status === "running")
    || selectionJobs.some((j) => j.status === "running")
    || exports_.some((j) => j.status === "processing" || j.status === "pending");
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(loadAll, 4000);
    return () => clearInterval(t);
  }, [hasActive, loadAll]);

  // Suscripciones en tiempo real: cualquier cambio en las entidades de trabajos
  // recarga el historial al instante (creación, actualización de progreso, etc.).
  useEffect(() => {
    const reload = () => loadAll();
    const subs = [
      base44.entities.ProjectProcessingJob.subscribe(reload),
      base44.entities.AlbumAISelection.subscribe(reload),
      base44.entities.ExportJob.subscribe(reload),
    ];
    return () => subs.forEach((u) => { try { u(); } catch {} });
  }, [loadAll]);

  const cancelJob = async (job, type) => {
    setBusy(true);
    try {
      if (type === "processing") await base44.entities.ProjectProcessingJob.update(job.id, { status: "failed" });
      else if (type === "selection") await base44.entities.AlbumAISelection.update(job.id, { status: "canceled" });
      else if (type === "exports") await base44.entities.ExportJob.update(job.id, { status: "failed" });
      else { await base44.entities.LrJob.delete(job.id); setLrJobs((p) => p.filter((x) => x.id !== job.id)); toast({ title: "Trabajo eliminado de la cola" }); setBusy(false); return; }
      toast({ title: "Trabajo cancelado" });
      await loadAll();
    } catch (e) {
      toast({ title: "No se pudo cancelar", description: e?.message, variant: "destructive" });
    }
    setBusy(false);
  };

  const deleteJob = async (job, type) => {
    setBusy(true);
    try {
      if (type === "processing") await base44.entities.ProjectProcessingJob.delete(job.id);
      else if (type === "selection") await base44.entities.AlbumAISelection.delete(job.id);
      else if (type === "exports") await base44.entities.ExportJob.delete(job.id);
      else await base44.entities.LrJob.delete(job.id);
      toast({ title: "Trabajo eliminado" });
      await loadAll();
    } catch (e) {
      toast({ title: "No se pudo eliminar", description: e?.message, variant: "destructive" });
    }
    setBusy(false);
  };

  const cancelAll = async (type) => {
    const list = type === "processing" ? processing : type === "selection" ? selectionJobs : type === "exports" ? exports_ : lrJobs;
    const actives = list.filter((j) => j.status === "processing" || j.status === "pending" || j.status === "running");
    if (!actives.length) return;
    setBusy(true);
    try {
      if (type === "lightroom") {
        await base44.entities.LrJob.deleteMany({ status: "pending" });
      } else if (type === "selection") {
        await base44.entities.AlbumAISelection.updateMany({ status: "running" }, { $set: { status: "canceled" } });
      } else {
        const ent = type === "processing" ? base44.entities.ProjectProcessingJob : base44.entities.ExportJob;
        await ent.updateMany({ status: "processing" }, { $set: { status: "failed" } });
      }
      toast({ title: `${actives.length} trabajos cancelados` });
      await loadAll();
    } catch (e) {
      toast({ title: "No se pudieron cancelar", description: e?.message, variant: "destructive" });
    }
    setBusy(false);
  };

  const current = tab === "processing" ? processing : tab === "selection" ? selectionJobs : tab === "exports" ? exports_ : lrJobs;
  const visible = current.filter((j) => matchesFilter(j.status, filter));
  const activeCount = current.filter((j) => j.status === "processing" || j.status === "pending" || j.status === "running").length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <History className="h-4 w-4" /> Historial
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Trabajos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulta el procesado, exportaciones y la cola de Lightroom. Cancela los trabajos activos y elimina los que no quieras mantener en cola.
          </p>
        </div>
        <button onClick={loadAll} disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-40">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setFilter("all"); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f.key ? "bg-accent text-white" : "bg-secondary text-muted-foreground hover:bg-secondary/70"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {activeCount > 0 && (
          <button onClick={() => cancelAll(tab)} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40">
            <XCircle className="h-3.5 w-3.5" /> Cancelar {activeCount} en proceso
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando trabajos…
        </div>
      ) : tab === "lightroom" && !lrAllowed ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          La cola de Lightroom solo está disponible para administradores.
        </div>
      ) : !visible.length ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No hay trabajos con este filtro.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((job) => {
            const isActive = job.status === "processing" || job.status === "pending" || job.status === "running";
            const title =
              tab === "processing" ? `Proyecto ${job.project_id?.slice(-6) || ""}` :
              tab === "selection" ? `Selección IA · ${job.stats?.photo_count || 0} fotos` :
              tab === "exports" ? (job.project_title || `Proyecto ${job.project_id?.slice(-6) || ""}`) :
              (job.filename || "Trabajo Lightroom");
            const sub =
              tab === "processing" ? (job.phase === "fingerprinting" ? "Calculando huellas" : "Leyendo previews") :
              tab === "selection" ? `Etapa ${job.stage || "?"}${job.stats?.provider_used ? ` · ${job.stats.provider_used}` : ""}${job.error ? ` · ${String(job.error).slice(0, 60)}` : ""}` :
              tab === "exports" ? `${job.photo_count || 0} fotos · ${(job.format || "xmp").toUpperCase()}` :
              `Token ${job.token?.slice(-6) || ""}`;
            return (
              <div key={job.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  {tab === "processing" ? <Cpu className="h-4 w-4" /> : tab === "selection" ? <Sparkles className="h-4 w-4" /> : tab === "exports" ? <FileImage className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <Badge status={job.status} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {sub} · {moment(job.updated_date || job.created_date).format("DD/MM HH:mm")}
                  </p>
                  {tab === "processing" && job.status === "processing" && <div className="mt-1.5"><Progress value={job.progress} /></div>}
                </div>
                <div className="flex items-center gap-1.5">
                  {isActive && (
                    <button onClick={() => cancelJob(job, tab)} disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40">
                      <XCircle className="h-3.5 w-3.5" /> Cancelar
                    </button>
                  )}
                  <button onClick={() => deleteJob(job, tab)} disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}