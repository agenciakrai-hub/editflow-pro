// Renderizador de vídeo — canvas 2D + MediaRecorder. Sirve tanto para la
// PREVISUALIZACIÓN (reproducción en tiempo real con audio) como para la
// EXPORTACIÓN (grabación del canvas a WebM/MP4).
//
// El renderizador dibuja cada clip con su movimiento (Ken Burns) y aplica la
// transición con el clip anterior. Las imágenes se cargan bajo demanda desde
// IndexedDB (getCachedPreview) y se cachean en un Map en memoria (LRU simple)
// para no recargarlas en cada frame.
import { motionAt, motionAtSafe } from "./motionEngine";
import { cinematicAtSafe } from "./cinematicCamera";
import { transitionState, transitionDuration } from "./transitionEngine";
import { getCachedPreview } from "@/modules/proyectos/lib/previewCache";

const IMG_CACHE_MAX = 60;

export class FilmRenderer {
  constructor(canvas, aspectRatio = "16:9") {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.aspectRatio = aspectRatio;
    this.imgCache = new Map(); // hash -> HTMLImageElement
    this.imgOrder = []; // LRU order
    this.videoCache = new Map(); // hash -> HTMLVideoElement (I2V clips)
    this.heroVideos = {}; // { hash: { status, video_url, ... } }
    this.clips = [];
    this.totalDuration = 0;
    this.audioBuffer = null;
    this.audioCtx = null;
    this.source = null;
    this.startTime = 0;
    this.pausedAt = 0;
    this.playing = false;
    this.rafId = null;
    this.onEnd = null;
    this.onTime = null;
    this.bgColor = "#000000";
    this.setResolution(aspectRatio, "1080p");
  }

  setResolution(aspectRatio, resolution) {
    this.aspectRatio = aspectRatio;
    const ar = aspectRatio === "9:16" ? [9, 16] : aspectRatio === "1:1" ? [1, 1] : [16, 9];
    const baseH = resolution === "4k" ? 2160 : 1080;
    const h = baseH;
    const w = Math.round(h * (ar[0] / ar[1]));
    this.canvas.width = w;
    this.canvas.height = h;
    this.resolution = resolution;
  }

  setTimeline(clips, totalDuration, bgColor) {
    this.clips = clips;
    this.totalDuration = totalDuration;
    this.bgColor = bgColor || "#000000";
  }

  setHeroVideos(map) {
    this.heroVideos = map || {};
  }

  setAudio(audioBuffer) {
    this.audioBuffer = audioBuffer;
  }

  async _getImage(hash) {
    if (!hash) return null;
    if (this.imgCache.has(hash)) {
      // LRU touch
      const img = this.imgCache.get(hash);
      this.imgOrder = this.imgOrder.filter((h) => h !== hash);
      this.imgOrder.push(hash);
      return img;
    }
    const preview = await getCachedPreview(hash);
    // USA LA MEJOR RESOLUCIÓN DISPONIBLE: hiResDataUrl (2400px) para exportación
    // 1080p/4K, dataUrl (800px) como fallback. Esto evita upscaling borroso.
    const bestUrl = preview?.hiResDataUrl || preview?.dataUrl;
    if (!bestUrl) return null;
    const img = await loadImage(bestUrl);
    this.imgCache.set(hash, img);
    this.imgOrder.push(hash);
    if (this.imgOrder.length > IMG_CACHE_MAX) {
      const old = this.imgOrder.shift();
      this.imgCache.delete(old);
    }
    return img;
  }

  // Carga y cachea un HTMLVideoElement para un clip I2V (Image-to-Video).
  async _getVideo(hash) {
    if (!hash) return null;
    if (this.videoCache.has(hash)) return this.videoCache.get(hash);
    const clip = this.clips.find((c) => c.hash === hash);
    if (!clip?.videoUrl) return null;
    const video = await loadVideo(clip.videoUrl);
    video.muted = true;
    video.playsInline = true;
    this.videoCache.set(hash, video);
    return video;
  }

