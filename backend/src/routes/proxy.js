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

// Helper per risolvere i template stringhe in stile aiostreams
function resolveTemplate(template, variables) {
  if (!template) return null;
  return template.replace(/{([^{}]+)}/g, (match, key) => {
    const cleanKey = key.trim();
    return variables[cleanKey] !== undefined ? variables[cleanKey] : match;
  });
}

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

  const upstreamManifest = await fetchAddonManifest(addonConfig.transportUrl);
  const originalManifest = upstreamManifest.success ? upstreamManifest.manifest : {};

  // Variabili iniettabili nei template del manifest dell'Addon
  const manifestVars = {
    addon: addonConfig.name || originalManifest.name || addonSlug,
    name: originalManifest.name || addonConfig.name || addonSlug,
    version: originalManifest.version || '1.0.0',
    description: originalManifest.description || ''
  };

  // Se l'utente ha definito un nameTemplate a livello Addon lo risolviamo, altrimenti fallback classico
  const customName = addonConfig.nameTemplate 
    ? resolveTemplate(addonConfig.nameTemplate, manifestVars) 
    : `${addonConfig.name || addonSlug} [Formatted]`;

  const customDesc = addonConfig.descriptionTemplate
    ? resolveTemplate(addonConfig.descriptionTemplate, manifestVars)
    : `Foxmatter proxy for ${addonConfig.name || addonSlug}. Formatted streams with custom badges and templates.`;

  const manifest = {
    id: `foxmatter.proxy.${userId}.${addonSlug}`,
    name: customName,
    version: originalManifest.version || '1.0.0',
    description: customDesc,
    logo: addonConfig.logo || originalManifest.logo || null,
    resources: originalManifest.resources || ['stream'],
    types: originalManifest.types || ['movie', 'series'],
    idPrefixes: originalManifest.idPrefixes || ['tt'],
    catalogs: [],
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

  const config = await getUserConfig(userId);
  if (!config) return res.json({ streams: [] });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl) return res.json({ streams: [] });

  const cacheKey = getCacheKey(userId, addonSlug, type, id);
  const cached = getFromCache(cacheKey);
  if (cached) {
    res.setHeader('X-Foxmatter-Cache', 'HIT');
    return res.json(cached);
  }

  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);
  if (!upstream.success) return res.json({ streams: [] });

  // 1. Applica prima le logiche globali del formatterEngine (badge, regex ecc.)
  let formattedStreams = formatStreams(upstream.streams, config, addonConfig.id);

  // 2. Applica la sovrascrittura esatta dei titoli degli stream (se l'utente ha impostato un titleTemplate)
  if (addonConfig.titleTemplate) {
    formattedStreams = formattedStreams.map(stream => {
      const streamVars = {
        title: stream.title || '',
        name: stream.name || '',
        addon: addonConfig.name || addonSlug,
      };
      
      const overridenTitle = resolveTemplate(addonConfig.titleTemplate, streamVars);
      return {
        ...stream,
        title: overridenTitle || stream.title
      };
    });
  }

  const response = {
    streams: formattedStreams,
    ...(upstream.raw?.cacheMaxAge && { cacheMaxAge: upstream.raw.cacheMaxAge }),
  };

  setCache(cacheKey, response);
  res.setHeader('X-Foxmatter-Cache', 'MISS');
  res.json(response);
}));

// ─── Master manifest ───────────────────────────────────────────────────────
router.get('/:userId/manifest.json', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const config = await getUserConfig(userId);
  if (!config) return res.status(404).json({ error: 'User not found' });

  const user = await getUserById(userId);
  const allIdPrefixes = new Set(['tt']);
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
    behaviorHints: { configurable: false },
  };

  res.json(manifest);
}));

// ─── Master stream endpoint (Parallelo + template override applicato) ──────
router.get('/:userId/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, type, id } = req.params;
  const config = await getUserConfig(userId);
  if (!config || !config.addonConfigs?.length) return res.json({ streams: [] });

  const results = await Promise.allSettled(
    config.addonConfigs
      .filter(a => a.enabled !== false && a.transportUrl)
      .map(async (addonConf) => {
        const cacheKey = getCacheKey(userId, addonConf.slug, type, id);
        const cached = getFromCache(cacheKey);
        if (cached) return cached.streams || [];
        
        const upstream = await fetchUpstreamStreams(addonConf.transportUrl, type, id);
        if (!upstream.success) return [];
        
        let formatted = formatStreams(upstream.streams, config, addonConf.id);

        // Applica le sovrascritture dei titoli se presenti nell'addon specifico del master rendering
        if (addonConf.titleTemplate) {
          formatted = formatted.map(stream => {
            const streamVars = {
              title: stream.title || '',
              name: stream.name || '',
              addon: addonConf.name || addonConf.slug,
            };
            const overridenTitle = resolveTemplate(addonConf.titleTemplate, streamVars);
            return { ...stream, title: overridenTitle || stream.title };
          });
        }

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