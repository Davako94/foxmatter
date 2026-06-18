// services/stremioService.js - All Stremio API interactions
const axios = require('axios');
const { logger } = require('../utils/logger');

const STREMIO_API = process.env.STREMIO_API_BASE || 'https://api.strem.io';

const stremioClient = axios.create({
  baseURL: STREMIO_API,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Foxmatter/1.0',
  },
});

/**
 * Authenticate with Stremio.
 * NO AUTOLOGIN: Gestisce solo la chiamata esplicita.
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
 * Include de-duplication filter to prevent quadrupling if the collection returns mixed profiles.
 */
async function fetchUserAddons(authKey) {
  try {
    const profileRes = await stremioClient.get(`/api/profile?authKey=${authKey}`);
    const userId = profileRes.data.result?._id;

    if (!userId) {
      throw new Error('Could not retrieve user ID');
    }

    const response = await stremioClient.get('/api/addonCollectionGet', {
      params: {
        authKey,
        type: 'User',
        id: userId,
      },
    });

    const collection = response.data.result?.addons || [];
    
    const seenUrls = new Set();
    const processable = [];

    for (const addon of collection) {
      if (addon.transportUrl && addon.manifest) {
        const normalized = normalizeAddon(addon);
        const cleanUrl = normalized.transportUrl.replace(/\/$/, '');
        
        if (!seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);
          processable.push(normalized);
        }
      }
    }

    logger.info(`Fetched and cleaned ${processable.length} unique Stremio addons for user ${userId}`);
    return { success: true, addons: processable };
  } catch (err) {
    logger.error('Error fetching user addons:', err.message);
    return { success: false, error: err.message, addons: [] };
  }
}

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

function normalizeAddon(addon) {
  const manifest = addon.manifest || {};
  const resources = manifest.resources || [];
  
  const hasStreamResource = resources.some(r => {
    if (typeof r === 'string') return r === 'stream';
    if (r && typeof r === 'object') return r.name === 'stream';
    return false;
  });

  return {
    id: manifest.id || addon.transportUrl,
    name: manifest.name || 'Unknown Addon',
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    logo: manifest.logo || null,
    transportUrl: addon.transportUrl,
    types: manifest.types || [],
    catalogs: manifest.catalogs || [],
    resources: resources,
    idPrefixes: manifest.idPrefixes || [],
    behaviorHints: manifest.behaviorHints || {},
    slug: slugify(manifest.id || manifest.name || 'addon'),
    isProxiable: Boolean(hasStreamResource),
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