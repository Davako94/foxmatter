// routes/config.js - User configuration CRUD
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { 
  getUserConfig, 
  saveUserConfig, 
  validateConfig,
  getDefaultConfig,
  AIOSTREAMS_VARS 
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
  color: z.string().optional(),
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
    globalNameTemplate: z.string().nullable().optional(),
    globalDescriptionTemplate: z.string().nullable().optional(),
    mergeStreams: z.boolean().default(false),
  }).optional(),
});

// ─── Helper per sanitizzazione template ──────────────────────────────────

function sanitizeTemplates(config) {
  if (!config) return config;
  
  // Sanitizza template globali
  if (config.settings) {
    if (config.settings.globalNameTemplate) {
      config.settings.globalNameTemplate = config.settings.globalNameTemplate
        .replace(/\{title(::|\})/g, '{stream.title$1')
        .replace(/\{name(::|\})/g, '{stream.name$1');
    }
    if (config.settings.globalDescriptionTemplate) {
      config.settings.globalDescriptionTemplate = config.settings.globalDescriptionTemplate
        .replace(/\{title(::|\})/g, '{stream.title$1')
        .replace(/\{name(::|\})/g, '{stream.name$1');
    }
  }
  
  // Sanitizza template per-addon
  if (config.addonConfigs && Array.isArray(config.addonConfigs)) {
    config.addonConfigs = config.addonConfigs.map(addon => {
      ['nameTemplate', 'titleTemplate', 'descriptionTemplate'].forEach(field => {
        if (addon[field]) {
          addon[field] = addon[field]
            .replace(/\{title(::|\})/g, '{stream.title$1')
            .replace(/\{name(::|\})/g, '{stream.name$1');
        }
      });
      return addon;
    });
  }
  
  return config;
}

// ─── GET /api/config ───────────────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId);
  
  // Se non c'è config, crea default
  let finalConfig = config || getDefaultConfig();
  
  // Assicura che settings abbia i campi globali
  if (!finalConfig.settings) {
    finalConfig.settings = {
      globalNameTemplate: null,
      globalDescriptionTemplate: null,
      mergeStreams: false,
    };
  }
  
  res.json({
    config: finalConfig,
    installUrl: `${BASE_URL}/proxy/${req.user.userId}/manifest.json`,
    stremioInstallUrl: `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${req.user.userId}/manifest.json`,
  });
}));

// ─── PUT /api/config ───────────────────────────────────────────────────────
router.put('/', asyncHandler(async (req, res) => {
  const sanitizedBody = sanitizeTemplates(req.body);
  const parsed = fullConfigSchema.safeParse(sanitizedBody);
  
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid configuration',
      details: parsed.error.flatten(),
    });
  }

  const config = parsed.data;
  
  // Se il template globale è vuoto, impostalo a null
  if (config.settings) {
    if (config.settings.globalNameTemplate === '') config.settings.globalNameTemplate = null;
    if (config.settings.globalDescriptionTemplate === '') config.settings.globalDescriptionTemplate = null;
  }
  
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

