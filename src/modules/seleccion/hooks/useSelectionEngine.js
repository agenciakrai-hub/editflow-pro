// Hook that drives the smart selection engine for a project.
// Self-contained to the seleccion module: only imports its own utils + base44.
import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { groupByBursts } from "../utils/burstGrouping.js";
import { analyzeBatch, buildSelectionPlan } from "../utils/smartSelectionEngine.js";
import { extractEmbeddedPreview, isRawFile } from "../utils/rawPreviewReader.js";

export function useSelectionEngine() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    base44.entities.Project.list("-updated_date", 20).then((p) => {
      setProjects(p);
      if (p[0]) loadPhotos(p[0].id, p[0]);
      else setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const loadPhotos = useCallback((projectId, project) => {
    setLoading(true);
    base44.entities.Photo.filter({ project_id: projectId }).then((ph) => {
      setPhotos(ph);
      setSelectedProject(project ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const runAI = async () => {
    if (!photos.length) return;
    setRunning(true);
    setProgress({ done: 0, total: photos.length });
    const analyzed = [];
    for (let i = 0; i < photos.length; i++) {
      const res = await analyzeBatch([photos[i]]);
      analyzed.push(res[0]);
      setProgress({ done: i + 1, total: photos.length });
    }
    const map = new Map(analyzed.map((a) => [a.photo.id, a]));
    const bursts = groupByBursts(photos);
    const plan = buildSelectionPlan(bursts, map);
    await base44.entities.Photo.bulkUpdate(plan);
    setPhotos((prev) => prev.map((p) => {
      const u = plan.find((u) => u.id === p.id);
      return u ? { ...p, ...u } : p;
    }));
    const selectedCount = plan.filter((p) => p.culling_status === "selected").length;
    if (selectedProject) {
      await base44.entities.Project.update(selectedProject.id, { selected_count: selectedCount, status: "selection" });
    }
    setRunning(false);
    return selectedCount;
  };

  const uploadFiles = async (files) => {
    if (!selectedProject || !files.length) return;
    setUploading(true);
    const created = [];
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      created.push({
        project_id: selectedProject.id,
        file_url,
        filename: file.name,
        culling_status: "unreviewed",
        star_rating: 0,
        color_label: "none",
      });
    }
    const records = await base44.entities.Photo.bulkCreate(created);
    setPhotos((prev) => [...records, ...prev]);
    await base44.entities.Project.update(selectedProject.id, {
      photo_count: (selectedProject.photo_count || 0) + records.length,
    });
    setUploading(false);
  };

  return {
    projects, selectedProject, photos, loading, running, progress, uploading,
    setSelectedProject, loadPhotos, runAI, uploadFiles,
    setPhotos,
  };
}