// Origin-agnostic image URL extractor, shared by any backend function that needs to turn a
// public gallery/page URL (or a list of direct image URLs) into a flat list of direct image
// URLs — used today by importImagesFromUrl and styleGalleryAnalyze. Extracted here instead of
// duplicated so both stay in sync with the same gallery-parsing rules (SmugMug, HTML galleries).
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'tiff', 'tif', 'heic'];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  aacute: 'á', Aacute: 'Á', eacute: 'é', Eacute: 'É', iacute: 'í', Iacute: 'Í',
  oacute: 'ó', Oacute: 'Ó', uacute: 'ú', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', Agrave: 'À', egrave: 'è', Egrave: 'È',
  igrave: 'ì', Igrave: 'Ì', ograve: 'ò', Ograve: 'Ò', ugrave: 'ù', Ugrave: 'Ù',
  auml: 'ä', Auml: 'Ä', euml: 'ë', Euml: 'Ë', iuml: 'ï', Iuml: 'Ï', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü',
  szlig: 'ß', aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', ae: 'æ', AE: 'Æ'
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function isDirectImage(url: string): boolean {
  try {
    const u = new URL(url);
    const ext = u.pathname.split('.').pop()?.toLowerCase() || '';
    return IMAGE_EXT.includes(ext);
  } catch {
    return false;
  }
}

function toAbsolute(src: string, base: string): string | null {
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

// SmugMug gallery HTML embeds small/medium thumbnails; upgrade to X3 so downstream
// consumers (AI analysis, style learning) get enough resolution.
function upgradeSmugMug(url: string): string {
  if (!url.includes('photos.smugmug.com')) return url;
  return url.replace(/\/S\//, '/X3/').replace(/-S\.(jpg|jpeg|png)/i, '-X3.$1');
}

export async function extractImageUrls(rawInput: string): Promise<{ urls: string[]; error?: string }> {
  const inputs = String(rawInput).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const direct = inputs.filter(isDirectImage);
  const pages = inputs.filter((u) => !isDirectImage(u));

  const found: string[] = [...direct];
  const passwordProtectedPages: string[] = [];
  for (const pageUrl of pages) {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      }
    });
    if (!res.ok) continue;
    const html = await res.text();

    // SmugMug (and similar) galleries can be password-protected: the fetch succeeds but
    // returns an "Unlock Gallery" form instead of any photos.
    if (/sm-node-password|Unlock Gallery/i.test(html)) {
      passwordProtectedPages.push(pageUrl);
      continue;
    }

    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(html)) !== null) {
      const a = toAbsolute(decodeEntities(m[1]), pageUrl);
      if (!a) continue;
      if (isDirectImage(a) || a.includes('photos.smugmug.com')) {
        found.push(upgradeSmugMug(a));
      }
    }
    const urlRegex = /https:\/\/photos\.smugmug\.com\/[^\s"'<>\\]+/gi;
    let u: RegExpExecArray | null;
    while ((u = urlRegex.exec(html)) !== null) {
      found.push(upgradeSmugMug(decodeEntities(u[0])));
    }
  }

  const unique = [...new Set(found)];
  if (!unique.length && passwordProtectedPages.length) {
    return {
      urls: [],
      error: 'Esa galería está protegida con contraseña, así que no se puede leer desde fuera. Compártela como galería pública (sin contraseña) o introduce las URLs de las fotos directamente.'
    };
  }
  return { urls: unique };
}