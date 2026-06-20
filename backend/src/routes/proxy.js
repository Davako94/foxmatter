'use strict';

const express = require('express');
const router  = express.Router();
const { asyncHandler }           = require('../middleware/errorHandler');
const { getUserConfig }          = require('../services/configService');
const { fetchUpstreamStreams, fetchAddonManifest } = require('../services/stremioService');
const { formatStreams }           = require('../services/formatterEngine');
const { getUserById }             = require('../services/userService');
const { logger }                  = require('../utils/logger');
const { createFormatter }         = require('../services/aiostreamFormatter/formatterFactory');
const { sortStreams, limitResults } = require('../services/aiostreamFormatter/streamRules');

const BASE_URL  = process.env.BASE_URL || 'http://localhost:3001';
const CACHE_TTL = (parseInt(process.env.PROXY_CACHE_TTL) || 300) * 1000;
const streamCache = new Map();
const configCache = new Map();
const manifestCache = new Map();
const CONFIG_CACHE_TTL = (parseInt(process.env.PROXY_CONFIG_CACHE_TTL) || 60) * 1000;
const MANIFEST_CACHE_TTL = (parseInt(process.env.PROXY_MANIFEST_CACHE_TTL) || 600) * 1000;

const PARSE_FAILED = Symbol('PARSE_FAILED');

function getCacheKey(u, s, t, i) { return `${u}:${s}:${t}:${i}`; }
function getKey(a, b) { return `${a}:${b}`; }
function getFromCache(key) {
  const e = streamCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { streamCache.delete(key); return null; }
  return e.data;
}
function setCache(key, data) {
  if (streamCache.size > 1000) streamCache.delete(streamCache.keys().next().value);
  streamCache.set(key, { data, ts: Date.now() });
}
function getTimedCache(map, key, ttl) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > ttl) { map.delete(key); return null; }
  return e.data;
}
function setTimedCache(map, key, data) {
  if (map.size > 1000) map.delete(map.keys().next().value);
  map.set(key, { data, ts: Date.now() });
}
async function getCachedConfig(userId) {
  const cached = getTimedCache(configCache, userId, CONFIG_CACHE_TTL);
  if (cached) return cached;
  const config = await getUserConfig(userId);
  if (config) setTimedCache(configCache, userId, config);
  return config;
}
async function getCachedManifest(transportUrl) {
  const key = transportUrl.replace(/\/$/, '');
  const cached = getTimedCache(manifestCache, key, MANIFEST_CACHE_TTL);
  if (cached) return cached;
  const manifest = await fetchAddonManifest(transportUrl);
  if (manifest?.success) setTimedCache(manifestCache, key, manifest);
  return manifest;
}

function buildProxyManifest(userId, addonSlug, addonConfig, orig = {}, baseUrl = BASE_URL) {
  const addonName = addonConfig.name || addonSlug;
  return {
    id: `foxmatter.proxy.${userId}.${addonSlug}`,
    name: `${addonName} [Foxmatter]`,
    version: orig.version || '1.0.0',
    description: `Foxmatter proxy for ${addonName}.`,
    logo: addonConfig.logo || orig.logo || orig.icon || orig.background || null,
    resources: ['stream'],
    types: addonConfig.types?.length ? addonConfig.types : (orig.types || ['movie', 'series']),
    idPrefixes: addonConfig.idPrefixes?.length ? addonConfig.idPrefixes : (orig.idPrefixes || ['tt']),
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
    transportUrl: `${baseUrl}/proxy/${userId}/${addonSlug}/manifest.json`,
  };
}

function applyTemplates(streams, addonConfig) {
  const globalTemplate = addonConfig?.globalTemplate || {};
  const titleTemplate = addonConfig?.titleTemplate || globalTemplate.titleTemplate;
  const descriptionTemplate = addonConfig?.descriptionTemplate || globalTemplate.descriptionTemplate;
  if (!titleTemplate && !descriptionTemplate) return streams;

  const formatter = createFormatter({
    userData: {
      formatter: {
        id: 'custom',
        definition: {
          name: titleTemplate || '',
          description: descriptionTemplate || '',
        },
      },
    },
  });

  return streams.map(stream => {
    const rendered = formatter.format(stream, addonConfig, globalTemplate);
    return {
      ...stream,
      name: rendered.name || stream.name,
      title: rendered.description || stream.title,
    };
  });
}

