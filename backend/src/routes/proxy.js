// routes/proxy.js
const express = require('express');
const router  = express.Router();
const { asyncHandler }           = require('../middleware/errorHandler');
const { getUserConfig }          = require('../services/configService');
const { fetchUpstreamStreams, fetchAddonManifest } = require('../services/stremioService');
const { formatStreams }           = require('../services/formatterEngine');
const { getUserById }             = require('../services/userService');
const { parseTemplate, buildStreamContext } = require('../services/templateEngine');
const { logger }                  = require('../utils/logger');

const BASE_URL  = process.env.BASE_URL || 'http://localhost:3001';
const CACHE_TTL = (parseInt(process.env.PROXY_CACHE_TTL) || 300) * 1000;
const streamCache = new Map();

function getCacheKey(userId, slug, type, id) { return `${userId}:${slug}:${type}:${id}`; }

function getFromCache(key) {
  const e = streamCache.get(key);
  if (!e) return null;
  if (Date.now() - e.timestamp > CACHE_TTL) { streamCache.delete(key); return null; }
  return e.data;
}

function setCache(key, data) {
  if (streamCache.size > 1000) streamCache.delete(streamCache.keys().next().value);
  streamCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Applica titleTemplate (→ stream.name) e descriptionTemplate (→ stream.title)
 * usando il parser AIOStreams-compatibile e il context dotted.
 */
function applyTemplates(streams, addonConfig) {
  const { titleTemplate, descriptionTemplate } = addonConfig;
  if (!titleTemplate && !descriptionTemplate) return streams;

  return streams.map(stream => {
    const ctx = buildStreamContext(stream, addonConfig);
    return {
      ...stream,
      ...(titleTemplate       ? { name:  parseTemplate(titleTemplate,       ctx) || stream.name  } : {}),
      ...(descriptionTemplate ? { title: parseTemplate(descriptionTemplate, ctx) || stream.title } : {}),
    };
  });
}

// ── CORS ──────────────────────────────────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  next();
});

// ── /proxy/:userId/:addonSlug/manifest.json ────────────────────────────────
router.get('/:userId/:addonSlug/manifest.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug } = req.params;
  const config      = await getUserConfig(userId);
  if (!config) return res.status(404).json({ error: 'User configuration not found' });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig) return res.status(404).json({ error: 'Addon not found in user configuration' });

  const up  = await fetchAddonManifest(addonConfig.transportUrl);
  const orig = up.success ? up.manifest : {};

  res.json({
    id:          `foxmatter.proxy.${userId}.${addonSlug}`,
    name:        `${addonConfig.name || addonSlug} [Foxmatter]`,
    version:     orig.version || '1.0.0',
    description: `Foxmatter proxy for ${addonConfig.name || addonSlug}.`,
    logo:        addonConfig.logo || orig.logo || null,
    resources:   orig.resources || ['stream'],
    types:       addonConfig.types?.length ? addonConfig.types : (orig.types || ['movie', 'series']),
    idPrefixes:  addonConfig.idPrefixes?.length ? addonConfig.idPrefixes : (orig.idPrefixes || ['tt']),
    catalogs:    [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
}));

// ── /proxy/:userId/:addonSlug/stream/:type/:id.json ───────────────────────
router.get('/:userId/:addonSlug/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug, type, id } = req.params;
  const config = await getUserConfig(userId);
  if (!config) return res.json({ streams: [] });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl || addonConfig.enabled === false) return res.json({ streams: [] });

  const cacheKey = getCacheKey(userId, addonSlug, type, id);
  const cached   = getFromCache(cacheKey);
  if (cached) { res.setHeader('X-Foxmatter-Cache', 'HIT'); return res.json(cached); }

  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);
  if (!upstream.success || !upstream.streams.length) return res.json({ streams: [] });

  let formatted = formatStreams(upstream.streams, config, addonConfig.id);
  formatted = applyTemplates(formatted, addonConfig);

  const response = {
    streams: formatted,
    ...(upstream.raw?.cacheMaxAge ? { cacheMaxAge: upstream.raw.cacheMaxAge } : {}),
  };
  setCache(cacheKey, response);
  res.setHeader('X-Foxmatter-Cache', 'MISS');
  res.json(response);
}));

// ── /proxy/:userId/manifest.json  (master) ────────────────────────────────
router.get('/:userId/manifest.json', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const config = await getUserConfig(userId);
  if (!config) return res.status(404).json({ error: 'User not found' });

  const user = await getUserById(userId);
  const allPrefixes = new Set(['tt']);
  const allTypes    = new Set(['movie', 'series']);

  for (const a of (config.addonConfigs || [])) {
    if (a.enabled === false) continue;
    (a.idPrefixes || []).forEach(p => allPrefixes.add(p));
    (a.types      || []).forEach(t => allTypes.add(t));
  }

  res.json({
    id:          `foxmatter.master.${userId}`,
    name:        `Foxmatter [${user?.name || 'User'}]`,
    version:     '1.0.0',
    description: 'All your addons, formatted. Powered by Foxmatter.',
    logo:        `${BASE_URL}/logo.png`,
    resources:   ['stream'],
    types:       [...allTypes],
    idPrefixes:  [...allPrefixes],
    catalogs:    [],
    behaviorHints: { configurable: false },
  });
}));

// ── /proxy/:userId/stream/:type/:id.json  (master) ────────────────────────
router.get('/:userId/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, type, id } = req.params;
  const config = await getUserConfig(userId);
  if (!config?.addonConfigs?.length) return res.json({ streams: [] });

  const results = await Promise.allSettled(
    config.addonConfigs
      .filter(a => a.enabled !== false && a.transportUrl)
      .map(async (addonConf) => {
        const cacheKey = getCacheKey(userId, addonConf.slug, type, id);
        const cached   = getFromCache(cacheKey);
        if (cached) return cached.streams || [];

        const upstream = await fetchUpstreamStreams(addonConf.transportUrl, type, id);
        if (!upstream.success || !upstream.streams.length) return [];

        let formatted = formatStreams(upstream.streams, config, addonConf.id);
        formatted = applyTemplates(formatted, addonConf);

        setCache(cacheKey, { streams: formatted });
        return formatted;
      })
  );

  res.json({
    streams: results.filter(r => r.status === 'fulfilled').flatMap(r => r.value),
  });
}));

module.exports = router;
