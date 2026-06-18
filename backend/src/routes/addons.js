// routes/addons.js - Addon discovery per Stremio e Nuvio
const express = require('express');
const router  = express.Router();
const { authenticate }            = require('../middleware/auth');
const { asyncHandler }            = require('../middleware/errorHandler');
const { fetchUserAddons, fetchAddonManifest, normalizeAddon } = require('../services/stremioService');
const { fetchNuvioAddons }        = require('../services/nuvioService');
const { getUserConfig, saveUserConfig } = require('../services/configService');
const { getUserById }             = require('../services/userService');
const { logger }                  = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

router.use(authenticate);

// ─── GET /api/addons ───────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  let result;

  if (user.provider === 'nuvio') {
    if (!user.nuvioAccessToken) {
      return res.status(400).json({ error: 'Token Nuvio mancante. Effettua di nuovo il login.' });
    }
    result = await fetchNuvioAddons(user.nuvioAccessToken, user.nuvioUserId);
  } else {
    if (!user.stremioAuthKey) {
      return res.status(400).json({ error: 'Auth key Stremio mancante. Effettua di nuovo il login.' });
    }
    result = await fetchUserAddons(user.stremioAuthKey);
  }

  if (!result.success) {
    return res.status(502).json({ error: 'Impossibile recuperare gli addon', detail: result.error });
  }

  const config       = await getUserConfig(req.user.userId);
  const configuredIds = new Set((config?.addonConfigs || []).map(a => a.addonId));

  const annotated = result.addons.map(addon => {
    // Paracadute: forziamo true se l'addon ha esplicitamente delle risorse compatibili con gli stream
    const canProxy = addon.isProxiable || addon.resources?.includes('stream');
    return {
      ...addon,
      isProxiable: canProxy,
      isConfigured: configuredIds.has(addon.id),
      proxyUrl: canProxy
        ? `${BASE_URL}/proxy/${req.user.userId}/${addon.slug}/manifest.json`
        : null,
    };
  });

  res.json({ addons: annotated, total: annotated.length, provider: user.provider });
}));

// ─── POST /api/addons/sync ─────────────────────────────────────────────────
router.post('/sync', asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  let result;
  if (user.provider === 'nuvio') {
    result = await fetchNuvioAddons(user.nuvioAccessToken, user.nuvioUserId);
  } else {
    result = await fetchUserAddons(user.stremioAuthKey);
  }

  if (!result.success) {
    return res.status(502).json({ error: 'Sync fallita', detail: result.error });
  }

  const currentConfig = await getUserConfig(req.user.userId) || {
    globalBadges: [], addonConfigs: [], settings: {},
  };

  const existingIds = new Set(currentConfig.addonConfigs.map(a => a.addonId));
  const newAddons   = result.addons
    .filter(a => !existingIds.has(a.id) && (a.isProxiable || a.resources?.includes('stream')))
    .map(addon => ({
      addonId:             addon.id,
      slug:                addon.slug,
      name:                addon.name,
      transportUrl:        addon.transportUrl,
      enabled:             true,
      idPrefixes:          addon.idPrefixes,
      types:               addon.types,
      logo:                addon.logo,
      nameTemplate:        null,
      titleTemplate:       null,
      descriptionTemplate: null,
      badges:              [],
    }));

  const updatedConfig = {
    ...currentConfig,
    addonConfigs: [...currentConfig.addonConfigs, ...newAddons],
  };

  await saveUserConfig(req.user.userId, updatedConfig);

  res.json({
    success: true,
    total:   result.addons.length,
    added:   newAddons.length,
    addons:  result.addons,
  });
}));

// ─── GET /api/addons/:slug/manifest ───────────────────────────────────────
router.get('/:slug/manifest', asyncHandler(async (req, res) => {
  const config    = await getUserConfig(req.user.userId);
  const addonConf = config?.addonConfigs?.find(a => a.slug === req.params.slug);

  if (!addonConf?.transportUrl) {
    return res.status(404).json({ error: 'Addon non trovato nella configurazione' });
  }

  const result = await fetchAddonManifest(addonConf.transportUrl);
  if (!result.success) {
    return res.status(502).json({ error: 'Upstream non raggiungibile', detail: result.error });
  }

  res.json({ manifest: result.manifest });
}));

