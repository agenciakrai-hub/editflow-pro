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
  };
}