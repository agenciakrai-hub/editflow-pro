import React from "react";
import { useSearchParams } from "react-router-dom";
import AlbumsPage from "@/modules/album/pages/AlbumsPage";
import AlbumEditorPage from "@/modules/album/pages/AlbumEditorPage";
import SelectionAIPage from "@/modules/album/selection/SelectionAIPage";

// Switcher del módulo Album AI. Mantiene UNA sola ruta en App.jsx (patrón ?project=).
export default function AlbumApp() {
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const view = params.get("view");
  if (projectId && view === "seleccion") return <SelectionAIPage projectId={projectId} />;
  return projectId ? <AlbumEditorPage projectId={projectId} /> : <AlbumsPage />;
}