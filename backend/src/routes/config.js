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
  imageUrlTemplate: z.string().nullable().optional(),
  titleTemplate: z.string().nullable().optional(),
  descriptionTemplate: z.string().nullable().optional(),
  badges: z.array(badgeSchema).default([]),
  behaviorHints: z.record(z.any()).optional(),
});

const fullConfigSchema = z.object({
  globalBadges: z.array(badgeSchema).default([]),
  addonConfigs: z.array(addonConfigSchema).default([]),
  globalTemplate: z.object({
    titleTemplate: z.string().nullable().optional(),
    descriptionTemplate: z.string().nullable().optional(),
  }).optional(),
  settings: z.object({
    defaultNameTemplate: z.string().optional(),
    defaultDescriptionTemplate: z.string().optional(),
    mergeStreams: z.boolean().default(false),
    addonOrder: z.array(z.string()).default([]),
    sortRules: z.array(z.object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']).default('desc'),
      order: z.array(z.string()).default([]),
    })).default([]),
    maxResultsPerAddon: z.number().int().min(0).default(0),
    maxResultsPerQuality: z.number().int().min(0).default(0),
  }).optional(),
});

/**
 * Helper interno per convertire vecchi placeholder errati tipo {title} nel formato corretto {stream.title}
 * per prevenire i blocchi di validazione.
 */
function sanitizeTemplates(config) {
  if (!config) return config;
  
  if (config.addonConfigs && Array.isArray(config.addonConfigs)) {
    config.addonConfigs = config.addonConfigs.map(addon => {
      if (addon.imageUrlTemplate) {
        addon.imageUrlTemplate = addon.imageUrlTemplate.replace(/\{title(::|\})/g, '{stream.title$1');
      }
      if (addon.descriptionTemplate) {
        addon.descriptionTemplate = addon.descriptionTemplate.replace(/\{title(::|\})/g, '{stream.title$1');
      }
      if (addon.nameTemplate) {
        addon.nameTemplate = addon.nameTemplate.replace(/\{title(::|\})/g, '{stream.title$1');
      }
      return addon;
    });
  }

  if (config.settings) {
    if (config.settings.defaultDescriptionTemplate) {
      config.settings.defaultDescriptionTemplate = config.settings.defaultDescriptionTemplate.replace(/\{title(::|\})/g, '{stream.title$1');
    }
    if (config.settings.defaultNameTemplate) {
      config.settings.defaultNameTemplate = config.settings.defaultNameTemplate.replace(/\{title(::|\})/g, '{stream.title$1');
    }
  }
  return config;
}

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
  // Sanifichiamo le stringhe dei template ereditati o caricati prima della validazione strutturale
  const sanitizedBody = req.body ? sanitizeTemplates(req.body) : req.body;
  const parsed = fullConfigSchema.safeParse(sanitizedBody);
  
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

// ─── POST /api/config/addons/:slug (Nuovo Endpoint stile aiostreams) ───────
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

  // Se l'utente carica o passa un .json intero
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
    // Aggiornamento parziale standard da form manuale
    if (nameTemplate !== undefined) currentConfig.addonConfigs[addonIndex].nameTemplate = nameTemplate;
    if (titleTemplate !== undefined) currentConfig.addonConfigs[addonIndex].titleTemplate = titleTemplate;
    if (descriptionTemplate !== undefined) currentConfig.addonConfigs[addonIndex].descriptionTemplate = descriptionTemplate;
    if (enabled !== undefined) currentConfig.addonConfigs[addonIndex].enabled = enabled;
    if (badges !== undefined) currentConfig.addonConfigs[addonIndex].badges = badges;
  }

  // Sanificazione finale dell'oggetto modificato prima del check finale
  const sanitizedConfig = sanitizeTemplates(currentConfig);

  const validationResult = validateConfig(sanitizedConfig);
  if (!validationResult.valid) {
    return res.status(400).json({ error: 'Configurazione non valida', details: validationResult.errors });
  }

  await saveUserConfig(req.user.userId, sanitizedConfig);
  res.json({ success: true, addonConfig: sanitizedConfig.addonConfigs[addonIndex] });
}));

// ─── POST /api/config/import ───────────────────────────────────────────────
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

// ─── GET /api/config/export ────────────────────────────────────────────────
router.get('/export', asyncHandler(async (req, res) => {
  const config = await getUserConfig(req.user.userId) || getDefaultConfig();
  const { format = 'foxmatter' } = req.query;
  
  let exported;
  
  if (format === 'airstream') {
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
  
  // Lista nera esplicita e controlli per escludere cataloghi fissi o meta-provider non video
  const nonStreamBlacklist = [
    'cinemeta', 'opensubtitles', 'trakt', 'kitsu', 'anime-kitsu', 
    'tmdb-addon', 'imdb', 'mal-', 'myanimelist', 'local-files'
  ];

  const newAddons = result.addons
    .filter(addon => {
      // 1. Deve essere proxiabile e non ancora registrato
      if (existingAddonIds.has(addon.id) || !addon.isProxiable) return false;

      // 2. Controllo tramite blacklist testuale dello slug o ID
      const targetSlug = (addon.slug || '').toLowerCase();
      const targetId = (addon.id || '').toLowerCase();
      if (nonStreamBlacklist.some(item => targetSlug.includes(item) || targetId.includes(item))) return false;

      // 3. SE l'oggetto addon espone le sue risorse dichiarate, deve supportare la risorsa 'stream'
      if (addon.resources && Array.isArray(addon.resources)) {
        const hasStreams = addon.resources.some(r => r === 'stream' || (r && r.name === 'stream'));
        if (!hasStreams) return false;
      }
      
      return true;
    })
    .map(addon => ({
      addonId: addon.id,
      slug: addon.slug,
      name: addon.name,
      transportUrl: addon.transportUrl,
      enabled: true,
      idPrefixes: addon.idPrefixes || [],
      types: addon.types || [],
      logo: addon.logo,
      nameTemplate: null,
      imageUrlTemplate: null,
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
    addons: updatedConfig.addonConfigs, // Ritorna la lista pulita degli addon video effettivamente proxiati
  });
}));

// ─── POST /api/config/preview ──────────────────────────────────────────────
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
  if (Array.isArray(data?.badges)) {
    return data.badges.filter(b => b.pattern && b.label);
  }
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
    globalTemplate: {
      titleTemplate: null,
      descriptionTemplate: null,
    },
    settings: {
      mergeStreams: false,
      addonOrder: [],
      sortRules: [],
      maxResultsPerAddon: 0,
      maxResultsPerQuality: 0,
    },
  };
}

module.exports = router;
