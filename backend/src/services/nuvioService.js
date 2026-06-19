// services/nuvioService.js - Nuvio API interactions for Foxmatter
const axios = require('axios');
const { logger } = require('../utils/logger');
const { normalizeAddon } = require('./stremioService');

const NUVIO_API   = process.env.NUVIO_API_BASE   || 'https://web.nuvioapp.space';
const NUVIO_SUPA  = process.env.NUVIO_SUPABASE_URL || 'https://dpyhjjcoabcglfmgecug.supabase.co';
const NUVIO_ANON  = process.env.NUVIO_SUPABASE_ANON_KEY || '';

// ─── Clients ───────────────────────────────────────────────────────────────
const authClient = axios.create({
  baseURL: `${NUVIO_SUPA}/auth/v1`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'apikey': NUVIO_ANON,
  },
});

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
 * Auth e Refresh logic
 */
async function nuvioAuth(email, password) {
  try {
    const res = await authClient.post('/token?grant_type=password', { email, password });
    return {
      success: true,
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      user: { id: res.data.user?.id, email: res.data.user?.email }
    };
  } catch (err) {
    return { success: false, error: 'Auth failed' };
  }
}

async function refreshNuvioToken(refreshToken) {
  try {
    const res = await authClient.post('/token?grant_type=refresh_token', {
      refresh_token: refreshToken,
    });
    return {
      success: true,
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
    };
  } catch (err) {
    logger.error('refreshNuvioToken error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch and filter addons
 */
async function fetchNuvioAddons(accessToken, nuvioUserId) {
  try {
    const client = restClient(accessToken);
    const res = await client.get('/addons', {
      params: { user_id: `eq.${nuvioUserId}`, enabled: 'eq.true', select: '*', order: 'created_at.asc' }
    });

    const rows = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data?.addons) ? res.data.addons : []));
    const seenUrls = new Set();
    const addons = [];

    for (const row of rows) {
      const normalized = normalizeNuvioAddon(row);
      if (normalized && normalized.isProxiable) {
        if (!seenUrls.has(normalized.transportUrl)) {
          seenUrls.add(normalized.transportUrl);
          addons.push(normalized);
        }
      }
    }
    return { success: true, addons };
  } catch (err) {
    return { success: false, error: err.message, addons: [] };
  }
}

function normalizeNuvioAddon(row) {
  try {
    const targetUrl = row.url || row.manifest_url || row.manifestUrl || row.transportUrl || row.transport_url || row.manifest?.transportUrl || row.manifest?.url;
    if (!targetUrl) return null;
    const cleanTransportUrl = targetUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');

    if (row.manifest && typeof row.manifest === 'object') {
      return normalizeAddon({ transportUrl: cleanTransportUrl, manifest: row.manifest });
    }

    const lowerName = (row.name || '').toLowerCase();
    const isMetadataOrSub = lowerName.includes('subtitles') || lowerName.includes('kitsu') || lowerName.includes('cinemeta');
    
    return {
      id: row.id || cleanTransportUrl,
      name: row.name || 'Unknown Addon',
      transportUrl: cleanTransportUrl,
      isProxiable: !isMetadataOrSub,
      resources: isMetadataOrSub ? [] : ['stream'],
    };
  } catch (err) { return null; }
}

module.exports = {
  nuvioAuth,
  fetchNuvioAddons,
  refreshNuvioToken, // Ora è correttamente definita ed esportata
};
