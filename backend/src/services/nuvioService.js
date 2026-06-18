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
 */
async function fetchNuvioAddons(accessToken, nuvioUserId) {
  try {
    const client = restClient(accessToken);

    const res = await client.get('/addons', {
      params: {
        user_id: `eq.${nuvioUserId}`,
        enabled:  'eq.true',
        select:   '*',
        order:    'created_at.asc',
      },
    });

    const rows = res.data || [];
    
    // Filtriamo e normalizziamo solo gli addon che sono effettivamente proxiabili (stream)
    const seenUrls = new Set();
    const addons = [];

    for (const row of rows) {
      const normalized = normalizeNuvioAddon(row);
      
      // Qui filtriamo attivamente: se non è proxiabile, non lo passiamo alla lista
      if (normalized && normalized.isProxiable) {
        if (seenUrls.has(normalized.transportUrl)) {
          continue; 
        }
        seenUrls.add(normalized.transportUrl);
        addons.push(normalized);
      }
    }

    return { success: true, addons };
  } catch (err) {
    logger.error('fetchNuvioAddons error:', err.message);
    return { success: false, error: err.message, addons: [] };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeNuvioAddon(row) {
  try {
    const targetUrl = row.url || row.manifest_url || row.manifest?.transportUrl;
    if (!targetUrl) return null;

    const cleanTransportUrl = targetUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');

    // Se abbiamo il manifest nel DB, usiamo la logica di normalizzazione standard (sicura)
    if (row.manifest && typeof row.manifest === 'object') {
      return normalizeAddon({
        transportUrl: cleanTransportUrl,
        manifest: row.manifest,
      });
    }

    // Se NON abbiamo il manifest, dobbiamo essere cauti.
    // Se il nome contiene riferimenti a "subtitles" o "kitsu", forziamo isProxiable a false
    const lowerName = (row.name || '').toLowerCase();
    const isMetadataOrSub = lowerName.includes('subtitles') || lowerName.includes('kitsu') || lowerName.includes('cinemeta');
    
    return {
      id: row.id || cleanTransportUrl,
      name: row.name || 'Unknown Addon',
      version: '0.0.0',
      description: '',
      logo: null,
      transportUrl: cleanTransportUrl,
      types: ['movie', 'series'],
      catalogs: [],
      resources: isMetadataOrSub ? [] : ['stream'],
      idPrefixes: ['tt'],
      behaviorHints: {},
      slug: (row.name || 'addon').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      isProxiable: !isMetadataOrSub, // <-- LOGICA CRITICA: Escludiamo i non-stream
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  nuvioAuth,
  fetchNuvioAddons,
  refreshNuvioToken,
};