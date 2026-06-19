'use strict';

/**
 * templateEngine.js — Parser AIOStreams-compatibile
 *
 * Sintassi supportata:
 *   {prop}
 *   {prop::exists["T"||"F"]}   {prop::>0["T"||"F"]}   {prop::=val["T"||"F"]}
 *   {prop::~sub["T"||"F"]}     {prop::bytes}           {prop::title}
 *   {a::exists::or::b::exists["T"||"F"]}
 *
 * Fix rispetto alla versione precedente:
 *   - safeParse NON usa .trim() come segnale di fallback (trueVal "" è valido)
 *   - Array renderizzati con join(' ') quando non c'è output block
 */

function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
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
  const parts    = expr.split('::');
  const propPath = parts[0].trim();
  const rawValue = getPath(ctx, propPath);

  // Nessun modificatore → interpolazione diretta
  if (parts.length === 1) {
    if (Array.isArray(rawValue)) return rawValue.join(' ');
    return rawValue !== undefined && rawValue !== null ? String(rawValue) : '';
  }

  const modifiers   = parts.slice(1).join('::');
  const outputMatch = modifiers.match(/\["([\s\S]*?)"\s*\|\|\s*"([\s\S]*?)"\]\s*$/);

  let trueVal, falseVal, condStr;

  if (outputMatch) {
    trueVal  = outputMatch[1];   // può essere "" — è intenzionale
    falseVal = outputMatch[2];
    condStr  = modifiers.slice(0, modifiers.lastIndexOf(outputMatch[0])).replace(/::$/, '').trim();
  } else {
    condStr  = modifiers;
    trueVal  = Array.isArray(rawValue) ? rawValue.join(' ')
             : (rawValue !== null && rawValue !== undefined ? String(rawValue) : '');
    falseVal = '';
  }

  // Trasformazioni non-condizionali
  if (condStr === 'bytes') {
    const b = parseFloat(rawValue);
    if (isNaN(b) || b === 0) return '';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
    return b + ' B';
  }
  if (condStr === 'title') return String(rawValue ?? '').toUpperCase();
  if (condStr === 'join')  return Array.isArray(rawValue) ? rawValue.join(' ') : String(rawValue ?? '');

  // Valutazione condizionale
  let condMet    = false;
  const condParts = condStr.split('::').filter(Boolean);

  if (condParts.length === 0) {
    condMet = isTruthy(rawValue);
  } else {
    for (const cond of condParts) {
      const c = cond.trim();
      const v = rawValue;
      if      (c === 'exists')               condMet = isTruthy(v);
      else if (c === 'istrue'  || c === 'true')  condMet = Boolean(v);
      else if (c === 'isfalse' || c === 'false') condMet = !v;
      else if (c.startsWith('>=')) condMet = parseFloat(v) >= parseFloat(c.slice(2));
      else if (c.startsWith('<=')) condMet = parseFloat(v) <= parseFloat(c.slice(2));
      else if (c.startsWith('>'))  condMet = parseFloat(v) >  parseFloat(c.slice(1));
      else if (c.startsWith('<'))  condMet = parseFloat(v) <  parseFloat(c.slice(1));
      else if (c.startsWith('='))  condMet = String(v ?? '').toLowerCase() === c.slice(1).toLowerCase();
      else if (c.startsWith('~'))  condMet = String(v ?? '').toLowerCase().includes(c.slice(1).toLowerCase());
    }
  }

  return condMet ? trueVal : falseVal;
}

function isTruthy(v) {
  if (v === undefined || v === null || v === false || v === 0) return false;
  if (typeof v === 'string' && v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function getPath(obj, path) {
  return path.split('.').reduce(
    (o, k) => (o != null && o[k] !== undefined ? o[k] : undefined),
    obj
  );
}

/**
 * buildStreamContext
 * Costruisce il context { stream, service, addon } dal flat stream di formatterEngine.
 */
function buildStreamContext(stream, addonConfig) {
  const svc = stream.serviceName || stream.service || addonConfig?.name || '';

  return {
    stream: {
      title:          stream.title          ?? null,
      name:           stream.name           ?? null,
      filename:       stream.filename       ?? null,
      quality:        stream.quality        ?? null,
      resolution:     stream.resolution     ?? stream.quality ?? null,
      encode:         stream.encode         ?? null,
      hdr:            stream.hdr            ?? null,
      visualTags:     stream.visualTags?.length ? stream.visualTags : null,
      audio:          stream.audio          ?? null,
      audioChannels:  stream.audioChannels  ?? null,
      audioTags:      stream.audioTags?.length  ? stream.audioTags  : null,
      size:           stream.size           ?? 0,
      seeders:        stream.seeders        ?? null,
      languages:      stream.languages?.length  ? stream.languages  : null,
      languageEmojis: stream.languageEmojis?.length ? stream.languageEmojis : null,
      type:           stream.url?.startsWith('magnet') ? 'Torrent' : 'Debrid',
      cached:         stream.cached         ?? false,
      library:        stream.library        ?? false,
      regexMatched:   stream.regexMatched   ?? null,
      year:           stream.year           ?? null,
      season:         (stream.season  > 0)  ? stream.season  : null,
      episode:        (stream.episode > 0)  ? stream.episode : null,
    },
    service: {
      name:      svc || null,
      shortName: (stream.serviceShortName || svc.split(' ')[0] || svc) || null,
    },
    addon: {
      name: addonConfig?.name || addonConfig?.slug || null,
    },
  };
}

module.exports = { parseTemplate, buildStreamContext };
