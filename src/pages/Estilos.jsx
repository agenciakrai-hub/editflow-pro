// Creador de estilos — herramienta independiente para aprender el look de un fotógrafo
// desde una galería pública y guardarlo como PhotographerStyleProfile. El perfil aporta
// solo la capa creativa al pipeline de AjustesIA; los básicos y el WB siguen por foto.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Palette } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import NewStyleForm from "@/components/styleStudio/NewStyleForm";
import StyleList from "@/components/styleStudio/StyleList";
import StyleProfileView from "@/components/styleStudio/StyleProfileView";

export default function Estilos() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [styles, setStyles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await base44.entities.PhotographerStyleProfile.list("-created_date", 50);
      setStyles(list || []);
    } catch {
      setStyles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const onCreated = (profile) => {
    reload();
    setSelected(profile);
    toast({ title: "Estilo guardado", description: profile.name });
  };

  const onDelete = async (id) => {
    try {
      await base44.entities.PhotographerStyleProfile.delete(id);
      if (selected?.id === id) setSelected(null);
      reload();
      toast({ title: "Estilo eliminado" });
    } catch (e) {
      toast({ title: "Error al eliminar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold">Creador de estilos</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Aprende el look de un fotógrafo desde una galería pública. El perfil aporta solo la capa creativa a Ajustes IA.
          </p>
        </div>
        <button onClick={() => navigate("/herramientas")} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Herramientas
        </button>
      </div>

      <NewStyleForm onCreated={onCreated} />

      <div>
        <h2 className="text-sm font-semibold mb-2">Mis estilos guardados</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : styles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no has creado ningún estilo.</p>
        ) : (
          <StyleList styles={styles} selectedId={selected?.id} onSelect={setSelected} onDelete={onDelete} />
        )}
      </div>

      {selected && <StyleProfileView profile={selected} />}
    </div>
  );
}