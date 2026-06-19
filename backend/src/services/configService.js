// services/configService.js - User formatting config persistence for Foxmatter
//
// Supabase table: user_configs
//   id        uuid primary key default gen_random_uuid()
//   user_id   uuid references users(id) on delete cascade
//   config    jsonb not null default '{}'
//   created_at timestamptz default now()
//   updated_at timestamptz default now()

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ─── TUTTE LE VARIABILI AIOSTREAMS (documentazione ufficiale) ───

// Oggetti radice supportati
const VALID_OBJECT_ROOTS = new Set([
  'config',
  'stream',
  'service',
  'addon',
  'metadata',
  'debug',
  'tools'
]);

// TUTTE le variabili AIOStreams (da documentazione)
const AIOSTREAMS_VARS = new Set([
  // Config
  'config.addonName',
  
  // Stream - Source
  'stream.type', 'stream.proxied', 'stream.library', 'stream.indexer',
  'stream.message', 'stream.infoHash',
  
  // Stream - File
  'stream.filename', 'stream.folderName', 'stream.size', 'stream.folderSize',
  'stream.bitrate', 'stream.duration', 'stream.container', 'stream.extension',
  
  // Stream - Video
  'stream.quality', 'stream.resolution', 'stream.visualTags', 'stream.encode',
  'stream.network', 'stream.hasChapters',
  
  // Stream - Audio
  'stream.audioTags', 'stream.audioChannels',
  
  // Stream - Languages
  'stream.languages', 'stream.languageEmojis', 'stream.languageCodes',
  'stream.smallLanguageCodes', 'stream.uLanguages', 'stream.uLanguageEmojis',
  'stream.uLanguageCodes', 'stream.uSmallLanguageCodes', 'stream.dubbed',
  
  // Stream - Subtitles
  'stream.subtitles', 'stream.subtitleEmojis', 'stream.subtitleCodes',
  'stream.smallSubtitleCodes', 'stream.uSubtitles', 'stream.uSubtitleEmojis',
  'stream.uSubtitleCodes', 'stream.uSmallSubtitleCodes', 'stream.subbed',
  
  // Stream - Release
  'stream.title', 'stream.year', 'stream.date', 'stream.releaseGroup',
  'stream.editions', 'stream.repack', 'stream.regraded', 'stream.uncensored',
  'stream.unrated', 'stream.upscaled',
  
  // Stream - Season/Episode
  'stream.seasonPack', 'stream.seasons', 'stream.formattedSeasons',
  'stream.folderSeasons', 'stream.formattedFolderSeasons', 'stream.episodes',
  'stream.formattedEpisodes', 'stream.folderEpisodes',
  'stream.formattedFolderEpisodes', 'stream.seasonEpisode',
  
  // Stream - P2P/Tracker
  'stream.seeders', 'stream.private', 'stream.freeleech', 'stream.age',
  'stream.ageHours',
  
  // Stream - Anime
  'stream.seadex', 'stream.seadexBest',
  
  // Stream - Scoring
  'stream.regexMatched', 'stream.rankedRegexMatched', 'stream.regexScore',
  'stream.nRegexScore', 'stream.seScore', 'stream.nSeScore',
  'stream.seMatched', 'stream.rseMatched',
  
  // Service
  'service.id', 'service.shortName', 'service.name', 'service.cached',
  
  // Addon
  'addon.presetId', 'addon.name', 'addon.manifestUrl',
  
  // Metadata
  'metadata.queryType', 'metadata.title', 'metadata.runtime',
  'metadata.episodeRuntime', 'metadata.genres', 'metadata.year',
  
  // Debug
  'debug.json', 'debug.jsonf',
  
  // Tools
  'tools.newLine', 'tools.removeLine'
]);

// Variabili legacy Foxmatter (fallback)
const LEGACY_VARS = new Set([
  'original_name', 'original_title', 'original_description',
  'quality', 'size', 'seeders', 'audio', 'language',
  'codec', 'source', 'release_group', 'badges',
]);

// ─── Helper per validazione ───────────────────────────────────────────────

function extractTemplateVars(template) {
  if (typeof template !== 'string') return [];
  const matches = template.matchAll(/\{([^}]+)\}/g);
  return [...matches].map(m => m[1].trim());
}

function getUnknownVars(template) {
  const vars = extractTemplateVars(template);
  const unknown = [];
  
  for (const v of vars) {
    // Ignora costrutti speciali
    if (v.startsWith('badge:') || v.startsWith('if:')) continue;
    
    const rawVar = v.split('::')[0].trim();
    
    // Controlla se è una variabile AIOStreams valida
    if (AIOSTREAMS_VARS.has(rawVar)) continue;
    
    // Controlla se è una variabile legacy
    if (LEGACY_VARS.has(rawVar)) continue;
    
    // Controlla se è un oggetto radice con proprietà
    if (rawVar.includes('.')) {
      const root = rawVar.split('.')[0];
      if (VALID_OBJECT_ROOTS.has(root)) continue;
    }
    
    unknown.push(v);
  }
  
  return unknown;
}

// ─── Funzioni principali ──────────────────────────────────────────────────

