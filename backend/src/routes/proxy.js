// routes/proxy.js - Dynamic Stremio addon proxy endpoints
// This IS the generated addon that users install in Stremio
//
// URL structure:
//   /proxy/:userId/:addonSlug/manifest.json
//   /proxy/:userId/:addonSlug/stream/:type/:id.json
//   /proxy/:userId/meta/:type/:id.json  (pass-through)
//   /proxy/:userId/catalog/:type/:id.json  (pass-through)
//
// The :userId is used to load their configuration.
// The :addonSlug identifies which upstream addon to call.

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { getUserConfig } = require('../services/configService');
const { fetchUpstreamStreams, fetchAddonManifest } = require('../services/stremioService');
const { formatStreams } = require('../services/formatterEngine');
const { getUserById } = require('../services/userService');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// Simple in-memory cache for upstream responses
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
  // Basic LRU-lite: evict old entries if too many
  if (streamCache.size > 1000) {
    const firstKey = streamCache.keys().next().value;
    streamCache.delete(firstKey);
  }
  streamCache.set(key, { data, timestamp: Date.now() });
}

// ─── Set CORS headers for all proxy routes (Stremio requires this) ─────────
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
  if (!config) {
    return res.status(404).json({ error: 'User configuration not found' });
  }

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig) {
    return res.status(404).json({ error: 'Addon not found in user configuration' });
  }

  // Fetch the original manifest to inherit its capabilities
  const upstreamManifest = await fetchAddonManifest(addonConfig.transportUrl);
  const originalManifest = upstreamManifest.success ? upstreamManifest.manifest : {};

  // Build our proxy manifest - inherits everything from upstream
  // but changes the URL to point to our proxy
  const manifest = {
    id: `foxmatter.proxy.${userId}.${addonSlug}`,
    name: `${addonConfig.name || addonSlug} [Formatted]`,
    version: '1.0.0',
    description: `Foxmatter proxy for ${addonConfig.name || addonSlug}. Formatted streams with custom badges and templates.`,
    logo: addonConfig.logo || originalManifest.logo || null,

    // Inherit these from original addon - CRITICAL for Stremio to route correctly
    resources: originalManifest.resources || ['stream'],
    types: originalManifest.types || ['movie', 'series'],
    idPrefixes: originalManifest.idPrefixes || ['tt'],
    catalogs: [], // We don't serve catalogs - pass-through only

    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  };

  logger.debug(`Serving manifest for ${userId}/${addonSlug}`);
  res.json(manifest);
}));

// ─── GET /proxy/:userId/:addonSlug/stream/:type/:id.json ───────────────────
router.get('/:userId/:addonSlug/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug, type, id } = req.params;

  logger.info(`Stream request: user=${userId} addon=${addonSlug} type=${type} id=${id}`);

  // Load user config
  const config = await getUserConfig(userId);
  if (!config) {
    return res.json({ streams: [] });
  }

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl) {
    logger.warn(`No transport URL for addon ${addonSlug}`);
    return res.json({ streams: [] });
  }

  // Check cache
  const cacheKey = getCacheKey(userId, addonSlug, type, id);
  const cached = getFromCache(cacheKey);
  if (cached) {
    logger.debug(`Cache hit: ${cacheKey}`);
    res.setHeader('X-Foxmatter-Cache', 'HIT');
    return res.json(cached);
  }

  // Fetch from upstream addon
  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);

  if (!upstream.success) {
    logger.warn(`Upstream failed for ${addonSlug}: ${upstream.error}`);
    return res.json({ streams: [] });
  }

  // Apply formatting
  const formattedStreams = formatStreams(
    upstream.streams,
    config,        // Full user config (has globalBadges + addonConfigs)
    addonConfig.id // The addon ID for per-addon config lookup
  );

  const response = {
    streams: formattedStreams,
    // Preserve any extra fields from upstream response
    ...(upstream.raw?.cacheMaxAge && { cacheMaxAge: upstream.raw.cacheMaxAge }),
  };

  setCache(cacheKey, response);
  res.setHeader('X-Foxmatter-Cache', 'MISS');
  res.setHeader('X-Foxmatter-Streams', String(formattedStreams.length));
  res.json(response);
}));

// ─── Master manifest: single addon that lists ALL user's configured addons ─
// /proxy/:userId/manifest.json - Install ONE addon, get all formatted streams
router.get('/:userId/manifest.json', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const config = await getUserConfig(userId);
  if (!config) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = await getUserById(userId);

  // Aggregate idPrefixes from all configured addons
  const allIdPrefixes = new Set(['tt']); // Always include tt (IMDb)
  const allTypes = new Set(['movie', 'series']);
  
  for (const addonConf of (config.addonConfigs || [])) {
    (addonConf.idPrefixes || []).forEach(p => allIdPrefixes.add(p));
    (addonConf.types || []).forEach(t => allTypes.add(t));
  }

  const manifest = {
    id: `foxmatter.master.${userId}`,
    name: `Foxmatter [${user?.name || 'User'}]`,
    version: '1.0.0',
    description: `All your addons, formatted. Powered by Foxmatter.`,
    logo: `${BASE_URL}/logo.png`,

    resources: ['stream'],
    types: [...allTypes],
    idPrefixes: [...allIdPrefixes],
    catalogs: [],

    behaviorHints: {
      configurable: false,
    },
  };

  res.json(manifest);
}));

// ─── Master stream endpoint ────────────────────────────────────────────────
// /proxy/:userId/stream/:type/:id.json
// Calls ALL configured addons in parallel and merges results
router.get('/:userId/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, type, id } = req.params;

  const config = await getUserConfig(userId);
  if (!config || !config.addonConfigs?.length) {
    return res.json({ streams: [] });
  }

  logger.info(`Master stream: user=${userId} type=${type} id=${id} addons=${config.addonConfigs.length}`);

  // Call all addons in parallel
  const results = await Promise.allSettled(
    config.addonConfigs
      .filter(a => a.enabled !== false && a.transportUrl)
      .map(async (addonConf) => {
        const cacheKey = getCacheKey(userId, addonConf.slug, type, id);
        const cached = getFromCache(cacheKey);
        
        if (cached) return cached.streams || [];
        
        const upstream = await fetchUpstreamStreams(addonConf.transportUrl, type, id);
        if (!upstream.success) return [];
        
        const formatted = formatStreams(upstream.streams, config, addonConf.id);
        setCache(cacheKey, { streams: formatted });
        return formatted;
      })
  );

  // Merge all streams, preserve order (first addon's streams first)
  const allStreams = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  res.json({ streams: allStreams });
}));

module.exports = router;