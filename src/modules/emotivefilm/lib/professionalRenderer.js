// Renderizador profesional determinista — WebCodecs + mp4-muxer/webm-muxer.
//
// A diferencia de MediaRecorder (que graba el canvas en tiempo real y puede
// perder frames si el CPU está ocupado), este renderer codifica FRAME A FRAME
// de forma determinista: cada frame se dibuja, se crea un VideoFrame, se codifica
// con VideoEncoder y se añade al muxer. No depende del tiempo real: puede tardar
// 2x o 5x la duración del vídeo, pero NUNCA pierde frames.
//
// Audio: si hay AudioEncoder disponible, codifica el AudioBuffer en AAC (MP4) u
// Opus (WebM) y lo añade al mismo muxer. Sincronización exacta por timestamp.
//
// Formato de salida:
//   - Si H.264 (avc1) + AAC (mp4a.40.2) son soportados → MP4 real (H.264 + AAC)
//   - Si solo VP9 es soportado → WebM (VP9 + Opus) via WebCodecs
//   - Si WebCodecs no está disponible → null (el llamador debe usar MediaRecorder)
//
// El renderer recibe una instancia de FilmRenderer (que tiene el canvas, la
// timeline y el audio) y devuelve { blob, format, mime } o null si hay que
// hacer fallback a MediaRecorder.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";

const FPS = 30;
const VIDEO_BITRATE_1080 = 8_000_000;
const VIDEO_BITRATE_4K = 25_000_000;
const AUDIO_BITRATE = 192_000;

// Verifica si WebCodecs está disponible en este navegador.
export function isWebCodecsAvailable() {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

// Determina el mejor formato disponible y los codecs a usar.
// Devuelve { format: 'mp4'|'webm'|null, videoCodec, audioCodec, muxerClass, targetClass }.
export async function detectBestFormat(width, height) {
  if (!isWebCodecsAvailable()) return { format: null };

  const is4k = height >= 2160;
  const videoBitrate = is4k ? VIDEO_BITRATE_4K : VIDEO_BITRATE_1080;

  // Intenta H.264 (MP4) — el formato profesional estándar.
  const mp4CodecCandidates = is4k
    ? ["avc1.640034", "avc1.640029", "avc1.4d0029"]
    : ["avc1.4d0029", "avc1.42001f"];

  for (const codec of mp4CodecCandidates) {
    try {
      const videoCheck = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: videoBitrate,
        framerate: FPS,
      });
      const audioCheck = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2",
        sampleRate: 44100,
        numberOfChannels: 2,
        bitrate: AUDIO_BITRATE,
      });
      if (videoCheck?.supported && audioCheck?.supported) {
        return { format: "mp4", videoCodec: codec, audioCodec: "mp4a.40.2" };
      }
    } catch {}
  }

  // Intenta VP9 (WebM) — fallback si H.264 no está soportado.
  try {
    const videoCheck = await VideoEncoder.isConfigSupported({
      codec: "vp09.00.10.08",
      width,
      height,
      bitrate: videoBitrate,
      framerate: FPS,
    });
    const audioCheck = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: AUDIO_BITRATE,
    });
    if (videoCheck?.supported && audioCheck?.supported) {
      return { format: "webm", videoCodec: "vp09.00.10.08", audioCodec: "opus" };
    }
  } catch {}

  return { format: null };
}

// Exporta el vídeo usando WebCodecs. Devuelve { blob, format, mime } o null.
// renderer: instancia de FilmRenderer con canvas, timeline y audio listos.
export async function exportWithWebCodecs(renderer, onProgress) {
  const { canvas, totalDuration, audioBuffer } = renderer;
  if (!canvas || !totalDuration) return null;

  const formatInfo = await detectBestFormat(canvas.width, canvas.height);
  if (!formatInfo.format) return null;

  // Precarga TODAS las imágenes antes de empezar (sin frames negros).
  await renderer._preloadAll();
  renderer._drawFrame(0);

  const is4k = canvas.height >= 2160;
  const videoBitrate = is4k ? VIDEO_BITRATE_4K : VIDEO_BITRATE_1080;

  // Configura el muxer según el formato.
  let muxer;
  if (formatInfo.format === "mp4") {
    muxer = new Mp4Muxer({
      target: new Mp4Target(),
      video: { codec: "avc", width: canvas.width, height: canvas.height },
      audio: audioBuffer
        ? { codec: "aac", sampleRate: 44100, numberOfChannels: 2 }
        : undefined,
      fastStart: "in-memory",
    });
  } else {
    muxer = new WebmMuxer({
      target: new WebmTarget(),
      video: { codec: "V_VP9", width: canvas.width, height: canvas.height },
      audio: audioBuffer
        ? { codec: "A_OPUS", sampleRate: 48000, numberOfChannels: 2 }
        : undefined,
    });
  }

  // === VIDEO ENCODER ===
  let videoEncoderError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { videoEncoderError = e; console.error("VideoEncoder error", e); },
  });
  videoEncoder.configure({
    codec: formatInfo.videoCodec,
    width: canvas.width,
    height: canvas.height,
    bitrate: videoBitrate,
    framerate: FPS,
  });

  // Codifica frame a frame de forma determinista.
  const totalFrames = Math.ceil(totalDuration * FPS);
  for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
    if (videoEncoderError) throw videoEncoderError;
    const time = frameNum / FPS;
    renderer._drawFrame(time);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(frameNum * (1_000_000 / FPS)),
      duration: Math.round(1_000_000 / FPS),
    });
    videoEncoder.encode(frame, { keyFrame: frameNum % (FPS * 5) === 0 });
    frame.close();

    // Si la cola del encoder se llena, espera para no saturar la memoria.
    if (videoEncoder.encodeQueueSize > 10) {
      await new Promise((r) => setTimeout(r, 1));
    }

    if (onProgress && frameNum % 10 === 0) {
      onProgress(frameNum / totalFrames, time, totalDuration);
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();

  // === AUDIO ENCODER ===
  if (audioBuffer) {
    let audioEncoderError = null;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { audioEncoderError = e; console.error("AudioEncoder error", e); },
    });
    audioEncoder.configure({
      codec: formatInfo.audioCodec,
      sampleRate: formatInfo.format === "mp4" ? 44100 : 48000,
      numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
      bitrate: AUDIO_BITRATE,
    });

    // Codifica el audio en chunks de 1 segundo.
    const targetSampleRate = formatInfo.format === "mp4" ? 44100 : 48000;
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const chunkFrames = audioBuffer.sampleRate; // 1 segundo

    for (let i = 0; i < audioBuffer.length; i += chunkFrames) {
      if (audioEncoderError) throw audioEncoderError;
      const frames = Math.min(chunkFrames, audioBuffer.length - i);
      // Construye datos planares f32: [ch0_samples, ch1_samples, ...]
      const planarData = new Float32Array(frames * channels);
      for (let ch = 0; ch < channels; ch++) {
        const chData = audioBuffer.getChannelData(ch);
        planarData.set(chData.subarray(i, i + frames), ch * frames);
      }
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: audioBuffer.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((i / audioBuffer.sampleRate) * 1_000_000),
        data: planarData,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      if (audioEncoder.encodeQueueSize > 10) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  // Finaliza el muxer y obtiene el buffer.
  muxer.finalize();
  const { buffer } = muxer.target;

  const mime = formatInfo.format === "mp4" ? "video/mp4" : "video/webm";
  const blob = new Blob([buffer], { type: mime });

  if (onProgress) onProgress(1, totalDuration, totalDuration);

  return { blob, format: formatInfo.format, mime };
}