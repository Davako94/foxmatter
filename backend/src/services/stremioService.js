// services/stremioService.js - All Stremio API interactions
const axios = require('axios');
const { logger } = require('../utils/logger');

const STREMIO_API = process.env.STREMIO_API_BASE || 'https://api.strem.io';

// ─── Stremio API client ────────────────────────────────────────────────────
const stremioClient = axios.create({
  baseURL: STREMIO_API,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Foxmatter/1.0',
  },
});

/**
 * Authenticate with Stremio and return authKey.
 * Uses the unofficial but stable Stremio API endpoint.
 */
async function stremioAuth(email, password) {
  try {
    const response = await stremioClient.post('/api/login', {
      email,
      password,
      facebook: false,
    });

    const data = response.data;

    if (data.error) {
      return { success: false, error: data.error };
    }

    if (!data.result?.authKey) {
      return { success: false, error: 'No authKey returned from Stremio' };
    }

    return {
      success: true,
      authKey: data.result.authKey,
      user: data.result.user || { email },
    };
  } catch (err) {
    logger.error('Stremio auth error:', err.message);
    
    if (err.response?.status === 401) {
      return { success: false, error: 'Invalid credentials' };
    }
    
    return { success: false, error: 'Stremio API unavailable' };
  }
}

/**
 * Fetch all installed addons for a user.
 * Returns an array of addon manifests with their remote URLs.
 */
async function fetchUserAddons(authKey) {
  try {
    // First get the user profile to get their ID
    const profileRes = await stremioClient.get(`/api/profile?authKey=${authKey}`);
    const userId = profileRes.data.result?._id;

    if (!userId) {
      throw new Error('Could not retrieve user ID');
    }

    // Fetch addon collection
    const response = await stremioClient.get('/api/addonCollectionGet', {
      params: {
        authKey,
        type: 'User',
        id: userId,
      },
    });

    const collection = response.data.result?.addons || [];
    
    // Filter out official Stremio addons that we can't/shouldn't proxy
    // and normalize the format
    const processable = collection
      .filter(addon => addon.transportUrl && addon.manifest)
      .map(addon => normalizeAddon(addon));

    logger.info(`Fetched ${processable.length} addons for user ${userId}`);
    return { success: true, addons: processable };
  } catch (err) {
    logger.error('Error fetching user addons:', err.message);
    return { success: false, error: err.message, addons: [] };
  }
}

/**
 * Fetch the manifest from an addon's transport URL.
 * Used to refresh addon capabilities/info.
 */
async function fetchAddonManifest(transportUrl) {
  try {
    const manifestUrl = transportUrl.endsWith('/manifest.json')
      ? transportUrl
      : `${transportUrl.replace(/\/$/, '')}/manifest.json`;

    const response = await axios.get(manifestUrl, { timeout: 8000 });
    return { success: true, manifest: response.data };
  } catch (err) {
    logger.warn(`Could not fetch manifest from ${transportUrl}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Proxy a stream request to an upstream addon.
 * This is the core of the formatter - calls upstream, gets streams, we format them.
 */
async function fetchUpstreamStreams(transportUrl, type, id) {
  try {
    const baseUrl = transportUrl.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
    const streamUrl = `${baseUrl}/stream/${type}/${id}.json`;

    logger.debug(`Proxying stream request to: ${streamUrl}`);

    const response = await axios.get(streamUrl, {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Stremio/4.4 (Foxmatter proxy)',
      },
    });

    return {
      success: true,
      streams: response.data?.streams || [],
      raw: response.data,
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      logger.warn(`Upstream addon timeout: ${transportUrl}`);
      return { success: false, error: 'upstream_timeout', streams: [] };
    }
    
    logger.error(`Error fetching upstream streams: ${err.message}`);
    return { success: false, error: err.message, streams: [] };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Normalize a Stremio addon to our internal format.
 */
function normalizeAddon(addon) {
  const manifest = addon.manifest || {};
  
  return {
    id: manifest.id || addon.transportUrl,
    name: manifest.name || 'Unknown Addon',
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    logo: manifest.logo || null,
    transportUrl: addon.transportUrl,
    types: manifest.types || [],
    catalogs: manifest.catalogs || [],
    resources: manifest.resources || [],
    idPrefixes: manifest.idPrefixes || [],
    behaviorHints: manifest.behaviorHints || {},
    // Derived properties
    slug: slugify(manifest.id || manifest.name || 'addon'),
    isProxiable: Boolean(manifest.resources?.includes('stream') || 
      manifest.resources?.some?.(r => r.name === 'stream' || r === 'stream')),
  };
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

module.exports = {
  stremioAuth,
  fetchUserAddons,
  fetchAddonManifest,
  fetchUpstreamStreams,
  normalizeAddon,
};