// Genera prompts cinematográficos por HERO SHOT para Image-to-Video (Kling 3.0 Pro).
//
// Cada prompt se adapta al contenido de la foto (escena, orientación, posición del
// sujeto, intensidad emocional) y prioriza MOVIMIENTO DE CÁMARA sobre movimiento
// corporal para preservar identidad y realismo.
//
// El prompt NUNCA es genérico: cada hero shot recibe su propio prompt dinámico.

// Guardia de identidad — se añade SIEMPRE al final de cada prompt.
// Prioridad absoluta: identidad + realismo + consistencia.
const IDENTITY_GUARD =
  "Preserve facial identity, clothing, and composition exactly as in the source image. " +
  "No deformed faces, no deformed hands, no extra people, no changed clothing, " +
  "no duplicated people, no morphed bodies, no artificial body movement. " +
  "Camera movement only, minimal natural body movement. " +
  "Photorealistic, cinematic quality, shallow depth of field.";

// Prompts base por escena. Cada uno describe un movimiento de cámara apropiado
// al contenido narrativo de la escena.
const SCENE_PROMPTS = {
  beso: "Slow romantic push-in towards the couple kissing, gentle and intimate camera movement, warm golden light, emotional atmosphere",
  pareja: "Slow cinematic push-in towards the couple, gentle elegant camera movement, romantic wedding atmosphere, natural light",
  baile: "Smooth circular camera movement around the dancing couple, elegant flowing motion, romantic celebratory atmosphere",
  ceremonia: "Slow reverent push-in, ceremonial atmosphere, soft natural light, emotional sacred moment",
  novia: "Slow elegant push-in towards the bride, delicate camera movement, romantic anticipation, soft morning light",
  novio: "Slow confident push-in towards the groom, steady camera movement, anticipation and composure",
  anillos: "Slow macro push-in on the hands and wedding rings, shallow depth of field, delicate precise movement",
  retratos: "Subtle camera drift around the subject, fine art portrait photography, shallow depth of field, elegant studio quality",
  familia: "Slow warm push-in towards the family group, emotional atmosphere, gentle collective moment",
  amigos: "Smooth lateral tracking shot of the friends group, celebratory joyful atmosphere, natural candid moment",
  celebracion: "Dynamic camera movement through the celebration, joyful atmosphere, smooth stable motion",
  banquete: "Slow elegant pan across the banquet scene, warm ambient light, shallow depth of field",
  fiesta: "Energetic camera movement matching the party rhythm, dynamic but stable, celebratory energy",
  preparativos: "Slow intimate push-in, soft morning light, delicate details, quiet anticipation",
  detalle: "Slow macro push-in on the detail, shallow depth of field, elegant precise movement",
  otros: "Slow cinematic push-in, elegant camera movement, shallow depth of field, professional quality",
};

// Construye el prompt cinematográfico para un hero shot.
// clip: { scene, orientation, subjectPosition|subject_position, intensity, description, is_hero }
export function buildHeroPrompt(clip) {
  const scene = String(clip.scene || "otros").toLowerCase();
  const orientation = clip.orientation || "landscape";
  const subjectPosition = clip.subjectPosition || clip.subject_position || "center";
  const intensity = clip.intensity ?? 50;
  const description = clip.description || "";

  let prompt = SCENE_PROMPTS[scene] || SCENE_PROMPTS.otros;

  // Ajuste por orientación: el movimiento respeta el encuadre.
  if (orientation === "portrait") {
    prompt += ". Vertical composition, camera movement respects the vertical framing";
  } else if (orientation === "landscape") {
    prompt += ". Horizontal widescreen composition, cinematic framing";
  }

  // Ajuste por posición del sujeto: la cámara se mueve HACIA el sujeto, no lo saca.
  if (subjectPosition === "left") {
    prompt += ". Subject positioned on the left third, camera movement keeps subject centered in frame";
  } else if (subjectPosition === "right") {
    prompt += ". Subject positioned on the right third, camera movement keeps subject centered in frame";
  }

  // Ajuste por intensidad emocional: el ritmo del movimiento cambia.
  if (intensity >= 80) {
    prompt += ". Powerful emotional climax moment, slow dramatic push-in with gravitas";
  } else if (intensity >= 60) {
    prompt += ". Emotional moment, gentle cinematic movement with feeling";
  } else {
    prompt += ". Calm serene moment, subtle elegant minimal movement";
  }

  // Contexto descriptivo del VLM (si disponible).
  if (description) {
    prompt += `. Scene context: ${description}`;
  }

  // Guardia de identidad SIEMPRE al final.
  return `${prompt}. ${IDENTITY_GUARD}`;
}

// Versión conservadora del prompt para reintentos (si el primer intento falló
// la validación). Minimiza el movimiento para máxima estabilidad.
export function buildConservativePrompt(clip) {
  const base = buildHeroPrompt(clip);
  return base.replace(
    "Slow cinematic push-in",
    "Very slow minimal push-in"
  ).replace(
    "Smooth circular camera movement",
    "Very slow gentle camera movement"
  ) + " Emphasis on maximum stability and identity preservation. Minimal camera movement.";
}