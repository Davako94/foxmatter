
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ─── Stremio user ──────────────────────────────────────────────────────────

async function createOrUpdateUser({ stremioId, email, name, stremioAuthKey }) {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        provider:         'stremio',
        provider_id:      stremioId,
        email,
        name,
        stremio_auth_key: stremioAuthKey,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: 'provider,provider_id', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    logger.error('createOrUpdateUser (stremio) error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return normalizeUser(data);
}

// ─── Nuvio user ────────────────────────────────────────────────────────────

async function createOrUpdateNuvioUser({ nuvioUserId, email, name, accessToken, refreshToken }) {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        provider:             'nuvio',
        provider_id:          nuvioUserId,
        email,
        name,
        nuvio_user_id:        nuvioUserId,
        nuvio_access_token:   accessToken,
        nuvio_refresh_token:  refreshToken,
        updated_at:           new Date().toISOString(),
      },
      { onConflict: 'provider,provider_id', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    logger.error('createOrUpdateNuvioUser error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return normalizeUser(data);
}

// ─── Generic lookups ───────────────────────────────────────────────────────

async function getUserById(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.error('getUserById error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return data ? normalizeUser(data) : null;
}

async function getUserByStremioId(stremioId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('provider', 'stremio')
    .eq('provider_id', stremioId)
    .maybeSingle();

  if (error) {
    logger.error('getUserByStremioId error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return data ? normalizeUser(data) : null;
}

async function deleteUser(userId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);

  if (error) {
    logger.error('deleteUser error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  logger.info(`Deleted user ${userId}`);
  return true;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeUser(row) {
  return {
    id:                 row.id,
    provider:           row.provider || 'stremio',
    providerId:         row.provider_id,
    email:              row.email,
    name:               row.name,
    // Stremio
    stremioAuthKey:     row.stremio_auth_key,
    // Nuvio
    nuvioUserId:        row.nuvio_user_id,
    nuvioAccessToken:   row.nuvio_access_token,
    nuvioRefreshToken:  row.nuvio_refresh_token,
    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

module.exports = {
  createOrUpdateUser,
  createOrUpdateNuvioUser,
  getUserById,
  getUserByStremioId,
  deleteUser,
};
