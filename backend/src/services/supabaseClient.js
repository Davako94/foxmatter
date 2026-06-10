const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  logger.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  throw new Error('Missing Supabase configuration');
}

// Client for regular operations (uses RLS for security)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for backend operations (bypasses RLS - use carefully!)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

logger.info('✅ Supabase clients initialized');
logger.debug(`Supabase URL: ${supabaseUrl}`);

module.exports = { supabase, supabaseAdmin };
