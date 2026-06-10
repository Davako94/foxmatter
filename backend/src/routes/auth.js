// routes/auth.js - Stremio authentication + JWT issuance
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { stremioAuth } = require('../services/stremioService');
const { createOrUpdateUser } = require('../services/userService');
const { signToken, verifyToken } = require('../utils/jwt');
const { asyncHandler } = require('../middleware/errorHandler');

// ─── Validation schemas ────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────
// Authenticate with Stremio, get authKey, create local JWT
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  // 1. Authenticate with Stremio API
  const stremioResult = await stremioAuth(email, password);
  
  if (!stremioResult.success) {
    return res.status(401).json({
      error: 'Invalid Stremio credentials',
      detail: stremioResult.error,
    });
  }

  const { authKey, user: stremioUser } = stremioResult;

  // 2. Upsert user in our database
  const user = await createOrUpdateUser({
    stremioId: stremioUser._id,
    email: stremioUser.email,
    name: stremioUser.name || email.split('@')[0],
    stremioAuthKey: authKey, // Stored encrypted in DB
  });

  // 3. Issue our own JWT (never expose stremioAuthKey to frontend)
  const token = signToken({
    userId: user.id,
    stremioId: stremioUser._id,
    email: user.email,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      stremioId: stremioUser._id,
    },
  });
}));

// ─── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', asyncHandler(async (req, res) => {
  // Stateless JWT - just acknowledge. Frontend discards the token.
  // If you add a token blocklist, revoke here.
  res.json({ success: true });
}));

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  
  res.json({
    userId: payload.userId,
    stremioId: payload.stremioId,
    email: payload.email,
  });
}));

module.exports = router;