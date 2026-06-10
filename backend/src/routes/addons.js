// routes/addons.js - Stremio addon discovery & management for Foxmatter
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { fetchUserAddons, fetchAddonManifest } = require('../services/stremioService');
const { getUserConfig, saveUserConfig } = require('../services/configService');
const { getUserById } = require('../services/userService');
const { logger } = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// All addon routes require a valid JWT
router.use(authenticate);

// ─── GET /api/addons ───────────────────────────────────────────────────────
// Returns the user's installed Stremio addons, merged with any local config.
router.get('/', asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.userId);

  if (!user?.stremioAuthKey) {
    return res.status(400).json({
      error: 'No Stremio auth key stored for this account. Please re-login.',
    });
  }

  const result = await fetchUserAddons(user.stremioAuthKey);

  if (!result.success) {
    return res.status(502).json({
      error: 'Could not fetch addons from Stremio',
      detail: result.error,
    });
  }

  // Annotate each addon with whether it's currently configured in Foxmatter
  const config = await getUserConfig(req.user.userId);
  const configuredIds = new Set((config?.addonConfigs || []).map(a => a.addonId));

  const annotated = result.addons.map(addon => ({
    ...addon,
    isConfigured: configuredIds.has(addon.id),
    proxyUrl: addon.isProxiable
      ? `${BASE_URL}/proxy/${req.user.userId}/${addon.slug}/manifest.json`
      : null,
  }));

  res.json({
    addons: annotated,
    total: annotated.length,
    proxiable: annotated.filter(a => a.isProxiable).length,
  });
}));

// ─── GET /api/addons/:slug/manifest ───────────────────────────────────────
// Fetch and return the live manifest of a specific upstream addon.
router.get('/:slug/manifest', asyncHandler(async (req, res) => {
  const { slug } = req.params;

  const config = await getUserConfig(req.user.userId);
  const addonConf = config?.addonConfigs?.find(a => a.slug === slug);

  if (!addonConf?.transportUrl) {
    return res.status(404).json({ error: 'Addon not found in your configuration' });
  }

  const result = await fetchAddonManifest(addonConf.transportUrl);

  if (!result.success) {
    return res.status(502).json({
      error: 'Could not reach upstream addon',
      detail: result.error,
    });
  }

  res.json({ manifest: result.manifest });
}));

// ─── POST /api/addons/:slug/enable ────────────────────────────────────────
router.post('/:slug/enable', asyncHandler(async (req, res) => {
  await setAddonEnabled(req.user.userId, req.params.slug, true);
  res.json({ success: true, slug: req.params.slug, enabled: true });
}));

// ─── POST /api/addons/:slug/disable ───────────────────────────────────────
router.post('/:slug/disable', asyncHandler(async (req, res) => {
  await setAddonEnabled(req.user.userId, req.params.slug, false);
  res.json({ success: true, slug: req.params.slug, enabled: false });
}));

// ─── DELETE /api/addons/:slug ─────────────────────────────────────────────
// Remove an addon from the user's Foxmatter configuration entirely.
router.delete('/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const config = await getUserConfig(req.user.userId);

  if (!config) {
    return res.status(404).json({ error: 'No configuration found' });
  }

  const before = config.addonConfigs?.length || 0;
  config.addonConfigs = (config.addonConfigs || []).filter(a => a.slug !== slug);
  const after = config.addonConfigs.length;

  if (before === after) {
    return res.status(404).json({ error: `Addon "${slug}" not found in your configuration` });
  }

  await saveUserConfig(req.user.userId, config);

  logger.info(`User ${req.user.userId} removed addon ${slug}`);
  res.json({ success: true, removed: slug });
}));

// ─── POST /api/addons/add ─────────────────────────────────────────────────
// Manually add an addon by transport URL (for custom/unlisted addons).
router.post('/add', asyncHandler(async (req, res) => {
  const { transportUrl, name } = req.body;

  if (!transportUrl || typeof transportUrl !== 'string') {
    return res.status(400).json({ error: 'transportUrl is required' });
  }

  // Fetch the manifest to validate the URL and get addon info
  const manifestResult = await fetchAddonManifest(transportUrl);
  if (!manifestResult.success) {
    return res.status(400).json({
      error: 'Could not reach addon at the provided URL',
      detail: manifestResult.error,
    });
  }

  const manifest = manifestResult.manifest;
  const { normalizeAddon } = require('../services/stremioService');

  const addon = normalizeAddon({
    transportUrl,
    manifest: { ...manifest, name: name || manifest.name },
  });

  // Add to user config if not already present
  const config = await getUserConfig(req.user.userId) || {
    globalBadges: [],
    addonConfigs: [],
    settings: {},
  };

  const alreadyExists = config.addonConfigs.some(a => a.addonId === addon.id);
  if (alreadyExists) {
    return res.status(409).json({ error: 'Addon is already in your configuration' });
  }

  config.addonConfigs.push({
    addonId: addon.id,
    slug: addon.slug,
    name: addon.name,
    transportUrl: addon.transportUrl,
    enabled: true,
    idPrefixes: addon.idPrefixes,
    types: addon.types,
    logo: addon.logo,
    nameTemplate: null,
    titleTemplate: null,
    descriptionTemplate: null,
    badges: [],
  });

  await saveUserConfig(req.user.userId, config);

  res.status(201).json({
    success: true,
    addon: {
      ...addon,
      proxyUrl: `${BASE_URL}/proxy/${req.user.userId}/${addon.slug}/manifest.json`,
    },
  });
}));

// ─── GET /api/addons/install-urls ─────────────────────────────────────────
// Returns the installable proxy URLs for all configured addons.
router.get('/install-urls', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId);

  if (!config?.addonConfigs?.length) {
    return res.json({ urls: [], masterUrl: null });
  }

  const masterUrl = `${BASE_URL}/proxy/${req.user.userId}/manifest.json`;
  const stremioMasterUrl = `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/manifest.json`;

  const urls = config.addonConfigs
    .filter(a => a.enabled)
    .map(a => ({
      name: a.name,
      slug: a.slug,
      httpUrl: `${BASE_URL}/proxy/${req.user.userId}/${a.slug}/manifest.json`,
      stremioUrl: `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/${a.slug}/manifest.json`,
    }));

  res.json({
    masterUrl,
    stremioMasterUrl,
    urls,
    tip: 'Install the masterUrl to get ALL formatted addons in a single install.',
  });
}));

// ─── Shared helper ─────────────────────────────────────────────────────────

async function setAddonEnabled(userId, slug, enabled) {
  const config = await getUserConfig(userId);
  if (!config) throw new Error('No configuration found');

  const addonConf = config.addonConfigs?.find(a => a.slug === slug);
  if (!addonConf) throw Object.assign(new Error(`Addon "${slug}" not found`), { status: 404 });

  addonConf.enabled = enabled;
  await saveUserConfig(userId, config);
  logger.info(`User ${userId} ${enabled ? 'enabled' : 'disabled'} addon ${slug}`);
}

module.exports = router;