// ─── POST /api/addons/:slug/enable | /disable ─────────────────────────────
router.post('/:slug/enable',  asyncHandler(async (req, res) => {
  await setEnabled(req.user.userId, req.params.slug, true);
  res.json({ success: true, slug: req.params.slug, enabled: true });
}));

router.post('/:slug/disable', asyncHandler(async (req, res) => {
  await setEnabled(req.user.userId, req.params.slug, false);
  res.json({ success: true, slug: req.params.slug, enabled: false });
}));

// ─── DELETE /api/addons/:slug ─────────────────────────────────────────────
router.delete('/:slug', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId);
  if (!config) return res.status(404).json({ error: 'Configurazione non trovata' });

  const before = config.addonConfigs?.length || 0;
  config.addonConfigs = (config.addonConfigs || []).filter(a => a.slug !== req.params.slug);

  if (config.addonConfigs.length === before) {
    return res.status(404).json({ error: `Addon "${req.params.slug}" non trovato` });
  }

  await saveUserConfig(req.user.userId, config);
  res.json({ success: true, removed: req.params.slug });
}));

// ─── POST /api/addons/add (manuale via URL) ────────────────────────────────
router.post('/add', asyncHandler(async (req, res) => {
  const { transportUrl, name } = req.body;
  if (!transportUrl) return res.status(400).json({ error: 'transportUrl obbligatorio' });

  const manifestResult = await fetchAddonManifest(transportUrl);
  if (!manifestResult.success) {
    return res.status(400).json({ error: 'URL addon non raggiungibile', detail: manifestResult.error });
  }

  const manifest = manifestResult.manifest;
  const addon    = normalizeAddon({
    transportUrl,
    manifest: { ...manifest, name: name || manifest.name },
  });

  const config = await getUserConfig(req.user.userId) || {
    globalBadges: [], addonConfigs: [], settings: {},
  };

  if (config.addonConfigs.some(a => a.addonId === addon.id)) {
    return res.status(409).json({ error: 'Addon già presente nella configurazione' });
  }

  config.addonConfigs.push({
    addonId: addon.id, slug: addon.slug, name: addon.name,
    transportUrl: addon.transportUrl, enabled: true,
    idPrefixes: addon.idPrefixes, types: addon.types, logo: addon.logo,
    nameTemplate: null, titleTemplate: null, descriptionTemplate: null, badges: [],
  });

  await saveUserConfig(req.user.userId, config);
  res.status(201).json({
    success: true,
    addon: { ...addon, proxyUrl: `${BASE_URL}/proxy/${req.user.userId}/${addon.slug}/manifest.json` },
  });
}));

// ─── GET /api/addons/install-urls ─────────────────────────────────────────
router.get('/install-urls', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId);
  if (!config?.addonConfigs?.length) return res.json({ urls: [], masterUrl: null });

  const masterUrl       = `${BASE_URL}/proxy/${req.user.userId}/manifest.json`;
  const stremioMasterUrl = `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/manifest.json`;

  const urls = config.addonConfigs
    .filter(a => a.enabled)
    .map(a => ({
      name:       a.name,
      slug:       a.slug,
      httpUrl:    `${BASE_URL}/proxy/${req.user.userId}/${a.slug}/manifest.json`,
      stremioUrl: `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/${a.slug}/manifest.json`,
    }));

  res.json({ masterUrl, stremioMasterUrl, urls });
}));

// ─── Helper ────────────────────────────────────────────────────────────────
async function setEnabled(userId, slug, enabled) {
  const config = await getUserConfig(userId);
  if (!config) throw new Error('Configurazione non trovata');
  const addon = config.addonConfigs?.find(a => a.slug === slug);
  if (!addon) throw Object.assign(new Error(`Addon "${slug}" non trovato`), { status: 404 });
  addon.enabled = enabled;
  await saveUserConfig(userId, config);
}

module.exports = router;