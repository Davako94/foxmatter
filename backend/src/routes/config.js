// routes/config.js - User configuration CRUD
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { 
  getUserConfig, 
  saveUserConfig, 
  validateConfig 
} = require('../services/configService');
const { fetchUserAddons } = require('../services/stremioService');
const { getUserById } = require('../services/userService');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// All config routes require authentication
router.use(authenticate);

// ─── Badge schemas ─────────────────────────────────────────────────────────
const badgeSchema = z.object({
  id: z.string().optional(),
  pattern: z.string().min(1),
  label: z.string().min(1).max(20),
  priority: z.number().int().min(1).max(100).default(50),
  color: z.string().optional(), // CSS color for UI display
  emoji: z.string().optional(),
});

const addonConfigSchema = z.object({
  addonId: z.string(),
  slug: z.string(),
  name: z.string(),
  transportUrl: z.string().url(),
  enabled: z.boolean().default(true),
  idPrefixes: z.array(z.string()).default([]),
  types: z.array(z.string()).default([]),
  logo: z.string().nullable().optional(),
  nameTemplate: z.string().nullable().optional(),
  titleTemplate: z.string().nullable().optional(),
  descriptionTemplate: z.string().nullable().optional(),
  badges: z.array(badgeSchema).default([]),
  behaviorHints: z.record(z.any()).optional(),
});

const fullConfigSchema = z.object({
  globalBadges: z.array(badgeSchema).default([]),
  addonConfigs: z.array(addonConfigSchema).default([]),
  settings: z.object({
    defaultNameTemplate: z.string().optional(),
    defaultDescriptionTemplate: z.string().optional(),
    mergeStreams: z.boolean().default(false),
  }).optional(),
});

// ─── GET /api/config ───────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId);
  
  res.json({
    config: config || getDefaultConfig(),
    installUrl: `${BASE_URL}/proxy/${req.user.userId}/manifest.json`,
    stremioInstallUrl: `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/manifest.json`,
  });
}));

// ─── PUT /api/config ───────────────────────────────────────────────────────
router.put('/', asyncHandler(async (req, res) => {
  const parsed = fullConfigSchema.safeParse(req.body);
  
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid configuration',
      details: parsed.error.flatten(),
    });
  }

  const config = parsed.data;
  
  // Validate templates have valid variables
  const validationResult = validateConfig(config);
  if (!validationResult.valid) {
    return res.status(400).json({
      error: 'Configuration validation failed',
      details: validationResult.errors,
    });
  }

  await saveUserConfig(req.user.userId, config);
  
  res.json({ 
    success: true, 
    message: 'Configuration saved',
    installUrl: `${BASE_URL}/proxy/${req.user.userId}/manifest.json`,
  });
}));

// ─── POST /api/config/import ───────────────────────────────────────────────
// Import a badges JSON (Airstream-style format or Foxmatter format)
router.post('/import', asyncHandler(async (req, res) => {
  const { json, merge = false } = req.body;
  
  let imported;
  try {
    imported = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Support multiple import formats
  const badges = normalizeImportedBadges(imported);
  
  if (!badges.length) {
    return res.status(400).json({ error: 'No valid badges found in import' });
  }

  const currentConfig = await getUserConfig(req.user.userId) || getDefaultConfig();
  
  let newBadges;
  if (merge) {
    // Merge: keep existing, add new ones (deduplicate by label)
    const existingLabels = new Set(currentConfig.globalBadges.map(b => b.label.toLowerCase()));
    newBadges = [
      ...currentConfig.globalBadges,
      ...badges.filter(b => !existingLabels.has(b.label.toLowerCase())),
    ];
  } else {
    // Replace global badges
    newBadges = badges;
  }

  const updatedConfig = { ...currentConfig, globalBadges: newBadges };
  await saveUserConfig(req.user.userId, updatedConfig);
  
  res.json({
    success: true,
    imported: badges.length,
    total: newBadges.length,
    badges,
  });
}));

// ─── GET /api/config/export ────────────────────────────────────────────────
router.get('/export', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId) || getDefaultConfig();
  const { format = 'foxmatter' } = req.query;
  
  let exported;
  
  if (format === 'airstream') {
    // Export in Airstream-compatible format
    exported = {
      badges: config.globalBadges,
      global: true,
      apply_to_all_addons: true,
    };
  } else {
    exported = config;
  }
  
  res.setHeader('Content-Disposition', 'attachment; filename="foxmatter-config.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exported);
}));

// ─── POST /api/config/sync-addons ─────────────────────────────────────────
// Re-fetch user's installed Stremio addons and update config
router.post('/sync-addons', asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.userId);
  
  if (!user?.stremioAuthKey) {
    return res.status(400).json({ error: 'No Stremio auth key stored' });
  }

  const result = await fetchUserAddons(user.stremioAuthKey);
  
  if (!result.success) {
    return res.status(502).json({ error: 'Failed to fetch addons from Stremio', detail: result.error });
  }

  // Load existing config and merge
  const currentConfig = await getUserConfig(req.user.userId) || getDefaultConfig();
  const existingAddonIds = new Set(currentConfig.addonConfigs.map(a => a.addonId));
  
  // Add new addons that aren't configured yet
  const newAddons = result.addons
    .filter(a => !existingAddonIds.has(a.id) && a.isProxiable)
    .map(addon => ({
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
    }));

  const updatedConfig = {
    ...currentConfig,
    addonConfigs: [...currentConfig.addonConfigs, ...newAddons],
  };

  await saveUserConfig(req.user.userId, updatedConfig);

  res.json({
    success: true,
    total: result.addons.length,
    added: newAddons.length,
    addons: result.addons,
  });
}));

// ─── POST /api/config/preview ──────────────────────────────────────────────
// Preview formatting on sample stream data
router.post('/preview', asyncHandler(async (req, res) => {
  const { stream, config, addonId } = req.body;
  
  const { formatStreams } = require('../services/formatterEngine');
  
  const formatted = formatStreams(
    [stream],
    config,
    addonId || 'preview'
  );
  
  res.json({
    original: stream,
    formatted: formatted[0] || stream,
  });
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeImportedBadges(data) {
  // Handle our format
  if (Array.isArray(data?.badges)) {
    return data.badges.filter(b => b.pattern && b.label);
  }
  
  // Handle flat array
  if (Array.isArray(data)) {
    return data.filter(b => b.pattern && b.label);
  }
  
  return [];
}

function getDefaultConfig() {
  return {
    globalBadges: [
      { pattern: '4k|2160p|uhd', label: '4K', priority: 1 },
      { pattern: 'remux', label: 'REMUX', priority: 2 },
      { pattern: 'dolby.?vision|\\bdv\\b', label: 'DV', priority: 3 },
      { pattern: 'dolby.?atmos|atmos', label: 'Atmos', priority: 4 },
      { pattern: 'hdr10\\+|hdr10plus', label: 'HDR10+', priority: 5 },
      { pattern: 'hdr', label: 'HDR', priority: 6 },
      { pattern: 'hevc|x265|h\\.265', label: 'HEVC', priority: 7 },
      { pattern: '1080p', label: '1080p', priority: 8 },
      { pattern: 'web.?dl|webdl', label: 'WEB-DL', priority: 9 },
    ],
    addonConfigs: [],
    settings: {
      mergeStreams: false,
    },
  };
}

module.exports = router;