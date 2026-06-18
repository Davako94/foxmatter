// services/templateEngine.js
// Parser per la sintassi AIOStreams-compatibile dei template.
// Usato da proxy.js (Node.js) e dal browser (copiato inline in index.html).
//
// Sintassi supportata:
//   {prop}                          → valore semplice
//   {prop::exists["T"||"F"]}        → condizionale su esistenza
//   {prop::=value["T"||"F"]}        → condizionale su uguaglianza
//   {prop::~sub["T"||"F"]}          → condizionale su sottostringa
//   {prop::>N["T"||"F"]}            → condizionale numerico
//   {prop::title}                   → uppercase
//   {prop::bytes}                   → formatta bytes → "12.4 GB"
//   {a::exists::or::b::exists["T"||"F"]}  → OR chain tra proprietà

'use strict';

/**
 * Risolve un template con il context fornito.
 * @param {string} template
 * @param {object} ctx  - context piatto con chiavi dotted  (es: "stream.quality")
 * @returns {string}
 */
function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    // OR chain: {a::exists::or::b::exists["T"||"F"]}
    if (expression.includes('::or::')) {
      const orParts = expression.split('::or::');
      for (let i = 0; i < orParts.length; i++) {
        const part   = orParts[i].trim();
        const result = evaluateExpression(part, ctx);
        const isLast = i === orParts.length - 1;
        if (result !== '' && result !== null && result !== undefined) return result;
        if (isLast) return result ?? '';
      }
      return '';
    }

    return evaluateExpression(expression.trim(), ctx) ?? '';
  });
}

function evaluateExpression(expr, ctx) {
  const parts    = expr.split('::');
  const propPath = parts[0].trim();
  const rawValue = getPath(ctx, propPath);

  // Estrae il blocco output ["true"||"false"] dall'ultima parte
  const lastPart   = parts[parts.length - 1];
  const outputMatch = lastPart.match(/^(.*?)\["(.*?)"\s*\|\|\s*"(.*?)"\](.*)$/s);

  let trueVal  = rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
  let falseVal = '';
  let condParts = parts.slice(1);

  if (outputMatch) {
    trueVal   = outputMatch[2];
    falseVal  = outputMatch[3];
    const cleanLast = outputMatch[1].trim();
    condParts = [...parts.slice(1, -1), ...(cleanLast ? [cleanLast] : [])];
  }

  // Nessun modificatore → interpolazione diretta
  if (condParts.length === 0) {
    return rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
  }

  // Modificatori non condizionali (ritornano subito)
  for (const cond of condParts) {
    const c = cond.trim().split('[')[0];
    if (c === 'title') return String(rawValue ?? '').toUpperCase();
    if (c === 'bytes') {
      const b = parseFloat(rawValue);
      if (isNaN(b) || b === 0) return '';
      if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
      if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
      return b + ' B';
    }
    if (c.startsWith('replace')) {
      const m = c.match(/replace\('(.*?)','(.*?)'\)/);
      if (m) trueVal = String(rawValue ?? '').split(m[1]).join(m[2]);
    }
    if (c.startsWith('join')) {
      const m = c.match(/join\('(.*?)'\)/);
      const sep = m ? m[1] : ' | ';
      if (Array.isArray(rawValue)) trueVal = rawValue.join(sep);
    }
  }

  // Valutazione condizioni booleane
  let conditionMet = false;
  for (const cond of condParts) {
    const c = cond.trim().split('[')[0];
    if (c === 'exists') {
      const v = rawValue;
      conditionMet = v !== undefined && v !== null && v !== '' && v !== 0
                  && !(Array.isArray(v) && v.length === 0);
    } else if (c === 'istrue' || c === 'true') {
      conditionMet = rawValue === true || rawValue === 'true' || rawValue === 1;
    } else if (c === 'isfalse' || c === 'false') {
      conditionMet = !rawValue || rawValue === 'false' || rawValue === 0;
    } else if (c.startsWith('=')) {
      const target = c.slice(1);
      conditionMet = String(rawValue ?? '').toLowerCase() === target.toLowerCase();
    } else if (c.startsWith('~')) {
      const sub = c.slice(1);
      conditionMet = String(rawValue ?? '').toLowerCase().includes(sub.toLowerCase());
    } else if (c.startsWith('>')) {
      conditionMet = parseFloat(rawValue) > parseFloat(c.slice(1));
    } else if (c.startsWith('<')) {
      conditionMet = parseFloat(rawValue) < parseFloat(c.slice(1));
    }
  }

  return conditionMet ? trueVal : falseVal;
}

