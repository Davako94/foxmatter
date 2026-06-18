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

// Whitelist estesa radice degli oggetti supportati secondo le specifiche ufficiali AIOStreams
const VALID_OBJECT_ROOTS = new Set([
  'config',
  'stream',
  'service',
  'addon',
  'metadata',
  'debug',
  'tools'
]);

// Manteniamo le variabili Foxmatter originali come fallback legacy
const VALID_TEMPLATE_VARS = new Set([
  'original_name', 'original_title', 'original_description',
  'quality', 'size', 'seeders', 'audio', 'language',
  'codec', 'source', 'release_group', 'badges',
]);

/**
 * Load a user's full formatting configuration.
 * Returns null if no config has been saved yet.
 * @param {string} userId
 * @returns {object|null}
 */
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

/**
 * Persist (upsert) a user's full formatting configuration.
 * @param {string} userId
 * @param {object} config - Validated config object
 */
async function saveUserConfig(userId, config) {
  const { error } = await supabase
    .from('user_configs')
    .upsert(
      {
        user_id: userId,
        config,
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

/**
 * Delete a user's configuration (e.g. on account deletion).
 * @param {string} userId
 */
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

/**
 * Validate a configuration object before saving.
 * Checks template syntax, badge regex patterns, etc.
 *
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];

  // Validate global badge patterns
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

  // Validate per-addon configs
  for (const addonConf of config.addonConfigs || []) {
    const prefix = `Addon "${addonConf.name || addonConf.addonId}"`;

    // Validate templates
    for (const field of ['nameTemplate', 'titleTemplate', 'descriptionTemplate']) {
      const tpl = addonConf[field];
      if (!tpl) continue;

      const unknownVars = extractTemplateVars(tpl).filter(v => {
        // Ignora i costrutti speciali ereditati
        if (v.startsWith('badge:')) return false;
        if (v.startsWith('if:')) return false;
        
        // Estrae il nome puro della variabile isolandolo da modificatori (es. 'stream.title::upper' -> 'stream.title')
        const rawVar = v.split('::')[0].trim();
        
        // Gestione delle strutture con notazione a punto di AIOStreams (es: stream.title, metadata.genres)
        if (rawVar.includes('.')) {
          const root = rawVar.split('.')[0];
          if (VALID_OBJECT_ROOTS.has(root)) return false; // È un oggetto AIOStreams valido
        }

        // Controllo finale sulla whitelist piatta o legacy
        return !VALID_TEMPLATE_VARS.has(rawVar);
      });

      if (unknownVars.length) {
        errors.push(`${prefix} ${field} uses unknown variables: ${unknownVars.map(v => `{${v}}`).join(', ')}`);
      }
    }

    // Validate addon-level badge patterns
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

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract all {variable} names from a template string.
 */
function extractTemplateVars(template) {
  if (typeof template !== 'string') return [];
  const matches = template.matchAll(/\{([^}]+)\}/g);
  return [...matches].map(m => m[1].trim());
}

module.exports = {
  getUserConfig,
  saveUserConfig,
  deleteUserConfig,
  validateConfig,
};