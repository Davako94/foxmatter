// routes/auth.js - Auth per Stremio e Nuvio
const express = require('express');
const router  = express.Router();
const { z }   = require('zod');
const { stremioAuth }             = require('../services/stremioService');
const { nuvioAuth }               = require('../services/nuvioService');
const { createOrUpdateUser, createOrUpdateNuvioUser } = require('../services/userService');
const { signToken, verifyToken }  = require('../utils/jwt');
const { asyncHandler }            = require('../middleware/errorHandler');

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ─── POST /api/auth/login  (Stremio) ───────────────────────────────────────
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const result = await stremioAuth(email, password);
  if (!result.success) {
    return res.status(401).json({ error: 'Credenziali Stremio non valide', detail: result.error });
  }

  const { authKey, user: stremioUser } = result;

  const user = await createOrUpdateUser({
    stremioId:    stremioUser._id,
    email:        stremioUser.email || email,
    name:         stremioUser.name  || email.split('@')[0],
    stremioAuthKey: authKey,
  });

  const token = signToken({
    userId:   user.id,
    provider: 'stremio',
    email:    user.email,
  });

  res.json({
    token,
    provider: 'stremio',
    user: { id: user.id, email: user.email, name: user.name },
  });
}));

// ─── POST /api/auth/login/nuvio ────────────────────────────────────────────
router.post('/login/nuvio', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const result = await nuvioAuth(email, password);
  if (!result.success) {
    return res.status(401).json({ error: 'Credenziali Nuvio non valide', detail: result.error });
  }

  const { accessToken, refreshToken, user: nuvioUser } = result;

  const user = await createOrUpdateNuvioUser({
    nuvioUserId:  nuvioUser.id,
    email:        nuvioUser.email || email,
    name:         nuvioUser.name  || email.split('@')[0],
    accessToken,
    refreshToken,
  });

  const token = signToken({
    userId:   user.id,
    provider: 'nuvio',
    email:    user.email,
  });

  res.json({
    token,
    provider: 'nuvio',
    user: { id: user.id, email: user.email, name: user.name },
  });
}));

// ─── POST /api/auth/logout ─────────────────────────────────────────────────
router.post('/logout', asyncHandler(async (req, res) => {
  res.json({ success: true });
}));

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const payload = verifyToken(authHeader.slice(7));
  res.json({ userId: payload.userId, provider: payload.provider, email: payload.email });
}));

module.exports = router;