/** Accesso sicuro a proprietà dotted: "stream.quality" → ctx["stream"]["quality"] */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o != null && o[k] !== undefined ? o[k] : undefined), obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT BUILDER
// Costruisce il context AIOStreams-compatibile da uno stream upstream grezzo.
// Le chiavi sono dotted (stream.quality, service.name, …) per aderire
// esattamente alla sintassi dei template che gli utenti copiano da AIOStreams.
// ─────────────────────────────────────────────────────────────────────────────
function buildStreamContext(stream, addonConfig) {
  const rawTitle = stream.title || '';
  const rawName  = stream.name  || '';
  const addonName = addonConfig?.name || addonConfig?.slug || '';

  // ── Resolution ────────────────────────────────────────────────────────────
  const qualityMatch = rawTitle.match(/4K|2160p|1080p|720p|480p|360p/i);
  const quality = qualityMatch ? qualityMatch[0] : null;

  // ── Encode ────────────────────────────────────────────────────────────────
  const encodeMatch = rawTitle.match(/HEVC|x265|x264|AVC|AV1|XviD|H\.264|H\.265/i);
  const encode = encodeMatch ? encodeMatch[0] : null;

  // ── HDR ───────────────────────────────────────────────────────────────────
  const hdrMatch = rawTitle.match(/HDR10\+?|Dolby Vision|DV\b|HLG/i);
  const hdr = hdrMatch ? hdrMatch[0] : null;

  // ── Audio tags ────────────────────────────────────────────────────────────
  const audioTagMatches = rawTitle.match(/Atmos|TrueHD|DTS.?HD|DD\+?5\.1|DD\+?7\.1|EAC3|AC3|AAC|FLAC|PCM/gi);
  const audioTags = audioTagMatches ? [...new Set(audioTagMatches)] : [];

  // ── Audio channels ────────────────────────────────────────────────────────
  const chanMatch = rawTitle.match(/7\.1|5\.1|2\.0|2\.1|1\.0/);
  const audioChannels = chanMatch ? chanMatch[0] : null;

  // ── File size ─────────────────────────────────────────────────────────────
  const sizeMatch = rawTitle.match(/([\d.]+)\s*(GB|MB)/i);
  const sizeBytes = sizeMatch
    ? Math.round(parseFloat(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === 'GB' ? 1e9 : 1e6))
    : null;

  // ── Seeders ───────────────────────────────────────────────────────────────
  const seedersMatch = rawTitle.match(/👥\s*(\d+)|(\d+)\s*seed/i);
  const seeders = seedersMatch ? parseInt(seedersMatch[1] || seedersMatch[2], 10) : null;

  // ── Languages ─────────────────────────────────────────────────────────────
  // Supporta sia emoji flag che codici ISO
  const flagMatches = rawTitle.match(/[\u{1F1E0}-\u{1F1FF}]{2}/gu) || [];
  const isoMatches  = rawTitle.match(/\b(ITA|ENG|FRE|GER|SPA|POR|RUS|JPN|KOR|CHI|ARA)\b/gi) || [];
  const languages   = [...new Set([...isoMatches.map(l => l.toUpperCase())])];
  const languageEmojis = [...new Set(flagMatches)];

  // ── Source / Indexer ──────────────────────────────────────────────────────
  // Torrentio: ultima riga dopo \n; oppure ⚡ marker; oppure [label] nel name
  let source = null;
  const lightningMatch = rawTitle.match(/⚡\s*([^\n\[]+)/);
  const lastLineMatch  = rawTitle.includes('\n') ? rawTitle.split('\n').pop().trim() : null;
  const bracketMatch   = rawName.match(/\[([^\]]+)\]/);
  source = (lightningMatch?.[1] || lastLineMatch || bracketMatch?.[1] || '').trim() || null;

  // ── Service ───────────────────────────────────────────────────────────────
  // es: "[RD⚡] Torrentio" → service.shortName = "RD⚡", service.name = "Torrentio"
  const shortNameMatch = rawName.match(/\[([^\]]+)\]/);
  const shortName = shortNameMatch ? shortNameMatch[1] : null;
  // Il "service name" nel proxy è il nome dell'addon (Torrentio, Comet, ecc.)
  // oppure estratto dopo il bracket
  const serviceName = rawName.replace(/\[.*?\]\s*/, '').trim() || addonName || null;

  // ── Filename ──────────────────────────────────────────────────────────────
  const filename = stream.behaviorHints?.filename
    || rawTitle.split('\n')[0]?.trim()
    || null;

  // ── Stream type ───────────────────────────────────────────────────────────
  const streamType = stream.url?.startsWith('magnet') ? 'Torrent'
                   : stream.url?.startsWith('http')   ? 'HTTP'
                   : 'Debrid';

  // ── Debrid ────────────────────────────────────────────────────────────────
  const isDebrid = streamType === 'Debrid' || /real.?debrid|alldebrid|premiumize|torbox|debrid/i.test(rawName + rawTitle);
  const isCached = isDebrid; // Approssimazione: se debrid è quasi sempre cached

  // ── Visual tags ───────────────────────────────────────────────────────────
  const visualTags = [];
  if (hdr)      visualTags.push(hdr);
  if (/remux/i.test(rawTitle)) visualTags.push('Remux');
  if (/bluray/i.test(rawTitle)) visualTags.push('BluRay');
  if (/web.?dl/i.test(rawTitle)) visualTags.push('WEB-DL');
  if (/webrip/i.test(rawTitle)) visualTags.push('WEBRip');
  if (/dvdrip/i.test(rawTitle)) visualTags.push('DVDRip');

  // ── Regex matched (dal formatterEngine, se presente) ─────────────────────
  const regexMatched = stream._foxmatterRegex || null;

  // ─────────────────────────────────────────────────────────────────────────
  // Context AIOStreams-compatibile
  // Struttura: { stream: {...}, service: {...}, addon: {...} }
  // ─────────────────────────────────────────────────────────────────────────
  return {
    stream: {
      // Metadati base
      title:        rawTitle || null,
      name:         rawName  || null,
      filename,

      // Qualità video
      quality,
      resolution:   quality,           // alias
      encode,
      hdr,
      visualTags:   visualTags.length ? visualTags : null,

      // Audio
      audioTags:    audioTags.length ? audioTags : null,
      audioChannels,
      audio:        audioTags[0] || audioChannels || null,

      // Dimensioni
      size:         sizeBytes,         // intero bytes (usa ::bytes per formattare)
      seeders,

      // Lingue
      languages:    languages.length ? languages : null,
      languageEmojis: languageEmojis.length ? languageEmojis : null,

      // Tipo
      type:         streamType,
      library:      false,
      cached:       isCached,

      // Regex
      regexMatched,

      // Metadati media (generalmente null negli stream, ma supportati)
      year:    stream.year    || null,
      season:  stream.season  || null,
      episode: stream.episode || null,
    },
    service: {
      name:      serviceName,
      shortName: shortName || serviceName,
    },
    addon: {
      name: addonName,
    },
  };
}

module.exports = { parseTemplate, buildStreamContext };