function applyStreamRules(streams, config, addonConfig) {
  const settings = config?.settings || {};
  let out = Array.isArray(streams) ? [...streams] : [];
  out = sortStreams(out, { criteria: settings.sortRules || [] });
  if (settings.maxResultsPerQuality > 0) {
    const grouped = new Map();
    const limited = [];
    for (const stream of out) {
      const q = stream.quality || 'unknown';
      const count = grouped.get(q) || 0;
      if (count < settings.maxResultsPerQuality) {
        grouped.set(q, count + 1);
        limited.push(stream);
      }
    }
    out = limited;
  }
  out = limitResults(out, { maxResults: settings.maxResultsPerAddon > 0 ? settings.maxResultsPerAddon : null });
  return out;
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
  const config = await getCachedConfig(userId);
  if (!config) return res.status(404).json({ error: 'User configuration not found' });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig) return res.status(404).json({ error: 'Addon not found' });

  const up   = await getCachedManifest(addonConfig.transportUrl);
  const orig = up.success ? up.manifest : {};

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(buildProxyManifest(userId, addonSlug, addonConfig, orig));
}));

// ── /proxy/:userId/:addonSlug/stream/:type/:id.json ───────────────────────
router.get('/:userId/:addonSlug/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug, type, id } = req.params;
  const config = await getCachedConfig(userId);
  if (!config) return res.json({ streams: [] });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl || addonConfig.enabled === false) return res.json({ streams: [] });

  const cacheKey = getCacheKey(userId, addonSlug, type, id);
  const cached   = getFromCache(cacheKey);
  if (cached) { res.setHeader('X-Foxmatter-Cache', 'HIT'); return res.json(cached); }

  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);
  if (!upstream.success || !upstream.streams.length) return res.json({ streams: [] });

  let formatted = formatStreams(upstream.streams, config, addonConfig.id);
  formatted = applyTemplates(formatted, { ...addonConfig, globalTemplate: config.globalTemplate || {} });
  formatted = applyStreamRules(formatted, config, addonConfig);

  const response = {
    streams: formatted,
    ...(upstream.raw?.cacheMaxAge ? { cacheMaxAge: upstream.raw.cacheMaxAge } : {}),
  };
  setCache(cacheKey, response);
  res.setHeader('X-Foxmatter-Cache', 'MISS');
  res.json(response);
}));

// ── /proxy/:userId/manifest.json (master) ────────────────────────────────
router.get('/:userId/manifest.json', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const config = await getCachedConfig(userId);
  if (!config) return res.status(404).json({ error: 'User not found' });

  const user     = await getUserById(userId);
  const prefixes = new Set(['tt']);
  const types    = new Set(['movie', 'series']);
  const orderedAddons = [...(config.addonConfigs || [])].sort((a, b) => {
    const order = config?.settings?.addonOrder || [];
    const ai = order.findIndex(v => String(v).toLowerCase() === String(a.slug || a.addonId || a.id || '').toLowerCase());
    const bi = order.findIndex(v => String(v).toLowerCase() === String(b.slug || b.addonId || b.id || '').toLowerCase());
    const safeAi = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const safeBi = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (safeAi !== safeBi) return safeAi - safeBi;
    return String(a.name || a.slug || '').localeCompare(String(b.name || b.slug || ''));
  });

  for (const a of orderedAddons) {
    if (a.enabled === false) continue;
    (a.idPrefixes || []).forEach(p => prefixes.add(p));
    (a.types      || []).forEach(t => types.add(t));
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    id: `foxmatter.master.${userId}`,
    name: `Foxmatter [${user?.name || 'User'}]`,
    version: '1.0.0',
    description: 'All your addons, formatted. Powered by Foxmatter.',
    logo: `${BASE_URL}/logo.png`,
    resources: ['stream'],
    types: [...types],
    idPrefixes: [...prefixes],
    catalogs: [],
    behaviorHints: { configurable: false },
  });
}));

// ── /proxy/:userId/stream/:type/:id.json (master) ─────────────────────────
router.get('/:userId/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, type, id } = req.params;
  const config = await getCachedConfig(userId);
  if (!config?.addonConfigs?.length) return res.json({ streams: [] });

  const results = await Promise.allSettled(
    [...config.addonConfigs]
      .filter(a => a.enabled !== false && a.transportUrl)
      .map(async (addonConf) => {
        const cacheKey = getCacheKey(userId, addonConf.slug, type, id);
        const cached   = getFromCache(cacheKey);
        if (cached) return cached.streams || [];

        const upstream = await fetchUpstreamStreams(addonConf.transportUrl, type, id);
        if (!upstream.success || !upstream.streams.length) return [];

        let formatted = formatStreams(upstream.streams, config, addonConf.id);
        formatted = applyTemplates(formatted, { ...addonConf, globalTemplate: config.globalTemplate || {} });
        formatted = applyStreamRules(formatted, config, addonConf);

        setCache(cacheKey, { streams: formatted });
        return formatted;
      })
  );

  res.json({
    streams: results.filter(r => r.status === 'fulfilled').flatMap(r => r.value),
  });
}));

module.exports = router;