async function getUserConfig(userId) {
  const { data, error } = await supabase
    .from('user_configs')
    .select('config')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error(`getUserConfig(${userId}) error:`, error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return data?.config ?? null;
}

async function saveUserConfig(userId, config) {
  // Sanitizza i template prima del salvataggio
  const sanitized = sanitizeConfig(config);
  
  const { error } = await supabase
    .from('user_configs')
    .upsert(
      {
        user_id: userId,
        config: sanitized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: false }
    );

  if (error) {
    logger.error(`saveUserConfig(${userId}) error:`, error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  logger.info(`Config saved for user ${userId}`);
  return true;
}

async function deleteUserConfig(userId) {
  const { error } = await supabase
    .from('user_configs')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error(`deleteUserConfig(${userId}) error:`, error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return true;
}

// ─── Sanitizzazione ────────────────────────────────────────────────────────

function sanitizeConfig(config) {
  if (!config) return config;
  
  // Sanitizza i template per-addon
  if (config.addonConfigs && Array.isArray(config.addonConfigs)) {
    config.addonConfigs = config.addonConfigs.map(addon => {
      // Converti {title} in {stream.title}
      if (addon.descriptionTemplate) {
        addon.descriptionTemplate = addon.descriptionTemplate
          .replace(/\{title(::|\})/g, '{stream.title$1')
          .replace(/\{name(::|\})/g, '{stream.name$1');
      }
      if (addon.nameTemplate) {
        addon.nameTemplate = addon.nameTemplate
          .replace(/\{title(::|\})/g, '{stream.title$1')
          .replace(/\{name(::|\})/g, '{stream.name$1');
      }
      if (addon.titleTemplate) {
        addon.titleTemplate = addon.titleTemplate
          .replace(/\{title(::|\})/g, '{stream.title$1')
          .replace(/\{name(::|\})/g, '{stream.name$1');
      }
      return addon;
    });
  }

  // Sanitizza i template globali
  if (config.settings) {
    if (config.settings.defaultDescriptionTemplate) {
      config.settings.defaultDescriptionTemplate = config.settings.defaultDescriptionTemplate
        .replace(/\{title(::|\})/g, '{stream.title$1')
        .replace(/\{name(::|\})/g, '{stream.name$1');
    }
    if (config.settings.defaultNameTemplate) {
      config.settings.defaultNameTemplate = config.settings.defaultNameTemplate
        .replace(/\{title(::|\})/g, '{stream.title$1')
        .replace(/\{name(::|\})/g, '{stream.name$1');
    }
  }
  
  return config;
}

// ─── Validazione ──────────────────────────────────────────────────────────

function validateConfig(config) {
  const errors = [];

  // Valida badge globali
  for (const badge of config.globalBadges || []) {
    if (!badge.pattern) {
      errors.push(`Badge "${badge.label}" is missing a pattern.`);
      continue;
    }
    try {
      new RegExp(badge.pattern, 'i');
    } catch {
      errors.push(`Badge "${badge.label}" has an invalid regex pattern: ${badge.pattern}`);
    }
  }

  // Valida configurazioni per-addon
  for (const addonConf of config.addonConfigs || []) {
    const prefix = `Addon "${addonConf.name || addonConf.addonId}"`;

    // Valida nameTemplate
    if (addonConf.nameTemplate) {
      const unknown = getUnknownVars(addonConf.nameTemplate);
      if (unknown.length) {
        errors.push(`${prefix} nameTemplate uses unknown variables: ${unknown.map(v => `{${v}}`).join(', ')}`);
      }
    }

    // Valida titleTemplate
    if (addonConf.titleTemplate) {
      const unknown = getUnknownVars(addonConf.titleTemplate);
      if (unknown.length) {
        errors.push(`${prefix} titleTemplate uses unknown variables: ${unknown.map(v => `{${v}}`).join(', ')}`);
      }
    }

    // Valida descriptionTemplate
    if (addonConf.descriptionTemplate) {
      const unknown = getUnknownVars(addonConf.descriptionTemplate);
      if (unknown.length) {
        errors.push(`${prefix} descriptionTemplate uses unknown variables: ${unknown.map(v => `{${v}}`).join(', ')}`);
      }
    }

    // Valida badge per-addon
    for (const badge of addonConf.badges || []) {
      if (!badge.pattern) {
        errors.push(`${prefix}: badge "${badge.label}" is missing a pattern.`);
        continue;
      }
      try {
        new RegExp(badge.pattern, 'i');
      } catch {
        errors.push(`${prefix}: badge "${badge.label}" has an invalid regex: ${badge.pattern}`);
      }
    }

    // Transport URL must be present if enabled
    if (addonConf.enabled && !addonConf.transportUrl) {
      errors.push(`${prefix}: is enabled but has no transportUrl.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Default config ──────────────────────────────────────────────────────

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
      globalNameTemplate: null,
      globalDescriptionTemplate: null,
    },
  };
}

module.exports = {
  getUserConfig,
  saveUserConfig,
  deleteUserConfig,
  validateConfig,
  getDefaultConfig,
  AIOSTREAMS_VARS,
  VALID_OBJECT_ROOTS,
};