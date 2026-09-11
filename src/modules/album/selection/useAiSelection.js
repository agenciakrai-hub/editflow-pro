// Fase 4.1 Bloques 3, 8 y 10 — estado de la UI: consentimiento explícito (nada
// sale sin él), job con progreso persistido, cancelación, reanudación, revocación
// y overrides del fotógrafo (jerarquía SIEMPRE por encima de la IA).
import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { runAiSelectionPipeline, PipelineCancelled } from "./aiPipeline";

export const CONSENT_TEXT_VERSION = "4.1-es-v1";
export const PROVIDER_CHAIN = ["gemini_paid", "qwen", "nvidia"];

export function useAiSelection(project, photos) {
  const [config, setConfig] = useState(null);
  const [selection, setSelection] = useState(null);
  const [progress, setProgress] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let cfg = (await base44.entities.AlbumAIConfig.list())[0] || null;
        if (!cfg) cfg = await base44.entities.AlbumAIConfig.create({ consent_mode: "per_run", allowed_providers: [], revoked: false });
        const jobs = await base44.entities.AlbumAISelection.filter({ project_id: project.id }, "-created_date", 1);
        if (alive) {
          setConfig(cfg);
          setSelection(jobs?.[0] || null);
        }
      } catch {
        /* config/job no críticos para renderizar */
      }
    })();
    return () => {
      alive = false;
    };
  }, [project.id]);

  const needsConsent = !config || config.revoked === true || config.consent_mode !== "saved";

  const acceptConsent = useCallback(
    async ({ save }) => {
      const patch = {
        consent_mode: save ? "saved" : "per_run",
        consent_saved_at: new Date().toISOString(),
        consent_text_version: CONSENT_TEXT_VERSION,
        revoked: false,
        allowed_providers: config?.allowed_providers || [],
      };
      const updated = config?.id
        ? await base44.entities.AlbumAIConfig.update(config.id, patch)
        : await base44.entities.AlbumAIConfig.create(patch);
      setConfig(updated);
      return { text_version: CONSENT_TEXT_VERSION, mode: patch.consent_mode, at: patch.consent_saved_at };
    },
    [config]
  );

  // REVOCACIÓN: no arranca nada nuevo, cancela lo pendiente, los resultados ya
  // obtenidos permanecen bajo control del usuario (no se borran solos).
  const revoke = useCallback(async () => {
    abortRef.current?.abort();
    if (config?.id) {
      setConfig(await base44.entities.AlbumAIConfig.update(config.id, { revoked: true, consent_mode: "per_run" }));
    }
  }, [config]);

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgress({ stage: "e2", done: 0, total: photos.length });
    let job = null;
    try {
      const reusable = selection && ["running", "canceled", "failed"].includes(selection.status);
      job = reusable
        ? await base44.entities.AlbumAISelection.update(selection.id, { status: "running" })
        : await base44.entities.AlbumAISelection.create({
            project_id: project.id,
            status: "running",
            stage: "e2",
            stage_progress: {},
            stats: { photo_count: photos.length },
            consent: {
              text_version: CONSENT_TEXT_VERSION,
              mode: config?.consent_mode || "per_run",
              at: new Date().toISOString(),
              providers: PROVIDER_CHAIN,
            },
          });
      setSelection(job);
      const [analyses, groups, moments] = await Promise.all([
        base44.entities.AlbumPhotoAnalysis.filter({ project_id: project.id }, "-created_date", 2000).catch(() => []),
        base44.entities.AlbumPhotoGroup.filter({ project_id: project.id }, "group_index", 2000).catch(() => []),
        base44.entities.AlbumMoment.filter({ project_id: project.id }, "order_index", 100).catch(() => []),
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await runAiSelectionPipeline({
        project,
        photos,
        resume: { analyses, groups, moments, selectionId: job.id },
        onProgress: (p) => {
          setProgress(p);
          base44.entities.AlbumAISelection.update(job.id, { stage: p.stage, stage_progress: p }).catch(() => {});
        },
        signal: controller.signal,
      });
      const done = await base44.entities.AlbumAISelection.update(job.id, {
        status: "completed",
        stage: "done",
        stage_progress: { stage: "done", done: 1, total: 1 },
        selection: result.selection,
        funnel_report: { ...(result.funnel_report || {}), coverage: result.coverage },
        stats: {
          photo_count: photos.length,
          provider_used: result.providerUsed,
          selected_count: result.selection.length,
          ...(result.funnelStats || {}),
          completed_at: new Date().toISOString(),
          trace: result.trace || null,
        },
      });
      setSelection(done);
      setProgress(null);
    } catch (e) {
      if (e instanceof PipelineCancelled || e?.cancelled) {
        const cur = await base44.entities.AlbumAISelection.update(job.id, { status: "canceled" }).catch(() => null);
        if (cur) setSelection(cur);
        setProgress(null);
      } else {
        setError(String(e?.response?.data?.error || e?.message || e));
        if (job?.id) {
          const cur = await base44.entities.AlbumAISelection.update(job.id, { status: "failed", error: String(e?.message || e) }).catch(() => null);
          if (cur) setSelection(cur);
        }
        setProgress(null);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [project, photos, selection, config, running]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  // Bloque 10 — overrides: SIEMPRE prevalecen sobre la IA (forced/blocked viajan
  // a E7 como restricciones y jamás se sobrescriben en re-ejecuciones).
  const override = useCallback(
    async (photo, action) => {
      const newState =
        action === "reject" || action === "block" ? "discarded" : action === "recover" ? "considered" : "recommended";
      const newOverride = action === "force_include" ? "forced" : action === "block" ? "blocked" : photo.ai_override || "none";
      const updated = await base44.entities.AlbumPhoto.update(photo.id, { ai_state: newState, ai_override: newOverride });
      await base44.entities.AlbumAIFeedback.create({
        project_id: project.id,
        selection_id: selection?.id || null,
        photo_id: photo.id,
        action,
        previous_value: photo.ai_state || "unreviewed",
        new_value: newState,
      });
      return updated;
    },
    [project.id, selection]
  );

  return { config, needsConsent, selection, progress, running, error, acceptConsent, revoke, start, cancel, override };
}