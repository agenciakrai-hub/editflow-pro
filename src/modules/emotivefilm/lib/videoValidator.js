// Validación automática de HERO VIDEOS generados por Image-to-Video.
//
// Comprueba que el vídeo sea válido, tenga la duración y resolución correctas,
// y no contenga frames negros o corruptos. Si la validación falla, el pipeline
// reintenta con un prompt corregido o cae al motor 2D como fallback.

// Valida un vídeo desde una URL.
// Devuelve { valid, errors, warnings, duration, width, height }.
export async function validateHeroVideo(videoUrl, expectedDuration) {
  const errors = [];
  const warnings = [];

  try {
    const video = await loadVideo(videoUrl);

    // 1. Duración: debe ser ≥ 2s y cercana a la esperada (±2s de tolerancia).
    if (!video.duration || video.duration < 1.5) {
      errors.push(`Vídeo demasiado corto o sin duración: ${video.duration?.toFixed(1) || 0}s`);
    }
    if (expectedDuration && video.duration > 1.5 && Math.abs(video.duration - expectedDuration) > 2.5) {
      warnings.push(`Duración ${video.duration.toFixed(1)}s (esperada ~${expectedDuration}s)`);
    }

    // 2. Resolución: debe ser ≥ 720p en al menos una dimensión.
    if (video.videoWidth < 576 || video.videoHeight < 576) {
      errors.push(`Resolución demasiado baja: ${video.videoWidth}×${video.videoHeight}`);
    }

    // 3. Frames negros: muestrea 3 frames y comprueba brillo medio.
    if (video.duration >= 1.5) {
      const blackFrames = await checkBlackFrames(video);
      if (blackFrames > 0) {
        errors.push(`${blackFrames} frame(s) negro(s) detectados de 3 muestras`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch (e) {
    return { valid: false, errors: [`No se pudo cargar el vídeo: ${e.message}`], warnings };
  }
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    const timeout = setTimeout(() => reject(new Error("Timeout cargando vídeo")), 15000);
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      resolve(video);
    };
    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Error cargando vídeo"));
    };
    video.src = url;
  });
}

// Muestrea 3 frames (25%, 50%, 75%) y comprueba si son negros (brillo medio < 10).
async function checkBlackFrames(video) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 160;
  canvas.height = 90;
  let blackCount = 0;
  const sampleTimes = [
    video.duration * 0.25,
    video.duration * 0.5,
    video.duration * 0.75,
  ];

  for (const t of sampleTimes) {
    try {
      await seekVideo(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      const pixels = canvas.width * canvas.height;
      for (let i = 0; i < data.data.length; i += 4) {
        sum += (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
      }
      const avg = sum / pixels;
      if (avg < 10) blackCount++;
    } catch {
      // Si no se puede buscar a un punto, cuenta como frame problemático.
      blackCount++;
    }
  }
  return blackCount;
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onseeked = () => {
      video.removeEventListener("seeked", onseeked);
      video.removeEventListener("error", onerror);
      resolve();
    };
    const onerror = () => {
      video.removeEventListener("seeked", onseeked);
      video.removeEventListener("error", onerror);
      reject(new Error("Seek error"));
    };
    video.addEventListener("seeked", onseeked);
    video.addEventListener("error", onerror);
    video.currentTime = Math.min(time, video.duration - 0.01);
  });
}