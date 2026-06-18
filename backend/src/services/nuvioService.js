// services/nuvioService.js - Nuvio API interactions for Foxmatter
const axios = require('axios');
const { logger } = require('../utils/logger');
const { normalizeAddon } = require('./stremioService');

const NUVIO_API   = process.env.NUVIO_API_BASE   || 'https://web.nuvioapp.space';
const NUVIO_SUPA  = process.env.NUVIO_SUPABASE_URL || 'https://dpyhjjcoabcglfmgecug.supabase.co';
const NUVIO_ANON  = process.env.NUVIO_SUPABASE_ANON_KEY || '';

// ─── Nuvio Supabase Auth client (GoTrue REST) ──────────────────────────────
const authClient = axios.create({
  baseURL: `${NUVIO_SUPA}/auth/v1`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'apikey': NUVIO_ANON,
  },
});

// ─── Nuvio PostgREST client (for addon table) ──────────────────────────────
function restClient(accessToken) {
  return axios.create({
    baseURL: `${NUVIO_SUPA}/rest/v1`,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'apikey': NUVIO_ANON,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

/**
 * Authenticate against Nuvio (Supabase GoTrue).
 * NO AUTOLOGIN: Deve essere invocata esplicitamente con credenziali fresche.
 */
async function nuvioAuth(email, password) {
  try {
    const res = await authClient.post('/token?grant_type=password', {
      email,
      password,
    });

    const data = res.data;

    if (!data.access_token) {
      return { success: false, error: 'No access token returned' };
    }

    return {
      success: true,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      user: {
        id:    data.user?.id,
        email: data.user?.email,
        name:  data.user?.user_metadata?.name || email.split('@')[0],
      },
    };
  } catch (err) {
    logger.error('Nuvio auth error:', err.message);
    const status = err.response?.status;
    const msg    = err.response?.data?.error_description || err.response?.data?.msg;

    if (status === 400 || status === 401 || status === 422) {
      return { success: false, error: msg || 'Credenziali Nuvio non valide' };
    }
    return { success: false, error: 'Nuvio API non raggiungibile' };
  }
}

/**
 * Fetch installed addons for a Nuvio user.
 * Rimosso il rischio di duplicazione forzata ed eliminati i falsi positivi di log.
 */
async function fetchNuvioAddons(accessToken, nuvioUserId) {
  try {
    const client = restClient(accessToken);

    // Recupera solo gli addon abilitati
    const res = await client.get('/addons', {
      params: {
        user_id: `eq.${nuvioUserId}`,
        enabled:  'eq.true',
        select:   '*',
        order:    'created_at.asc',
      },
    });

    const rows = res.data || [];
    logger.info(`Fetched ${rows.length} rows from Nuvio DB for user ${nuvioUserId}`);

    // Mappa e normalizza eliminando i duplicati causati dai molteplici profile_id nello stesso account
    const seenUrls = new Set();
    const addons = [];

    for (const row of rows) {
      const normalized = normalizeNuvioAddon(row);
      if (normalized) {
        // Se l'addon è già stato inserito (es. presente in profile_id: 1 e profile_id: 2), lo saltiamo per evitare la quadruplicazione
        if (seenUrls.has(normalized.transportUrl)) {
          continue; 
        }
        seenUrls.add(normalized.transportUrl);
        addons.push(normalized);
      }
    }

    logger.info(`Normalized ${addons.length} unique Nuvio addons after de-duplication`);
    return { success: true, addons };
  } catch (err) {
    logger.error('fetchNuvioAddons error:', err.message);
    return { success: false, error: err.message, addons: [] };
  }
}

/**
 * Refresh a Nuvio access token using the refresh token.
 * Chiamato solo su richiesta esplicita del frontend/middleware controller, nessun automatismo nascosto.
 */
async function refreshNuvioToken(refreshToken) {
  try {
    const res = await authClient.post('/token?grant_type=refresh_token', {
      refresh_token: refreshToken,
    });

    return {
      success: true,
      accessToken:  res.data.access_token,
      refreshToken: res.data.refresh_token,
    };
  } catch (err) {
    logger.error('refreshNuvioToken error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeNuvioAddon(row) {
  try {
    const targetUrl = row.url || row.manifest_url || row.manifest?.transportUrl;

    // Se non c'è una sorgente URL valida, allora (e solo allora) skippiamo
    if (!targetUrl) {
      logger.warn('Nuvio addon row has no valid URL reference — skipping', JSON.stringify(row));
      return null;
    }

    const cleanTransportUrl = targetUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');

    // Shape A: Il manifest completo è già presente nel record del DB
    if (row.manifest && typeof row.manifest === 'object') {
      return normalizeAddon({
        transportUrl: cleanTransportUrl,
        manifest: row.manifest,
      });
    }

    // Shape B: Abbiamo solo la colonna `url` / `manifest_url` (il tuo caso nei log)
    const slug = cleanTransportUrl
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 60);

    return {
      id:           row.id || slug,
      name:         row.name || slug,
      version:      '0.0.0',
      description:  '',
      logo:         null,
      transportUrl: cleanTransportUrl,
      types:        ['movie', 'series'],
      catalogs:     [],
      resources:    ['stream'],
      idPrefixes:   ['tt'],
      behaviorHints: {},
      slug,
      isProxiable:  true,
    };
  } catch (err) {
    logger.warn('normalizeNuvioAddon error:', err.message);
    return null;
  }
}

module.exports = {
  nuvioAuth,
  fetchNuvioAddons,
  refreshNuvioToken,
};