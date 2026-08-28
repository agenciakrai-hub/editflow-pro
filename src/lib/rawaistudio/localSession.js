// Sesión en memoria compartida entre la pantalla de Selección y la de Edición.
// No usa base de datos ni persistencia: los objetos File (RAW) viven solo en esta sesión
// del navegador. El usuario vuelve a elegir la carpeta si recarga.
let session = {
  photos: [],
  presetTemplateText: "",
  presetFile: null,
  config: null,
  precisionMode: "balanced",
  profileChoice: null,
  pendingProjectPreviews: {},
};

export function setSession(patch) {
  session = { ...session, ...patch };
}

export function getSession() {
  return session;
}

export function clearSession() {
  session = {
    photos: [],
    presetTemplateText: "",
    presetFile: null,
    config: null,
    precisionMode: "balanced",
    profileChoice: null,
    pendingProjectPreviews: {},
  };
}

// Previews ya extraídas al crear un proyecto, pasadas a la pantalla de detalle para
// que no vuelva a procesarlas. Clave = project_id. Se consumen una sola vez.
export function setPendingProjectPreviews(projectId, items) {
  session.pendingProjectPreviews = { ...session.pendingProjectPreviews, [projectId]: items };
}

export function takePendingProjectPreviews(projectId) {
  const items = session.pendingProjectPreviews?.[projectId] || null;
  if (items) {
    const rest = { ...session.pendingProjectPreviews };
    delete rest[projectId];
    session.pendingProjectPreviews = rest;
  }
  return items;
}