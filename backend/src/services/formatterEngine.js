'use strict';

/**
 * formatterEngine.js
 * Arricchisce ogni stream upstream con dati strutturati pronti per il templateEngine.
 *
 * Fix rispetto alla versione precedente:
 *  - Flag emoji estratte dal title (🇮🇹 🇬🇧) OLTRE ai codici ISO
 *  - filename preso da behaviorHints.filename (priorità) o prima riga del title
 *  - seeders estratti da "👥 N" o "N seeds" nel title
 *  - audioChannels = stringa canali ("5.1"), audio = tag testuale ("Atmos")
 *  - serviceName estratto anche da "⚡ ServiceName" nel title
 */

function formatStreams(streams, config, addonId) {
  if (!Array.isArray(streams)) return [];
  return streams.map(stream => enrichStream(stream));
}

function enrichStream(stream) {
  const s     = { ...stream };
  const title = s.title || '';
  const name  = s.name  || '';

  // ── Anno ────────────────────────────────────────────────────────────────
  s.year = parseInt((title.match(/\b(19|20)\d{2}\b/) || [])[0]) || null;

  // ── Stagione / episodio ─────────────────────────────────────────────────
  s.season  = parseInt((title.match(/[Ss](\d{1,2})/) || [])[1]) || -1;
  s.episode = parseInt((title.match(/[Ee](\d{1,2})/) || [])[1]) || -1;

  // ── Qualità video ────────────────────────────────────────────────────────
  s.quality    = (title.match(/4K|2160p|1440p|1080p|720p|480p/i) || [])[0] || null;
  s.resolution = s.quality;

  // ── Codec ────────────────────────────────────────────────────────────────
  const encM = title.match(/\b(x265|HEVC|H\.?265|x264|H\.?264|AV1|XviD)\b/i);
  s.encode   = encM ? encM[0].toUpperCase().replace('H.265','HEVC').replace('H265','HEVC').replace('H.264','H264') : null;

  // ── HDR / Visual tags ────────────────────────────────────────────────────
  s.visualTags = [];
  if (/HDR10\+|HDR10Plus/i.test(title))  s.visualTags.push('HDR10+');
  else if (/HDR10/i.test(title))         s.visualTags.push('HDR10');
  else if (/HDR/i.test(title))           s.visualTags.push('HDR');
  if (/Dolby.?Vision|\bDV\b/i.test(title)) s.visualTags.push('DV');
  if (/HLG/i.test(title))               s.visualTags.push('HLG');
  if (/\bREMUX\b/i.test(title))         s.visualTags.push('Remux');
  if (/BluRay|Blu-Ray|BDRip/i.test(title)) s.visualTags.push('BluRay');
  else if (/WEB-DL|WEBDL/i.test(title)) s.visualTags.push('WEB-DL');
  else if (/WEBRip/i.test(title))       s.visualTags.push('WEBRip');

  s.hdr = s.visualTags.find(t => /HDR|DV/i.test(t)) || null;

  // ── Audio ────────────────────────────────────────────────────────────────
  // audio = descrizione principale; audioChannels = numero canali; audioTags = lista
  if      (/Dolby.?Atmos|Atmos/i.test(title)) s.audio = 'Atmos';
  else if (/TrueHD/i.test(title))             s.audio = 'TrueHD';
  else if (/DTS.?HD|DTS-HD/i.test(title))     s.audio = 'DTS-HD';
  else if (/\bDTS\b/i.test(title))            s.audio = 'DTS';
  else if (/EAC3|E-AC-3/i.test(title))        s.audio = 'EAC3';
  else if (/\bAAC\b/i.test(title))            s.audio = 'AAC';
  else if (/\bAC3\b|DD5/i.test(title))        s.audio = 'DD';
  else if (/\bFLAC\b/i.test(title))           s.audio = 'FLAC';
  else                                         s.audio = null;

  const chanM   = title.match(/\b(7\.1|5\.1|2\.1|2\.0|1\.0)\b/);
  s.audioChannels = chanM ? chanM[1] : null;

  s.audioTags = [];
  if (s.audio)        s.audioTags.push(s.audio);
  if (s.audioChannels && s.audioChannels !== s.audio) s.audioTags.push(s.audioChannels);

  // ── Dimensioni file ──────────────────────────────────────────────────────
  const sizeM = title.match(/([\d.]+)\s*(GB|MB|KB)/i);
  s.size = sizeM ? Math.round(parseFloat(sizeM[1]) * ({ GB: 1e9, MB: 1e6, KB: 1e3 }[sizeM[2].toUpperCase()])) : 0;

  // ── Seeders ──────────────────────────────────────────────────────────────
  const seedM = title.match(/👥\s*(\d+)|(\d+)\s*seed/i);
  s.seeders   = seedM ? parseInt(seedM[1] || seedM[2]) : null;

  // ── Lingue — priorità: flag emoji > codici ISO nel title ─────────────────
  const flagM = [...(title.matchAll(/[\u{1F1E0}-\u{1F1FF}]{2}/gu))].map(m => m[0]);
  const FLAG_MAP = {
    '🇮🇹': 'ITA', '🇬🇧': 'ENG', '🇫🇷': 'FRE', '🇩🇪': 'GER',
    '🇪🇸': 'SPA', '🇵🇹': 'POR', '🇷🇺': 'RUS', '🇯🇵': 'JPN',
    '🇰🇷': 'KOR', '🇨🇳': 'CHI', '🇸🇦': 'ARA',
  };

  s.languageEmojis = [...new Set(flagM)];
  s.languages      = [...new Set(
    flagM.map(f => FLAG_MAP[f]).filter(Boolean)
    .concat(
      /\b(ita|italian)\b/i.test(title)   ? ['ITA'] : [],
      /\b(eng|english)\b/i.test(title)   ? ['ENG'] : [],
      /\b(multi|multilang)\b/i.test(title) ? ['ITA','ENG'] : [],
    )
  )];

  // Se non abbiamo emoji ma abbiamo codici, aggiungiamo emoji
  if (!s.languageEmojis.length && s.languages.length) {
    const ISO_FLAG = { ITA:'🇮🇹', ENG:'🇬🇧', FRE:'🇫🇷', GER:'🇩🇪', SPA:'🇪🇸', POR:'🇵🇹', RUS:'🇷🇺' };
    s.languageEmojis = s.languages.map(l => ISO_FLAG[l]).filter(Boolean);
  }

  // ── Filename ─────────────────────────────────────────────────────────────
  // Priorità: behaviorHints.filename > prima riga del title (solo il nome file, no path)
  const rawFilename = s.behaviorHints?.filename || s.title?.split('\n')[0]?.trim() || null;
  s.filename = rawFilename ? rawFilename.replace(/^.*[\\/]/, '') : null;

  // ── Service name — da "⚡ Name" nel title o da stream.name bracket ────────
  const lightningM = title.match(/⚡\s*([^\n\[⚡]+?)(?:\n|$)/);
  const bracketM   = name.match(/\[([^\]]+)\]/);
  if (!s.serviceName && !s.service) {
    s.serviceName = (lightningM?.[1] || bracketM?.[1] || '').trim() || null;
  }

  // ── Regex badge ──────────────────────────────────────────────────────────
  s.regexMatched = extractRegexMatched(title);

  return s;
}

function extractRegexMatched(title) {
  const patterns = {
    'Remux T1':  /remux.*t1|remux.*tier1|remux.*tier\s*1/i,
    'Remux T2':  /remux.*t2|remux.*tier2|remux.*tier\s*2/i,
    'Remux T3':  /remux.*t3|remux.*tier3|remux.*tier\s*3/i,
    'Bluray T1': /bluray.*t1|bluray.*tier1|bdremux|bluray\s*t1/i,
    'Bluray T2': /bluray.*t2|bluray.*tier2|bluray\s*t2/i,
    'Bluray T3': /bluray.*t3|bluray.*tier3|bluray\s*t3/i,
    'Web T1':    /web.*t1|web.*tier1|webdl.*t1|web\s*t1/i,
    'Web T2':    /web.*t2|web.*tier2|webdl.*t2|web\s*t2/i,
    'Web T3':    /web.*t3|web.*tier3|webdl.*t3|web\s*t3/i,
    'Web Scene': /web.*scene|scene.*web|webscene/i,
  };
  for (const [key, pat] of Object.entries(patterns)) {
    if (pat.test(title)) return key;
  }
  return null;
}

module.exports = { formatStreams };
