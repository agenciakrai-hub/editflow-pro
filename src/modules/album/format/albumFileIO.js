// Fase Guardado/Apertura — E/S de archivos .editflowalbum con RUTA VINCULADA.
// Reutiliza íntegramente buildAlbumDocument / downloadAlbumFile / parseAlbumDocument /
// importAlbumDocument del formato (sin tocarlo). Nada de esto afecta al autosave
// interno de la base de datos: son dos cosas distintas y separadas.
//
//   ⌘+S (saveAlbumFile):
//     - ruta vinculada (handle guardado en IndexedDB) → escribe DIRECTO en el archivo
//       (pidiendo permiso si el navegador lo solicita; la pulsación de tecla es gesto
//       de usuario válido) y no vuelve a preguntar dónde guardar.
//     - sin ruta → selector nativo de guardado; la ruta queda vinculada para la próxima.
//     - navegador sin File System Access (Firefox/Safari) → descarga clásica actual.
//
//   Apertura (openAlbumFile / importOpenedAlbumFile):
//     - selector nativo en modo readwrite (o input file como fallback) → validar,
//       importar como álbum y vincular el handle para que ⌘+S sobrescriba ESE archivo.
import { buildAlbumDocument, downloadAlbumFile, parseAlbumDocument, importAlbumDocument } from "@/modules/album/format/albumFile";
import { getAlbumFileHandle, putAlbumFileHandle } from "@/modules/album/lib/previewStore";

const ALBUM_TYPES = [{ description: "Proyecto de álbum EditFlow", accept: { "application/json": [".editflowalbum"] } }];
const safeName = (n) => (n || "album").replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, "").trim() + ".editflowalbum";

async function writeDoc(handle, project, photos, spreads) {
  const doc = buildAlbumDocument(project, photos, spreads);
  const w = await handle.createWritable();
  await w.write(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
  await w.close();
}

// ⌘+S — guarda el archivo real del proyecto. Devuelve { ok, mode }:
// linked (ruta vinculada, guardado directo) | picked (primera vez: selector, ruta ya
// vinculada) | download (fallback clásico) | canceled (el usuario cerró el selector).
export async function saveAlbumFile(project, photos, spreads) {
  let handle = await getAlbumFileHandle(project.id).catch(() => null);
  if (handle) {
    try {
      let perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "prompt") perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        await writeDoc(handle, project, photos, spreads);
        return { ok: true, mode: "linked" };
      }
    } catch {
      // Handle huérfano (archivo movido/borrado): se vuelve a pedir ruta abajo.
      handle = null;
    }
  }
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const picker = await window.showSaveFilePicker({ suggestedName: safeName(project.name), types: ALBUM_TYPES });
      await writeDoc(picker, project, photos, spreads);
      await putAlbumFileHandle(project.id, picker);
      return { ok: true, mode: "picked" };
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, mode: "canceled" };
      // Otros errores del selector → fallback de descarga clásica.
    }
  }
  downloadAlbumFile(project, photos, spreads);
  return { ok: true, mode: "download" };
}

// Abre un .editflowalbum: selector nativo (readwrite, para poder vincular la ruta)
// o input file como fallback. Devuelve { file, handle } o { canceled }.
export function openAlbumFile() {
  return new Promise((resolve) => {
    if (typeof window.showOpenFilePicker === "function") {
      window.showOpenFilePicker({ types: ALBUM_TYPES, multiple: false, mode: "readwrite" })
        .then(async ([h]) => resolve({ file: await h.getFile(), handle: h }))
        .catch(() => resolve({ canceled: true }));
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".editflowalbum,application/json";
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : { canceled: true });
    input.click();
  });
}

// Importa un .editflowalbum ya en memoria (selector, drag-drop o launch del sistema
// operativo) y VINCULA su handle a la copia nueva: ⌘+S guardará sobre ese archivo.
// Acepta File o FileSystemFileHandle. Validación y retrocompatibilidad v1/v2 las
// aporta parseAlbumDocument/importAlbumDocument, sin cambios.
export async function importOpenedAlbumFile(fileOrHandle, handle = null) {
  let file = fileOrHandle;
  if (file && typeof file.getFile === "function") file = await file.getFile();
  if (!file?.name || !String(file.name).toLowerCase().endsWith(".editflowalbum")) {
    throw new Error("No es un archivo .editflowalbum");
  }
  const doc = parseAlbumDocument(await file.text());
  const proj = await importAlbumDocument(doc);
  if (handle) await putAlbumFileHandle(proj.id, handle);
  return proj;
}