# Complete Supabase Setup Guide for FoxMatter

## Part 1: Supabase Dashboard Setup (Do This First!)

### Step 1: Create Supabase Project

1. Go to **[supabase.com](https://supabase.com)**
2. Sign up or log in
3. Click **"New Project"**
4. Fill in:
   - **Project Name**: `foxmatter` (or your preference)
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Pick closest to your users (e.g., `us-east-1`)
5. Click **"Create new project"** (takes 2-5 minutes)

### Step 2: Get Your API Keys

Once project is created:

1. Go to **Settings → API**
2. Copy these values to your `.env` file:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** (API Key) → `SUPABASE_ANON_KEY`
   - **service_role secret** (API Key) → `SUPABASE_SERVICE_ROLE_KEY`

```bash
# .env file
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5...
```

### Step 3: Create Tables (SQL)

1. Go to **SQL Editor** in Supabase
2. Click **"New Query"**
3. Paste this SQL and click **"Run"**:

```sql
-- ========== PROFILES TABLE ==========
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('format', 'badge')),
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled BOOLEAN DEFAULT true,
  config JSONB NOT NULL,
  author TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, type, name)
);

-- ========== ADDON MAPPINGS TABLE ==========
CREATE TABLE addon_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addon_id TEXT NOT NULL,
  format_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  badge_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, addon_id)
);

-- ========== USER SETTINGS TABLE ==========
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_format_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  default_badge_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  enable_formatting BOOLEAN DEFAULT true,
  enable_badges BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ========== CREATE INDEXES ==========
CREATE INDEX idx_profiles_user ON profiles(user_id);
CREATE INDEX idx_profiles_type ON profiles(type);
CREATE INDEX idx_profiles_enabled ON profiles(enabled);
CREATE INDEX idx_addon_mappings_user ON addon_mappings(user_id);
CREATE INDEX idx_addon_mappings_addon ON addon_mappings(addon_id);

-- ========== ENABLE ROW LEVEL SECURITY ==========
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE addon_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
```

### Step 4: Setup Row Level Security (RLS) Policies

Still in **SQL Editor**, run each query:

#### Profiles RLS Policies:
```sql
-- Users can view only their own profiles
CREATE POLICY "Users can view own profiles"
ON profiles FOR SELECT
USING (auth.uid() = user_id);

-- Users can create profiles
CREATE POLICY "Users can insert own profiles"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own profiles
CREATE POLICY "Users can update own profiles"
ON profiles FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profiles
CREATE POLICY "Users can delete own profiles"
ON profiles FOR DELETE
USING (auth.uid() = user_id);
```

#### Addon Mappings RLS Policies:
```sql
CREATE POLICY "Users can view own addon mappings"
ON addon_mappings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert addon mappings"
ON addon_mappings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mappings"
ON addon_mappings FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mappings"
ON addon_mappings FOR DELETE
USING (auth.uid() = user_id);
```

#### User Settings RLS Policies:
```sql
CREATE POLICY "Users can view own settings"
ON user_settings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
ON user_settings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
ON user_settings FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
ON user_settings FOR DELETE
USING (auth.uid() = user_id);
```

### Step 5: Enable Authentication

1. Go to **Authentication → Providers**
2. Enable **Email** (should be on by default)
3. Go to **Email Templates** and customize if you want
4. **Optional**: Enable Google, Discord, GitHub OAuth

### Step 6: Verify Setup

1. Go to **Table Editor**
2. You should see 3 new tables:
   - `profiles`
   - `addon_mappings`
   - `user_settings`
3. All should have a lock icon 🔒 (meaning RLS is enabled)

✅ **Supabase is ready!**

---

## Part 2: Your Backend Code

### Step 1: Update `.env` file

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT (for your token signing)
JWT_SECRET=your-super-secret-key
JWT_EXPIRY=7d

# Other
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
```

### Step 2: Create Supabase Client File

Create `src/services/supabaseClient.js`:

```javascript
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
}

// Client for regular operations (uses RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for backend operations (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

logger.info('✅ Supabase clients initialized');

module.exports = { supabase, supabaseAdmin };
```

### Step 3: Create Profile Service

Create `src/services/profileService.js`:

```javascript
const { supabase, supabaseAdmin } = require('./supabaseClient');
const { logger } = require('../utils/logger');

class ProfileService {
  /**
   * Get a specific profile by ID
   */
  async getProfile(userId, profileId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('id', profileId)
      .single();

    if (error) {
      logger.error(`Error fetching profile: ${error.message}`);
      return null;
    }

    return data;
  }

