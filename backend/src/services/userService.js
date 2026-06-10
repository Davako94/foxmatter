// services/userService.js - User persistence via Supabase for Foxmatter
//
// Supabase table: users
//   id              uuid primary key default gen_random_uuid()
//   stremio_id      text unique not null
//   email           text unique not null
//   name            text
//   stremio_auth_key text          -- store encrypted in prod
//   created_at      timestamptz default now()
//   updated_at      timestamptz default now()

const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Create a new user row or update an existing one (upsert by stremio_id).
 * @param {{ stremioId, email, name, stremioAuthKey }} data
 * @returns {object} user row
 */
async function createOrUpdateUser({ stremioId, email, name, stremioAuthKey }) {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        stremio_id: stremioId,
        email,
        name,
        stremio_auth_key: stremioAuthKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stremio_id', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    logger.error('createOrUpdateUser error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return normalizeUser(data);
}

/**
 * Fetch a user by their internal UUID.
 * @param {string} userId - Our internal UUID
 * @returns {object|null}
 */
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

/**
 * Fetch a user by their Stremio account ID.
 * @param {string} stremioId
 * @returns {object|null}
 */
async function getUserByStremioId(stremioId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('stremio_id', stremioId)
    .maybeSingle();

  if (error) {
    logger.error('getUserByStremioId error:', error.message);
    throw new Error(`DB error: ${error.message}`);
  }

  return data ? normalizeUser(data) : null;
}

/**
 * Delete a user and cascade their configs.
 * (Supabase foreign key ON DELETE CASCADE handles child rows.)
 */
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

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Map snake_case DB columns → camelCase for application code.
 * Never expose stremio_auth_key to API responses.
 */
function normalizeUser(row) {
  return {
    id: row.id,
    stremioId: row.stremio_id,
    email: row.email,
    name: row.name,
    stremioAuthKey: row.stremio_auth_key, // Only used server-side
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createOrUpdateUser,
  getUserById,
  getUserByStremioId,
  deleteUser,
};