// ─── POST /api/config/addons/:slug ──────────────────────────────────────
router.post('/addons/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { 
    nameTemplate, 
    titleTemplate, 
    descriptionTemplate, 
    enabled, 
    badges, 
    fullJsonOverride 
  } = req.body;

  const currentConfig = await getUserConfig(req.user.userId);
  if (!currentConfig) return res.status(404).json({ error: 'Configurazione non trovata' });

  const addonIndex = currentConfig.addonConfigs?.findIndex(a => a.slug === slug);
  if (addonIndex === -1 || addonIndex === undefined) {
    return res.status(404).json({ error: `Addon con slug "${slug}" non trovato` });
  }

  if (fullJsonOverride) {
    const parsedJson = typeof fullJsonOverride === 'string' ? JSON.parse(fullJsonOverride) : fullJsonOverride;
    
    currentConfig.addonConfigs[addonIndex] = {
      ...currentConfig.addonConfigs[addonIndex],
      nameTemplate: parsedJson.nameTemplate || parsedJson.name_template || null,
      titleTemplate: parsedJson.titleTemplate || parsedJson.title_template || null,
      descriptionTemplate: parsedJson.descriptionTemplate || parsedJson.description_template || null,
      badges: parsedJson.badges || currentConfig.addonConfigs[addonIndex].badges || [],
      enabled: parsedJson.enabled !== undefined ? parsedJson.enabled : currentConfig.addonConfigs[addonIndex].enabled,
    };
  } else {
    if (nameTemplate !== undefined) currentConfig.addonConfigs[addonIndex].nameTemplate = nameTemplate || null;
    if (titleTemplate !== undefined) currentConfig.addonConfigs[addonIndex].titleTemplate = titleTemplate || null;
    if (descriptionTemplate !== undefined) currentConfig.addonConfigs[addonIndex].descriptionTemplate = descriptionTemplate || null;
    if (enabled !== undefined) currentConfig.addonConfigs[addonIndex].enabled = enabled;
    if (badges !== undefined) currentConfig.addonConfigs[addonIndex].badges = badges;
  }

  const sanitizedConfig = sanitizeTemplates(currentConfig);
  const validationResult = validateConfig(sanitizedConfig);
  if (!validationResult.valid) {
    return res.status(400).json({ error: 'Configurazione non valida', details: validationResult.errors });
  }

  await saveUserConfig(req.user.userId, sanitizedConfig);
  res.json({ success: true, addonConfig: sanitizedConfig.addonConfigs[addonIndex] });
}));

// ─── POST /api/config/import ─────────────────────────────────────────────
router.post('/import', asyncHandler(async (req, res) => {
  const { json, merge = false } = req.body;
  
  let imported;
  try {
    imported = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const badges = normalizeImportedBadges(imported);
  
  if (!badges.length) {
    return res.status(400).json({ error: 'No valid badges found in import' });
  }

  const currentConfig = await getUserConfig(req.user.userId) || getDefaultConfig();
  
  let newBadges;
  if (merge) {
    const existingLabels = new Set(currentConfig.globalBadges.map(b => b.label.toLowerCase()));
    newBadges = [
      ...currentConfig.globalBadges,
      ...badges.filter(b => !existingLabels.has(b.label.toLowerCase())),
    ];
  } else {
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

// ─── GET /api/config/export ──────────────────────────────────────────────
router.get('/export', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId) || getDefaultConfig();
  const { format = 'foxmatter' } = req.query;
  
  let exported;
  
  if (format === 'aiostreams') {
    exported = {
      version: '1.0',
      badges: config.globalBadges,
      addons: config.addonConfigs.map(a => ({
        id: a.addonId,
        name: a.name,
        nameTemplate: a.nameTemplate,
        titleTemplate: a.titleTemplate,
        descriptionTemplate: a.descriptionTemplate,
        badges: a.badges,
        enabled: a.enabled,
      })),
      global: {
        nameTemplate: config.settings?.globalNameTemplate || null,
        descriptionTemplate: config.settings?.globalDescriptionTemplate || null,
      }
    };
  } else {
    exported = config;
  }
  
  res.setHeader('Content-Disposition', 'attachment; filename="foxmatter-config.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exported);
}));

// ─── POST /api/config/sync-addons ────────────────────────────────────────
router.post('/sync-addons', asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.userId);
  
  if (!user?.stremioAuthKey) {
    return res.status(400).json({ error: 'No Stremio auth key stored' });
  }

  const result = await fetchUserAddons(user.stremioAuthKey);
  
  if (!result.success) {
    return res.status(502).json({ error: 'Failed to fetch addons from Stremio', detail: result.error });
  }

  const currentConfig = await getUserConfig(req.user.userId) || getDefaultConfig();
  const existingAddonIds = new Set(currentConfig.addonConfigs.map(a => a.addonId));
  
  // Lista nera per escludere cataloghi non-stream
  const nonStreamBlacklist = [
    'cinemeta', 'opensubtitles', 'trakt', 'kitsu', 'anime-kitsu', 
    'tmdb-addon', 'imdb', 'mal-', 'myanimelist', 'local-files'
  ];

  const newAddons = result.addons
    .filter(addon => {
      if (existingAddonIds.has(addon.id) || !addon.isProxiable) return false;

      const targetSlug = (addon.slug || '').toLowerCase();
      const targetId = (addon.id || '').toLowerCase();
      if (nonStreamBlacklist.some(item => targetSlug.includes(item) || targetId.includes(item))) return false;

      if (addon.resources && Array.isArray(addon.resources)) {
        const hasStreams = addon.resources.some(r => r === 'stream' || (r && r.name === 'stream'));
        if (!hasStreams) return false;
      }
      
      return true;
    })
    .map(addon => ({
      addonId: addon.id,
      slug: addon.slug || addon.id.toLowerCase(),
      name: addon.name,
      transportUrl: addon.transportUrl,
      enabled: true,
      idPrefixes: addon.idPrefixes || [],
      types: addon.types || [],
      logo: addon.logo || null,
      nameTemplate: null,
      titleTemplate: null,
      descriptionTemplate: null,
      badges: [],
    }));

  // Aggiungi solo addon che NON sono già selezionati
  const updatedConfig = {
    ...currentConfig,
    addonConfigs: [...currentConfig.addonConfigs, ...newAddons],
  };

  await saveUserConfig(req.user.userId, updatedConfig);

  res.json({
    success: true,
    total: result.addons.length,
    added: newAddons.length,
    addons: updatedConfig.addonConfigs,
  });
}));

