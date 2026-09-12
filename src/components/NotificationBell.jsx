// Campana de notificaciones funcional.
//
// Reemplaza la campana estática del AppLayout. Muestra:
//   - Badge dinámico: trabajos activos en curso O notificaciones no leídas.
//   - Dropdown con el historial de notificaciones (trabajos que terminaron).
//   - Toast automático cuando un trabajo en segundo plano finaliza.
//
// Sondea las entidades de trabajos cada 4s (vía useNotifications) para detectar
// transiciones activo → finalizado, incluso si el usuario navegó fuera de la
// página donde empezó el procesado.

import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Trash2, Cpu, Sparkles, FileImage } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import moment from "moment";

const STATUS_COLOR = {
  completed: "text-emerald-600",
  failed: "text-red-600",
  canceled: "text-zinc-500",
};

const TYPE_META = {
  processing: { Icon: Cpu, path: "/historial" },
  selection: { Icon: Sparkles, path: "/historial" },
  exports: { Icon: FileImage, path: "/historial" },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { notifications, activeCount, badgeCount, markAsRead, markAllRead, clearAll } = useNotifications();

  // Cierra el dropdown al hacer clic fuera.
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleClick = (n) => {
    markAsRead(n.id);
    setOpen(false);
    const meta = TYPE_META[n.type] || TYPE_META.processing;
    navigate(meta.path);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 hover:bg-secondary rounded-lg transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="w-5 h-5" />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[10px] font-bold min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          {/* Cabecera */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold">Notificaciones</span>
            <div className="flex items-center gap-1">
              {notifications.some((n) => !n.read) && (
                <button onClick={markAllRead} className="p-1 hover:bg-secondary rounded" title="Marcar todo leído">
                  <CheckCheck className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll} className="p-1 hover:bg-secondary rounded" title="Borrar todo">
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Banner de trabajos activos */}
          {activeCount > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30">
              <p className="text-xs text-amber-700 dark:text-amber-500 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {activeCount} trabajo{activeCount > 1 ? "s" : ""} en proceso…
              </p>
            </div>
          )}

          {/* Lista de notificaciones */}
          <div className="max-h-96 overflow-y-auto scrollbar-hide">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                <Bell className="mx-auto h-6 w-6 mb-2 opacity-30" />
                No hay notificaciones
              </div>
            ) : (
              notifications.map((n) => {
                const meta = TYPE_META[n.type] || TYPE_META.processing;
                const color = STATUS_COLOR[n.status] || "text-muted-foreground";
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-secondary transition-colors flex gap-3 ${!n.read ? "bg-accent/5" : ""}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <meta.Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{n.description}</p>
                      <p className={`text-[10px] mt-0.5 ${color}`}>{moment(n.timestamp).fromNow()}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Pie */}
          <div className="px-4 py-2 border-t border-border">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/historial");
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1"
            >
              Ver todo en Historial
            </button>
          </div>
        </div>
      )}
    </div>
  );
}