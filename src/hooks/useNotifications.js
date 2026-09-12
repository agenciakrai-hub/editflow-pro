// Hook de notificaciones de trabajos en segundo plano.
//
// Sondea cada 4s las entidades de trabajos (ProjectProcessingJob, AlbumAISelection,
// ExportJob) y detecta transiciones de "activo" → "finalizado". Cuando un trabajo
// termina (completed/failed/canceled), genera una notificación persistente
// (localStorage) y dispara un toast en tiempo real.
//
// La campana (NotificationBell) usa este hook para mostrar:
//   - badge con trabajos activos O notificaciones no leídas
//   - dropdown con el historial de notificaciones
//
// Así, aunque el usuario navegue fuera de la página donde empezó el procesado,
// la campana le avisa cuando termina.

import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

const STORAGE_KEY = "editflow_notifications_v1";
const ACTIVE_STATUSES = ["processing", "pending", "running"];
const POLL_MS = 4000;
const MAX_NOTIFICATIONS = 50;

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(notifs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs.slice(0, MAX_NOTIFICATIONS)));
  } catch {}
}

function buildNotification(job, type) {
  const typeLabel =
    type === "processing" ? "Procesado de proyecto" :
    type === "selection" ? "Selección IA" :
    "Exportación";

  const succeeded = job.status === "completed";
  const failed = job.status === "failed" || job.status === "canceled";

  let title;
  let description;

  if (succeeded) {
    title = `${typeLabel} completado`;
    if (type === "processing") {
      description = `Proyecto ${job.project_id?.slice(-6) || ""}`;
    } else if (type === "selection") {
      description = `${job.stats?.photo_count || 0} fotos analizadas`;
    } else {
      description = `${job.photo_count || 0} fotos · ${(job.format || "xmp").toUpperCase()}`;
    }
  } else {
    title = `Error en ${typeLabel.toLowerCase()}`;
    description = job.error ? String(job.error).slice(0, 120) : "El trabajo fue cancelado o falló";
  }

  return {
    id: `${job.id}-${Date.now()}`,
    jobId: job.id,
    projectId: job.project_id || null,
    type,
    status: job.status,
    title,
    description,
    timestamp: Date.now(),
    read: false,
  };
}

export function useNotifications() {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState(loadFromStorage);
  const [activeCount, setActiveCount] = useState(0);
  const prevJobsRef = useRef(new Map());

  const loadJobs = useCallback(async () => {
    try {
      const [pp, sel, ex] = await Promise.all([
        base44.entities.ProjectProcessingJob.list("-updated_date", 50).catch(() => []),
        base44.entities.AlbumAISelection.list("-updated_date", 50).catch(() => []),
        base44.entities.ExportJob.list("-updated_date", 50).catch(() => []),
      ]);

      const allJobs = [
        ...(pp || []).map((j) => ({ ...j, _type: "processing" })),
        ...(sel || []).map((j) => ({ ...j, _type: "selection" })),
        ...(ex || []).map((j) => ({ ...j, _type: "exports" })),
      ];

      const prev = prevJobsRef.current;
      const newNotifs = [];

      for (const job of allJobs) {
        const prevStatus = prev.get(job.id);
        // Detecta transición: estaba activo → ahora terminó
        if (prevStatus && ACTIVE_STATUSES.includes(prevStatus) && !ACTIVE_STATUSES.includes(job.status)) {
          newNotifs.push(buildNotification(job, job._type));
        }
        prev.set(job.id, job.status);
      }

      if (newNotifs.length) {
        setNotifications((prevNotifs) => {
          const updated = [...newNotifs, ...prevNotifs].slice(0, MAX_NOTIFICATIONS);
          saveToStorage(updated);
          return updated;
        });
        for (const n of newNotifs) {
          toast({
            title: n.title,
            description: n.description,
            variant: n.status === "completed" ? "default" : "destructive",
          });
        }
      }

      const active = allJobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
      setActiveCount(active);
    } catch {
      // Fallo silencioso: no romper la UI si la API no responde
    }
  }, [toast]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, POLL_MS);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  // Badge: mientras hay trabajos activos muestra ese contador; cuando terminan,
  // muestra las notificaciones no leídas.
  const badgeCount = activeCount > 0 ? activeCount : unreadCount;

  const markAsRead = useCallback((id) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveToStorage([]);
  }, []);

  return { notifications, activeCount, unreadCount, badgeCount, markAsRead, markAllRead, clearAll };
}