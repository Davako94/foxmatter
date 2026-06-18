// routes/proxy.js - Dynamic Stremio addon proxy endpoints
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { getUserConfig } = require('../services/configService');
const { fetchUpstreamStreams, fetchAddonManifest } = require('../services/stremioService');
const { formatStreams } = require('../services/formatterEngine');
const { getUserById } = require('../services/userService');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

const streamCache = new Map();
const CACHE_TTL = (parseInt(process.env.PROXY_CACHE_TTL) || 300) * 1000;

function getCacheKey(userId, addonSlug, type, id) {
  return `${userId}:${addonSlug}:${type}:${id}`;
}

function getFromCache(key) {
  const entry = streamCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    streamCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  if (streamCache.size > 1000) {
    const firstKey = streamCache.keys().next().value;
    streamCache.delete(firstKey);
  }
  streamCache.set(key, { data, timestamp: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIABILE EXTRACTOR — estrae le variabili reali da ogni stream upstream
// Supporta le stesse variabili documentate nella UI (quality, source, size, ecc.)
// ─────────────────────────────────────────────────────────────────────────────
function extractStreamVariables(stream, addonName) {
  const rawTitle = stream.title || '';
  const rawName  = stream.name  || '';

  // ── Resolution / Quality ──────────────────────────────────────────────────
  const qualityMatch = rawTitle.match(/4K|2160p|1080p|720p|480p|HDRip|DVDRIP/i);
  const quality = qualityMatch ? qualityMatch[0].toUpperCase() : '';

  // ── Source / Indexer ──────────────────────────────────────────────────────
  // Torrentio format: "source\ndetails"; Comet format: "[TB ⚡] Comet Addon"
  const sourceMatch = rawTitle.match(/\u26a1\s*([^\n\[]+)/) ||    // ⚡ StremThru / Real-Debrid
                      rawTitle.match(/\n([^\n]+)$/) ||             // ultima riga = source
                      rawName.match(/\[([^\]]+)\]/);               // [TB] prefix
  const source = sourceMatch ? sourceMatch[1].trim() : (addonName || '');

  // ── File size ─────────────────────────────────────────────────────────────
  const sizeMatch = rawTitle.match(/([\d.]+)\s*(GB|MB)/i);
  const size      = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : '';
  const sizeBytes = sizeMatch
    ? Math.round(parseFloat(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === 'GB' ? 1e9 : 1e6))
    : 0;

  // ── Seeders ───────────────────────────────────────────────────────────────
  const seedersMatch = rawTitle.match(/👥\s*(\d+)|(\d+)\s*seed/i);
  const seeders = seedersMatch ? (seedersMatch[1] || seedersMatch[2]) : '';

  // ── Codec / Encode ────────────────────────────────────────────────────────
  const encodeMatch = rawTitle.match(/HEVC|x265|x264|AVC|AV1|XVID/i);
  const encode = encodeMatch ? encodeMatch[0].toUpperCase() : '';

  // ── HDR / Visual tags ─────────────────────────────────────────────────────
  const hdr       = /HDR10\+?|DV|Dolby Vision/i.test(rawTitle) 
                    ? rawTitle.match(/HDR10\+?|DV|Dolby Vision/i)[0] : '';
  const is4k      = /4K|2160p/i.test(rawTitle);
  const is1080    = /1080p/i.test(rawTitle);

  // ── Audio ─────────────────────────────────────────────────────────────────
  const audioMatch = rawTitle.match(/Atmos|DTS.?HD|TrueHD|DD\+?5\.1|AAC|AC3|EAC3|FLAC/i);
  const audio = audioMatch ? audioMatch[0] : '';

  // ── Language flags ────────────────────────────────────────────────────────
  const langFlags = (rawTitle.match(/[\u{1F1E0}-\u{1F1FF}]{2}/gu) || []).join(' ');
  const langs     = langFlags || (rawTitle.match(/\b(ITA|ENG|FRE|GER|SPA|POR)\b/gi) || []).join(' ');

  // ── Filename (prima riga del title, oppure stream.behaviorHints.filename) ──
  const filename  = stream.behaviorHints?.filename || rawTitle.split('\n')[0] || '';

  // ── Stream type ───────────────────────────────────────────────────────────
  const streamType = stream.url?.startsWith('magnet') ? 'Torrent'
                   : stream.url?.startsWith('http')   ? 'HTTP'
                   : 'Debrid';

  // ── Addon name ────────────────────────────────────────────────────────────
  const addon = addonName || '';

  // ── Service / name label ──────────────────────────────────────────────────
  const serviceMatch = rawName.match(/\[([^\]]+)\]/);
  const service = serviceMatch ? serviceMatch[1] : rawName.split(' ')[0] || '';

  return {
    // Template principale
    title:      rawTitle,
    name:       rawName,
    addon,
    service,

    // Qualità
    quality,
    resolution: quality,          // alias
    encode,
    hdr,
    audio,

    // Dimensioni
    size,
    size_bytes: sizeBytes,

    // Rete / peer
    seeders,
    source,

    // Metadati file
    filename,

    // Flags
    is4k:       is4k  ? '1' : '',
    is1080:     is1080 ? '1' : '',
    langs,
    lang_flags: langFlags,

    // Tipo stream
    stream_type: streamType,
  };
}

// Template resolver: sostituisce {variabile} con il valore reale.
// Se la variabile non esiste → stringa vuota (non lascia il placeholder letterale).
function resolveTemplate(template, variables) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{([^{}]+)\}/g, (match, key) => {
    const v = variables[key.trim()];
    return v !== undefined && v !== null ? String(v) : '';
  });
}

