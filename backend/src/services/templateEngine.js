'use strict';

/**
 * templateEngine.js
 *
 * Parser AIOStreams-compatibile. Gestisce:
 *   {prop}
 *   {prop::exists["T"||"F"]}
 *   {prop::>0["T"||"F"]}
 *   {prop::=val["T"||"F"]}
 *   {prop::~sub["T"||"F"]}
 *   {prop::bytes}
 *   {prop::title}
 *   {a::exists::or::b::exists["T"||"F"]}
 *
 * Usato da proxy.js lato Node.  La stessa logica è copiata inline in index.html.
 */

function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    // ::or:: — chain di fallback tra proprietà
    if (expression.includes('::or::')) {
      const orParts = expression.split('::or::');
      for (let i = 0; i < orParts.length; i++) {
        const result = evalExpr(orParts[i].trim(), ctx);
        if (result !== '' && result !== null && result !== undefined) return String(result);
        if (i === orParts.length - 1) return String(result ?? '');
      }
      return '';
    }

    const result = evalExpr(expression.trim(), ctx);
    return result !== null && result !== undefined ? String(result) : '';
  });
}

function evalExpr(expr, ctx) {
  const parts     = expr.split('::');
  const propPath  = parts[0].trim();
  const rawValue  = getPath(ctx, propPath);

  // Nessun modificatore → interpolazione diretta
  if (parts.length === 1) {
    if (Array.isArray(rawValue)) return rawValue.join(' ');
    return rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
  }

  // Tutto ciò che segue il primo :: è la stringa dei modificatori
  const modifiers = parts.slice(1).join('::');

  // Cerca il blocco output ["trueVal"||"falseVal"] IN CODA ([\s\S] cattura emoji)
  const outputMatch = modifiers.match(/\["([\s\S]*?)"\s*\|\|\s*"([\s\S]*?)"\]\s*$/);

  let trueVal, falseVal, condStr;

  if (outputMatch) {
    trueVal  = outputMatch[1];
    falseVal = outputMatch[2];
    // La condizione è tutto ciò che precede il blocco output
    condStr  = modifiers.slice(0, modifiers.lastIndexOf(outputMatch[0])).replace(/::$/, '').trim();
  } else {
    // Nessun blocco output → trasformazione pura
    condStr  = modifiers;
    trueVal  = Array.isArray(rawValue) ? rawValue.join(' ')
             : (rawValue !== null && rawValue !== undefined ? String(rawValue) : '');
    falseVal = '';
  }

  // ── Trasformazioni non-condizionali ─────────────────────────────────────
  if (condStr === 'bytes') {
    const b = parseFloat(rawValue);
    if (isNaN(b) || b === 0) return falseVal;
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
    return b + ' B';
  }
  if (condStr === 'title') return String(rawValue ?? '').toUpperCase();
  if (condStr === 'join')  return Array.isArray(rawValue) ? rawValue.join(' ') : String(rawValue ?? '');

  // ── Valutazione condizionale ─────────────────────────────────────────────
  let condMet = false;
  // condStr può essere "exists", ">0", "=foo", "~bar", oppure "" se era solo ["T"||"F"]
  const condParts = condStr.split('::').filter(Boolean);

  if (condParts.length === 0) {
    // {prop::["T"||"F"]} — truthy se il valore esiste
    const v = rawValue;
    condMet = v !== undefined && v !== null && v !== '' && v !== 0 && v !== false
           && !(Array.isArray(v) && v.length === 0);
  } else {
    for (const cond of condParts) {
      const c = cond.trim();
      const v = rawValue;

      if (c === 'exists') {
        condMet = v !== undefined && v !== null && v !== '' && v !== 0 && v !== false
               && !(Array.isArray(v) && v.length === 0);
      } else if (c === 'istrue'  || c === 'true')  { condMet = Boolean(v); }
      else if   (c === 'isfalse' || c === 'false') { condMet = !v; }
      else if   (c.startsWith('>=')) { condMet = parseFloat(v) >= parseFloat(c.slice(2)); }
      else if   (c.startsWith('<=')) { condMet = parseFloat(v) <= parseFloat(c.slice(2)); }
      else if   (c.startsWith('>'))  { condMet = parseFloat(v) >  parseFloat(c.slice(1)); }
      else if   (c.startsWith('<'))  { condMet = parseFloat(v) <  parseFloat(c.slice(1)); }
      else if   (c.startsWith('='))  { condMet = String(v ?? '').toLowerCase() === c.slice(1).toLowerCase(); }
      else if   (c.startsWith('~'))  { condMet = String(v ?? '').toLowerCase().includes(c.slice(1).toLowerCase()); }
    }
  }

  return condMet ? trueVal : falseVal;
}

function getPath(obj, path) {
  return path.split('.').reduce(
    (o, k) => (o != null && o[k] !== undefined ? o[k] : undefined),
    obj
  );
}

/**
 * buildStreamContext — costruisce il context dotted compatibile con AIOStreams
 * a partire dallo stream già arricchito da formatterEngine.js.
 *
 * formatterEngine scrive direttamente su stream.quality, stream.encode, ecc.
 * Qui li spostiamo nel namespace dotted { stream: { quality, ... }, service: { name } }.
 */
function buildStreamContext(stream, addonConfig) {
  // formatterEngine.js mette i dati direttamente sull'oggetto stream (flat)
  // li esponiamo come sub-oggetto "stream.*" mantenendo anche i valori flat
  // così funzionano sia {quality} che {stream.quality}

  const svc = stream.serviceName || stream.service || addonConfig?.name || '';

  return {
    // Namespace dotted (AIOStreams-compatibile)
    stream: {
      // Raw
      title:          stream.title          ?? null,
      name:           stream.name           ?? null,
      filename:       stream.filename       || stream.title?.split('\n')[0]?.trim() || null,

      // Qualità video
      quality:        stream.quality        ?? null,
      resolution:     stream.resolution     ?? stream.quality ?? null,
      encode:         stream.encode         ?? null,
      hdr:            stream.hdr            ?? (stream.visualTags?.find(t => /hdr|dv/i.test(t)) || null),
      visualTags:     stream.visualTags     ?? null,

      // Audio
      audio:          stream.audio          ?? null,
      audioChannels:  stream.audioChannels  ?? null,
      audioTags:      stream.audioTags      ?? null,

      // Dimensioni / rete
      size:           stream.size           ?? 0,    // bytes — usa ::bytes per formattare
      seeders:        stream.seeders        ?? null,

      // Lingue
      languages:      stream.languages      ?? null,
      languageEmojis: stream.languageEmojis ?? null,

      // Tipo
      type:           stream.type           ?? (stream.url?.startsWith('magnet') ? 'Torrent' : 'Debrid'),
      cached:         stream.cached         ?? false,
      library:        stream.library        ?? false,

      // Regex badge (da formatterEngine)
      regexMatched:   stream.regexMatched   ?? null,

      // Metadati media
      year:           stream.year           ?? null,
      season:         (stream.season  != null && stream.season  > 0) ? stream.season  : null,
      episode:        (stream.episode != null && stream.episode > 0) ? stream.episode : null,
    },

    service: {
      name:      svc,
      shortName: stream.serviceShortName || svc.split(' ')[0] || svc,
    },

    addon: {
      name: addonConfig?.name || addonConfig?.slug || '',
    },
  };
}

module.exports = { parseTemplate, buildStreamContext };