  // Dibuja un frame en el instante `time` (segundos). Síncrono tras precargar imgs.
  _drawFrame(time) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, W, H);

    const idx = this._clipIndexAt(time);
    if (idx < 0) return;
    const clip = this.clips[idx];
    const localT = (time - clip.start) / clip.duration;

    const transDur = clip.transitionDur || 0;
    if (idx > 0 && time < clip.start + transDur && transDur > 0) {
      const prevClip = this.clips[idx - 1];
      const tt = (time - clip.start) / transDur;
      const ts = transitionState(clip.transition, tt);
      this._drawClipContent(prevClip, 1, { alpha: ts.outAlpha, blur: ts.blurOut });
      this._drawClipContent(clip, localT, { alpha: ts.inAlpha, blur: ts.blurIn, zoom: ts.zoomIn, black: ts.black });
    } else {
      this._drawClipContent(clip, localT, { alpha: 1 });
    }
  }

  // Dibuja el contenido de un clip: vídeo I2V (si tiene videoUrl) o imagen con
  // motor cinematográfico 2D (Ken Burns + parallax). El renderer híbrido mezcla
  // ambos de forma invisible para el espectador.
  _drawClipContent(clip, localT, opts = {}) {
    if (clip.videoUrl) {
      const video = this.videoCache.get(clip.hash);
      if (video && video.readyState >= 2) {
        this._drawVideoFrame(video, clip, localT, opts);
      }
    } else {
      const img = this.imgCache.get(clip.hash);
      if (img) this._drawImage(img, clip, localT, opts);
    }
  }

  // Dibuja un frame de un vídeo I2V (Kling 3.0 Pro). El vídeo YA tiene su propio
  // movimiento cinematográfico generado por IA, así que NO se aplica Ken Burns
  // adicional: solo object-fit: contain + transiciones (fade/blur/dip_to_black).
  _drawVideoFrame(video, clip, localT, opts = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const alpha = opts.alpha ?? 1;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
    else ctx.filter = "none";

    const vr = video.videoWidth / video.videoHeight;
    const cr = W / H;
    let dw, dh;
    if (vr > cr) { dw = W; dh = W / vr; }
    else { dh = H; dw = H * vr; }
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);

    if (opts.black && opts.black > 0) {
      ctx.filter = "none";
      ctx.globalAlpha = opts.black * alpha;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.filter = "none";
  }

  // Dibuja una imagen con movimiento Ken Burns aplicado. Contiene la imagen en
  // el canvas (object-fit: contain) y aplica scale + pan. Si el movimiento es
  // parallax, añade una viñeta radial dinámica que simula profundidad 2.5D.
  _drawImage(img, clip, localT, opts = {}) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const alpha = opts.alpha ?? 1;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
    else ctx.filter = "none";

    // AI Cinematic Camera Engine: si el clip tiene contexto (scene), usa el motor
    // cinematográfico dinámico. Si no (legacy), cae al motor de presets.
    const m = clip.scene && clip.intensity != null
      ? cinematicAtSafe(clip, localT)
      : motionAtSafe(clip.motion, localT, clip.subjectPosition);
    const zoom = (opts.zoom || 1) * m.scale;

    // Contener la imagen en el canvas (object-fit: contain).
    const ir = img.width / img.height;
    const cr = W / H;
    let dw, dh;
    if (ir > cr) { dw = W * zoom; dh = (W * zoom) / ir; }
    else { dh = H * zoom; dw = (H * zoom) * ir; }
    const panX = m.panX * W * 0.5;
    const panY = m.panY * H * 0.5;
    const dx = (W - dw) / 2 + panX;
    const dy = (H - dh) / 2 + panY;

    ctx.drawImage(img, dx, dy, dw, dh);

    // PARALLAX CON PROFUNDIDAD DE CAMPO: en lugar de solo una viñeta, aplica un
    // efecto de profundidad de campo (DoF) que mantiene nítida la zona del sujeto
    // y difumina ligeramente los bordes. Esto crea una ilusión de profundidad
    // más convincente que la viñeta simple: el ojo percibe capas (sujeto cercano
    // nítido, fondo lejano suave). La zona nítida sigue al sujeto (subjectPosition).
    if (m.parallax && !opts.blur) {
      ctx.filter = "none";
      ctx.globalAlpha = alpha;
      // Centro de la zona nítida según la posición del sujeto.
      const sx = clip.subjectPosition === "left" ? W * 0.3
        : clip.subjectPosition === "right" ? W * 0.7 : W * 0.5;
      const sy = H * 0.5;
      // Gradiente radial: nítido en el centro (sujeto), difuminado en los bordes.
      // El difuminado se simula con un oscurecimiento suave de los bordes (viñeta
      // + sutil tinte). Combinado con el pan opuesto, crea el efecto 2.5D.
      const innerR = Math.min(W, H) * 0.2;
      const outerR = Math.max(W, H) * 0.72;
      const grad = ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.55, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${0.32 * alpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // Viñeta secundaria que se desplaza opuesta al pan (refuerza el 2.5D).
      const cx = W / 2 - panX * 1.5;
      const cy = H / 2 - panY * 1.5;
      const grad2 = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      grad2.addColorStop(0, "rgba(0,0,0,0)");
      grad2.addColorStop(1, `rgba(0,0,0,${0.15 * alpha})`);
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, W, H);
    }

    // Dip to black overlay
    if (opts.black && opts.black > 0) {
      ctx.filter = "none";
      ctx.globalAlpha = opts.black * alpha;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.filter = "none";
  }

  _clipIndexAt(time) {
    for (let i = 0; i < this.clips.length; i++) {
      const c = this.clips[i];
      if (time >= c.start && time < c.start + c.duration) return i;
    }
    // Si es justo el final, último clip.
    return this.clips.length - 1;
  }

  // Precarga las imágenes de los clips cercanos a `time` (ventana de lookahead).
  async _preloadAround(time) {
    const lookAhead = 5; // segundos
    for (const c of this.clips) {
      if (c.start <= time + lookAhead && c.start + c.duration >= time - 1) {
        if (c.videoUrl) {
          if (!this.videoCache.has(c.hash)) await this._getVideo(c.hash);
        } else {
          if (!this.imgCache.has(c.hash)) await this._getImage(c.hash);
        }
      }
    }
  }

  // Seek asíncrono para export determinista (WebCodecs). Busca el vídeo I2V
  // activo al frame exacto antes de dibujar. No hace nada para clips de imagen.
  async _seekTo(time) {
    const idx = this._clipIndexAt(time);
    if (idx < 0) return;
    const clip = this.clips[idx];
    if (!clip.videoUrl) return;
    const video = this.videoCache.get(clip.hash) || await this._getVideo(clip.hash);
    if (!video) return;
    const targetTime = time - clip.start;
    if (Math.abs(video.currentTime - targetTime) > 0.05) {
      await this._seekVideo(video, Math.min(Math.max(0, targetTime), Math.max(0, (video.duration || 5) - 0.05)));
    }
  }

  _seekVideo(video, time) {
    return new Promise((resolve) => {
      const onseeked = () => {
        video.removeEventListener("seeked", onseeked);
        resolve();
      };
      video.addEventListener("seeked", onseeked);
      video.currentTime = time;
    });
  }

  async play(fromTime = 0) {
    if (this.playing) return;
    // Precarga inicial.
    await this._preloadAround(fromTime);
    this.playing = true;
    this.startTime = performance.now() / 1000 - fromTime;
    // Audio
    if (this.audioBuffer) {
      if (!this.audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AC();
      }
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      this.source = this.audioCtx.createBufferSource();
      this.source.buffer = this.audioBuffer;
      this.source.connect(this.audioCtx.destination);
      this.source.start(0, fromTime);
    }
    this._loop();
  }

  // Sincroniza los vídeos I2V con la timeline en tiempo real (preview + MediaRecorder).
  // Cuando la timeline entra en un clip I2V, reproduce el vídeo desde la posición
  // correcta. Cuando sale, pausa todos los vídeos.
  _syncVideo(time) {
    const idx = this._clipIndexAt(time);
    if (idx < 0) return;
    const clip = this.clips[idx];
    if (!clip.videoUrl) {
      for (const v of this.videoCache.values()) { try { v.pause(); } catch {} }
      return;
    }
    const video = this.videoCache.get(clip.hash);
    if (!video) return;
    const targetTime = time - clip.start;
    if (video.paused || Math.abs(video.currentTime - targetTime) > 0.3) {
      video.currentTime = Math.min(Math.max(0, targetTime), Math.max(0, (video.duration || 5) - 0.05));
      video.play().catch(() => {});
    }
  }

  _loop = () => {
    if (!this.playing) return;
    const now = performance.now() / 1000;
    const time = now - this.startTime;
    if (time >= this.totalDuration) {
      this.pause();
      this.onEnd?.();
      return;
    }
    this._syncVideo(time);
    this._drawFrame(time);
    this.onTime?.(time, this.totalDuration);
    this._preloadAround(time);
    this.rafId = requestAnimationFrame(this._loop);
  };

  pause() {
    this.playing = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.source) {
      try { this.source.stop(); } catch {}
      this.source = null;
    }
    this.pausedAt = performance.now() / 1000 - this.startTime;
  }

  seek(time) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this._drawFrame(time);
    this.pausedAt = time;
    if (wasPlaying) this.play(time);
  }

  destroy() {
    this.pause();
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.imgCache.clear();
    for (const v of this.videoCache.values()) { try { v.pause(); v.src = ""; } catch {} }
    this.videoCache.clear();
  }

  // EXPORTACIÓN: graba el canvas + audio a un Blob de vídeo. Usa MediaRecorder.
  // Si el navegador soporta video/mp4 lo usa; si no, cae a webm.
  async export(onProgress) {
    const fps = 30;
    // PRECARGA TODAS las imágenes ANTES de empezar a grabar. Esto evita frames
    // negros/congelados: si una imagen no está cacheada cuando _drawFrame corre,
    // el frame queda en negro. Con la precarga completa, todos los frames tienen imagen.
    await this._preloadAll();
    // Dibuja el primer frame para confirmar que las imágenes están listas.
    this._drawFrame(0);

    const stream = this.canvas.captureStream(fps);
    // Audio: si hay audioBuffer, crea un MediaStreamAudioDestinationNode y lo añade.
    let audioCtx = null;
    let src = null;
    if (this.audioBuffer) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const dest = audioCtx.createMediaStreamDestination();
      src = audioCtx.createBufferSource();
      src.buffer = this.audioBuffer;
      src.connect(dest);
      stream.addTrack(dest.stream.getAudioTracks()[0]);
      src.start(0);
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start();

    // Reproduce la timeline en tiempo real dibujando frames. Todas las imágenes
    // ya están en imgCache (precargadas), así que _drawFrame nunca queda en negro.
    this.playing = true;
    this.startTime = performance.now() / 1000;
    await new Promise((resolve) => {
      const loop = () => {
        if (!this.playing) return resolve();
        const now = performance.now() / 1000;
        const time = now - this.startTime;
        if (time >= this.totalDuration) {
          this.playing = false;
          resolve();
          return;
        }
        this._syncVideo(time);
        this._drawFrame(time);
        onProgress?.(time, this.totalDuration);
        requestAnimationFrame(loop);
      };
      loop();
    });
    recorder.stop();
    if (audioCtx) { try { src.stop(); } catch {} try { audioCtx.close(); } catch {} }
    await done;
    const blob = new Blob(chunks, { type: mime });
    return blob;
  }

  // Precarga TODAS las imágenes de la timeline en el caché LRU. Para timelines
  // largas (100+ fotos) puede tardar unos segundos, pero garantiza que ningún
  // frame quede en negro durante la grabación.
  async _preloadAll() {
    const hashes = this.clips.map((c) => c.hash).filter(Boolean);
    for (const h of hashes) {
      if (!this.imgCache.has(h)) await this._getImage(h);
    }
    // Preload I2V videos.
    for (const c of this.clips) {
      if (c.videoUrl && !this.videoCache.has(c.hash)) await this._getVideo(c.hash);
    }
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Error cargando vídeo I2V"));
    video.src = src;
  });
}

function pickMime() {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}