// Applica titleTemplate e descriptionTemplate a ogni stream.
function applyTemplates(streams, addonConfig) {
  const { titleTemplate, descriptionTemplate, name: addonName, slug } = addonConfig;
  if (!titleTemplate && !descriptionTemplate) return streams;

  return streams.map(stream => {
    const vars = extractStreamVariables(stream, addonName || slug);

    return {
      ...stream,
      ...(titleTemplate       ? { name:  resolveTemplate(titleTemplate,       vars) || stream.name  } : {}),
      ...(descriptionTemplate ? { title: resolveTemplate(descriptionTemplate, vars) || stream.title } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  next();
});

// ─── GET /proxy/:userId/:addonSlug/manifest.json ───────────────────────────
router.get('/:userId/:addonSlug/manifest.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug } = req.params;

  const config = await getUserConfig(userId);
  if (!config) return res.status(404).json({ error: 'User configuration not found' });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig) return res.status(404).json({ error: 'Addon not found in user configuration' });

  const upstreamResult  = await fetchAddonManifest(addonConfig.transportUrl);
  const originalManifest = upstreamResult.success ? upstreamResult.manifest : {};

  // Il manifest proxy espone solo stream, nessun catalogo (puro formatter)
  const manifest = {
    id:          `foxmatter.proxy.${userId}.${addonSlug}`,
    name:        `${addonConfig.name || addonSlug} [Foxmatter]`,
    version:     originalManifest.version || '1.0.0',
    description: `Foxmatter proxy for ${addonConfig.name || addonSlug}. Streams formatted with custom templates.`,
    logo:        addonConfig.logo || originalManifest.logo || null,
    resources:   originalManifest.resources || ['stream'],
    types:       addonConfig.types?.length ? addonConfig.types : (originalManifest.types || ['movie', 'series']),
    idPrefixes:  addonConfig.idPrefixes?.length ? addonConfig.idPrefixes : (originalManifest.idPrefixes || ['tt']),
    catalogs:    [], // NESSUN catalogo: Foxmatter è un puro formatter, non un provider di contenuti
    behaviorHints: { configurable: false, configurationRequired: false },
  };

  logger.debug(`Serving manifest for ${userId}/${addonSlug}`);
  res.json(manifest);
}));

// ─── GET /proxy/:userId/:addonSlug/stream/:type/:id.json ───────────────────
router.get('/:userId/:addonSlug/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug, type, id } = req.params;

  const config = await getUserConfig(userId);
  if (!config) return res.json({ streams: [] });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl) return res.json({ streams: [] });
  if (addonConfig.enabled === false) return res.json({ streams: [] });

  const cacheKey = getCacheKey(userId, addonSlug, type, id);
  const cached   = getFromCache(cacheKey);
  if (cached) {
    res.setHeader('X-Foxmatter-Cache', 'HIT');
    return res.json(cached);
  }

  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);
  if (!upstream.success || !upstream.streams.length) return res.json({ streams: [] });

  // 1. Badge / regex globali dal formatterEngine
  let formatted = formatStreams(upstream.streams, config, addonConfig.id);

  // 2. Applica i template reali dell'utente (titleTemplate → name, descriptionTemplate → title)
  formatted = applyTemplates(formatted, addonConfig);

  const response = {
    streams: formatted,
    ...(upstream.raw?.cacheMaxAge ? { cacheMaxAge: upstream.raw.cacheMaxAge } : {}),
  };

  setCache(cacheKey, response);
  res.setHeader('X-Foxmatter-Cache', 'MISS');
  res.json(response);
}));

// ─── Master manifest (/proxy/:userId/manifest.json) ───────────────────────
router.get('/:userId/manifest.json', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const config = await getUserConfig(userId);
  if (!config) return res.status(404).json({ error: 'User not found' });

  const user = await getUserById(userId);

  const allIdPrefixes = new Set(['tt']);
  const allTypes      = new Set(['movie', 'series']);

  for (const addonConf of (config.addonConfigs || [])) {
    if (addonConf.enabled === false) continue;
    (addonConf.idPrefixes || []).forEach(p => allIdPrefixes.add(p));
    (addonConf.types      || []).forEach(t => allTypes.add(t));
  }

  const manifest = {
    id:          `foxmatter.master.${userId}`,
    name:        `Foxmatter [${user?.name || 'User'}]`,
    version:     '1.0.0',
    description: 'All your addons, formatted. Powered by Foxmatter.',
    logo:        `${BASE_URL}/logo.png`,
    resources:   ['stream'],
    types:       [...allTypes],
    idPrefixes:  [...allIdPrefixes],
    catalogs:    [],
    behaviorHints: { configurable: false },
  };

  res.json(manifest);
}));

// ─── Master stream endpoint (/proxy/:userId/stream/:type/:id.json) ─────────
router.get('/:userId/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, type, id } = req.params;

  const config = await getUserConfig(userId);
  if (!config || !config.addonConfigs?.length) return res.json({ streams: [] });

  const enabledAddons = config.addonConfigs.filter(a => a.enabled !== false && a.transportUrl);

  const results = await Promise.allSettled(
    enabledAddons.map(async (addonConf) => {
      const cacheKey = getCacheKey(userId, addonConf.slug, type, id);
      const cached   = getFromCache(cacheKey);
      if (cached) return cached.streams || [];

      const upstream = await fetchUpstreamStreams(addonConf.transportUrl, type, id);
      if (!upstream.success || !upstream.streams.length) return [];

      // Badge globali
      let formatted = formatStreams(upstream.streams, config, addonConf.id);

      // Template per-addon con variabili reali
      formatted = applyTemplates(formatted, addonConf);

      setCache(cacheKey, { streams: formatted });
      return formatted;
    })
  );

  const allStreams = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  res.json({ streams: allStreams });
}));

module.exports = router;
