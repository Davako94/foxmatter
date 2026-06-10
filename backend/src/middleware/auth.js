// middleware/auth.js - JWT authentication middleware for Foxmatter
const { verifyToken } = require('../utils/jwt');
const { logger } = require('../utils/logger');

/**
 * Express middleware that validates Bearer JWT from Authorization header.
 * Attaches decoded payload to req.user on success.
 * Returns 401 on missing / invalid / expired token.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    req.user = payload; // { userId, stremioId, email, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    logger.warn(`Auth failed: ${err.message}`);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Optional auth — populates req.user if token present, but doesn't block.
 * Useful for routes that behave differently for logged-in users.
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(authHeader.slice(7));
    } catch {
      // silently ignore invalid token
    }
  }
  next();
}

module.exports = { authenticate, optionalAuthenticate };