// ─── POST /api/config/preview ────────────────────────────────────────────
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

// ─── POST /api/config/apply-global ──────────────────────────────────────
// Applica i template globali a TUTTI gli addon (sovrascrive i template vuoti)
router.post('/apply-global', asyncHandler(async (req, res) => {
  const { nameTemplate, descriptionTemplate } = req.body;
  
  const currentConfig = await getUserConfig(req.user.userId);
  if (!currentConfig) {
    return res.status(404).json({ error: 'Config not found' });
  }
  
  // Aggiorna i template globali
  if (!currentConfig.settings) currentConfig.settings = {};
  currentConfig.settings.globalNameTemplate = nameTemplate || null;
  currentConfig.settings.globalDescriptionTemplate = descriptionTemplate || null;
  
  // Per ogni addon, se il template è vuoto, usa il globale
  if (currentConfig.addonConfigs) {
    currentConfig.addonConfigs = currentConfig.addonConfigs.map(addon => {
      // Se nameTemplate è vuoto o null, usa il globale
      if (!addon.nameTemplate || addon.nameTemplate.trim() === '') {
        addon.nameTemplate = nameTemplate || null;
      }
      // Se descriptionTemplate è vuoto o null, usa il globale
      if (!addon.descriptionTemplate || addon.descriptionTemplate.trim() === '') {
        addon.descriptionTemplate = descriptionTemplate || null;
      }
      return addon;
    });
  }
  
  const validationResult = validateConfig(currentConfig);
  if (!validationResult.valid) {
    return res.status(400).json({ 
      error: 'Configuration validation failed', 
      details: validationResult.errors 
    });
  }
  
  await saveUserConfig(req.user.userId, currentConfig);
  
  res.json({
    success: true,
    message: 'Global templates applied to all addons',
    config: currentConfig,
  });
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalizeImportedBadges(data) {
  if (Array.isArray(data?.badges)) {
    return data.badges.filter(b => b.pattern && b.label);
  }
  if (Array.isArray(data)) {
    return data.filter(b => b.pattern && b.label);
  }
  return [];
}

module.exports = router;