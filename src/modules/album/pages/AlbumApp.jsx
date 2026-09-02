import React from "react";
import { useSearchParams } from "react-router-dom";
import AlbumsPage from "@/modules/album/pages/AlbumsPage";
import AlbumEditorPage from "@/modules/album/pages/AlbumEditorPage";

// Switcher del módulo Album AI. Mantiene UNA sola ruta en App.jsx (patrón ?project=).
export default function AlbumApp() {
  const [params] = useSearchParams();
  const projectId = params.get("project");
  return projectId ? <AlbumEditorPage projectId={projectId} /> : <AlbumsPage />;
}