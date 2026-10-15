// Caché efímera de la misma preview JPEG que ya genera extractRawPreview.
// Conserva el decodificado del navegador para los análisis posteriores, sin cambiar
// el Base64 ni los píxeles que reciben los motores existentes.
export function decodePreviewImage(base64Jpeg) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { image.src = ""; reject(new Error("La vista previa no se pudo leer a tiempo")); }, 10000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error("No se pudo decodificar la preview para análisis")); };
    image.src = `data:image/jpeg;base64,${base64Jpeg}`;
  });
}