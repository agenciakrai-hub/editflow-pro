// Caché efímera de la misma preview JPEG que ya genera extractRawPreview.
// Conserva el decodificado del navegador para los análisis posteriores, sin cambiar
// el Base64 ni los píxeles que reciben los motores existentes.
export function decodePreviewImage(base64Jpeg) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo decodificar la preview para análisis"));
    image.src = `data:image/jpeg;base64,${base64Jpeg}`;
  });
}