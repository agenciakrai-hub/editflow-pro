import { useCallback, useEffect, useRef, useState } from "react";

// Historial de deshacer/rehacer por instantáneas (snapshots), reutilizable en toda
// la app. El componente decide qué es un «paso»: llama a record() justo ANTES de
// cada acción que deba poder revertirse; undo()/redo() vuelven al estado previo.
//
// Atajos globales: ⌘/Ctrl+Z deshace, ⌘/Ctrl+Y (o ⌘/Ctrl+Shift+Z) rehace. No actúan
// mientras se escribe en un input/textarea.
export default function useUndoRedo({ getSnapshot, applySnapshot, max = 60 }) {
  const ref = useRef({ past: [], future: [] });
  const [, bump] = useState(0);

  const record = useCallback(() => {
    const h = ref.current;
    h.past = [...h.past.slice(1 - max), getSnapshot()];
    h.future = [];
    bump((n) => n + 1);
  }, [getSnapshot, max]);

  const reset = useCallback(() => {
    ref.current = { past: [], future: [] };
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const h = ref.current;
    if (!h.past.length) return;
    const snap = getSnapshot();
    applySnapshot(h.past[h.past.length - 1]);
    h.past = h.past.slice(0, -1);
    h.future = [snap, ...h.future];
    bump((n) => n + 1);
  }, [getSnapshot, applySnapshot]);

  const redo = useCallback(() => {
    const h = ref.current;
    if (!h.future.length) return;
    const snap = getSnapshot();
    applySnapshot(h.future[0]);
    h.future = h.future.slice(1);
    h.past = [...h.past, snap];
    bump((n) => n + 1);
  }, [getSnapshot, applySnapshot]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    record,
    reset,
    undo,
    redo,
    canUndo: ref.current.past.length > 0,
    canRedo: ref.current.future.length > 0,
  };
}