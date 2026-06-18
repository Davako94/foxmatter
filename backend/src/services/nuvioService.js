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
 * Returns { success, accessToken, refreshToken, user }
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
 * Reads from the `addons` table in Nuvio's Supabase.
 */
async function fetchNuvioAddons(accessToken, nuvioUserId) {
  try {
    const client = restClient(accessToken);

    // Fetch only enabled addons for this user
    const res = await client.get('/addons', {
      params: {
        user_id: `eq.${nuvioUserId}`,
        enabled:  'eq.true',
        select:   '*',
        order:    'created_at.asc',
      },
    });

    const rows = res.data || [];
    logger.info(`Fetched ${rows.length} Nuvio addons for user ${nuvioUserId}`);

    const addons = rows
      .map(row => normalizeNuvioAddon(row))
      .filter(a => a !== null);

    return { success: true, addons };
  } catch (err) {
    logger.error('fetchNuvioAddons error:', err.message);
    return { success: false, error: err.message, addons: [] };
  }
}

/**
 * Refresh a Nuvio access token using the refresh token.
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

/**
 * Normalize a Nuvio addon DB row into our standard format.
 */
function normalizeNuvioAddon(row) {
  try {
    // Shape A: manifest already in the row
    if (row.manifest && typeof row.manifest === 'object') {
      const transportUrl = row.manifest_url || row.manifest?.transportUrl;
      if (!transportUrl) return null;
      
      return normalizeAddon({
        transportUrl: transportUrl.replace(/\/manifest\.json$/, ''),
        manifest: row.manifest,
      });
    }

    // Shape B: only a URL
    if (row.manifest_url) {
      const url = row.manifest_url;
      const slug = url
        .replace(/^https?:\/\//, '')
        .replace(/\/manifest\.json$/, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .toLowerCase()
        .slice(0, 60);

      return {
        id:           row.id || slug,
        name:         row.name || slug,
        version:      '0.0.0',
        description:  '',
        logo:         null,
        transportUrl: url.replace(/\/manifest\.json$/, ''),
        types:        ['movie', 'series'],
        catalogs:     [],
        resources:    ['stream'],
        idPrefixes:   ['tt'],
        behaviorHints: {},
        slug,
        isProxiable:  true,
      };
    }

    logger.warn('Nuvio addon row has neither manifest nor manifest_url — skipping', row);
    return null;
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