  /**
   * List all profiles for a user
   */
  async listProfiles(userId, type = null) {
    let query = supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true)
      .order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) {
      logger.error(`Error listing profiles: ${error.message}`);
      return [];
    }

    return data || [];
  }

  /**
   * Create a new profile
   */
  async createProfile(userId, { type, name, config, description = '', author = null, tags = [] }) {
    const { data, error } = await supabase
      .from('profiles')
      .insert([
        {
          user_id: userId,
          type,
          name,
          config,
          description,
          author,
          tags,
          version: '1.0.0',
          enabled: true,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error(`Error creating profile: ${error.message}`);
      return null;
    }

    logger.info(`Created profile: ${name} (${type})`);
    return data;
  }

  /**
   * Update a profile
   */
  async updateProfile(userId, profileId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date() })
      .eq('user_id', userId)
      .eq('id', profileId)
      .select()
      .single();

    if (error) {
      logger.error(`Error updating profile: ${error.message}`);
      return null;
    }

    logger.info(`Updated profile: ${profileId}`);
    return data;
  }

  /**
   * Delete a profile
   */
  async deleteProfile(userId, profileId) {
    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('user_id', userId)
      .eq('id', profileId);

    if (error) {
      logger.error(`Error deleting profile: ${error.message}`);
      return false;
    }

    logger.info(`Deleted profile: ${profileId}`);
    return true;
  }

  /**
   * Get user's default format profile
   */
  async getDefaultFormatProfile(userId) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('default_format_profile_id')
      .eq('user_id', userId)
      .single();

    if (!settings?.default_format_profile_id) {
      // Return built-in default
      return {
        version: '1.0.0',
        templates: { title: '{{title}}' },
        rules: [],
        options: {},
      };
    }

    const profile = await this.getProfile(userId, settings.default_format_profile_id);
    return profile?.config || null;
  }

  /**
   * Get user's default badge profile
   */
  async getDefaultBadgeProfile(userId) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('default_badge_profile_id')
      .eq('user_id', userId)
      .single();

    if (!settings?.default_badge_profile_id) {
      // Return built-in default
      return {
        version: '1.0.0',
        badges: [],
        options: {},
      };
    }

    const profile = await this.getProfile(userId, settings.default_badge_profile_id);
    return profile?.config || null;
  }

  /**
   * Set addon profile mapping
   */
  async setAddonMapping(userId, addonId, formatProfileId, badgeProfileId) {
    const { data, error } = await supabase
      .from('addon_mappings')
      .upsert([
        {
          user_id: userId,
          addon_id: addonId,
          format_profile_id: formatProfileId || null,
          badge_profile_id: badgeProfileId || null,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error(`Error setting addon mapping: ${error.message}`);
      return null;
    }

    logger.info(`Mapped addon ${addonId} to profiles`);
    return data;
  }

  /**
   * Get addon profile mapping
   */
  async getAddonMapping(userId, addonId) {
    const { data, error } = await supabase
      .from('addon_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('addon_id', addonId)
      .eq('enabled', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      logger.warn(`Error getting addon mapping: ${error.message}`);
    }

    return data || null;
  }

  /**
   * Set user defaults
   */
  async setUserDefaults(userId, { defaultFormatProfileId, defaultBadgeProfileId }) {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert([
        {
          user_id: userId,
          default_format_profile_id: defaultFormatProfileId || null,
          default_badge_profile_id: defaultBadgeProfileId || null,
        },
      ])
      .select()
      .single();

    if (error) {
      logger.error(`Error setting user defaults: ${error.message}`);
      return null;
    }

    return data;
  }
}

module.exports = new ProfileService();
```

### Step 4: Create API Routes

Create `src/routes/profiles.js`:

```javascript
const express = require('express');
const { authenticate } = require('../middleware/auth');
const profileService = require('../services/profileService');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/profiles
 * List user's profiles
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { type } = req.query; // Optional: 'format' or 'badge'
    const profiles = await profileService.listProfiles(req.user.userId, type);

    res.json({
      success: true,
      profiles,
      count: profiles.length,
    });
  } catch (error) {
    logger.error(`Error listing profiles: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/profiles/:id
 * Get a specific profile
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const profile = await profileService.getProfile(req.user.userId, req.params.id);

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, profile });
  } catch (error) {
    logger.error(`Error fetching profile: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/profiles
 * Create a new profile
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { type, name, config, description, tags } = req.body;

    // Basic validation
    if (!type || !['format', 'badge'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid profile type' });
    }

    if (!name || !config) {
      return res.status(400).json({ success: false, error: 'Name and config required' });
    }

    const profile = await profileService.createProfile(req.user.userId, {
      type,
      name,
      config,
      description,
      author: req.user.userId,
      tags,
    });

    if (!profile) {
      return res.status(500).json({ success: false, error: 'Failed to create profile' });
    }

    res.status(201).json({ success: true, profile });
  } catch (error) {
    logger.error(`Error creating profile: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/profiles/:id
 * Update a profile
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, config, description, enabled } = req.body;

    const profile = await profileService.updateProfile(req.user.userId, req.params.id, {
      name,
      config,
      description,
      enabled,
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, profile });
  } catch (error) {
    logger.error(`Error updating profile: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/profiles/:id
 * Delete a profile
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const deleted = await profileService.deleteProfile(req.user.userId, req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, message: 'Profile deleted' });
  } catch (error) {
    logger.error(`Error deleting profile: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/profiles/:id/set-default-format
 * Set default format profile
 */
router.post('/:id/set-default-format', authenticate, async (req, res) => {
  try {
    const result = await profileService.setUserDefaults(req.user.userId, {
      defaultFormatProfileId: req.params.id,
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error(`Error setting default: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/profiles/:id/set-default-badge
 * Set default badge profile
 */
router.post('/:id/set-default-badge', authenticate, async (req, res) => {
  try {
    const result = await profileService.setUserDefaults(req.user.userId, {
      defaultBadgeProfileId: req.params.id,
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error(`Error setting default: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```

### Step 5: Create Addon Mapping Routes

Create `src/routes/addon-mappings.js`:

```javascript
const express = require('express');
const { authenticate } = require('../middleware/auth');
const profileService = require('../services/profileService');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/addon-mappings/:addonId
 * Get mapping for an addon
 */
router.get('/:addonId', authenticate, async (req, res) => {
  try {
    const mapping = await profileService.getAddonMapping(req.user.userId, req.params.addonId);

    res.json({
      success: true,
      mapping: mapping || null,
    });
  } catch (error) {
    logger.error(`Error getting addon mapping: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/addon-mappings/:addonId
 * Set mapping for an addon
 */
router.put('/:addonId', authenticate, async (req, res) => {
  try {
    const { formatProfileId, badgeProfileId } = req.body;

    const mapping = await profileService.setAddonMapping(
      req.user.userId,
      req.params.addonId,
      formatProfileId,
      badgeProfileId
    );

    if (!mapping) {
      return res.status(500).json({ success: false, error: 'Failed to set mapping' });
    }

    res.json({ success: true, mapping });
  } catch (error) {
    logger.error(`Error setting addon mapping: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
```

### Step 6: Register Routes in `index.js`

Update `src/index.js` to include new routes:

```javascript
// ... existing imports ...
const profileRoutes = require('./routes/profiles');
const addonMappingRoutes = require('./routes/addon-mappings');

// ... existing middleware setup ...

// ─── Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/addon-mappings', addonMappingRoutes);
app.use('/api/addons', addonRoutes);
app.use('/api/config', configRoutes);
app.use('/api/proxy', proxyLimiter, proxyRoutes);

// ... rest of existing code ...
```

---

## Part 3: Testing It Works

### Test with cURL or Postman

```bash
# 1. Login (get token)
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123456"
  }'

# Response:
# {
#   "success": true,
#   "token": "eyJhbGciOiJIUzI1NiIs..."
# }

# 2. Create a format profile
curl -X POST http://localhost:3001/api/profiles \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "format",
    "name": "My 4K Format",
    "description": "Premium 4K formatting",
    "config": {
      "version": "1.0.0",
      "templates": {
        "title": "🎬 {{title}} ({{year}})"
      },
      "rules": [],
      "options": {}
    }
  }'

# 3. List profiles
curl -X GET http://localhost:3001/api/profiles \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. Set addon mapping
curl -X PUT http://localhost:3001/api/addon-mappings/my-addon-id \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "formatProfileId": "PROFILE_ID_FROM_STEP_2",
    "badgeProfileId": null
  }'
```

---

## Summary

### On Supabase Dashboard:
✅ Create project  
✅ Copy API keys  
✅ Create 3 tables (profiles, addon_mappings, user_settings)  
✅ Setup RLS policies  
✅ Enable authentication  

### In Your Code:
✅ Add `.env` variables  
✅ Create `supabaseClient.js`  
✅ Create `profileService.js`  
✅ Create `routes/profiles.js`  
✅ Create `routes/addon-mappings.js`  
✅ Update `index.js` to register routes  

**You're all set to use Supabase with FoxMatter!** 🎉
