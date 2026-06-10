// utils/jwt.js - Sign and verify JSON Web Tokens for Foxmatter
const jwt = require('jsonwebtoken');
const { logger } = require('./logger');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  logger.warn('JWT_SECRET is not set — using insecure fallback. Set it in .env!');
}
const EFFECTIVE_SECRET = SECRET || 'foxmatter-insecure-dev-secret';

const TOKEN_TTL = process.env.JWT_TTL || '7d'; // tokens last 7 days by default

/**
 * Sign a payload and return a JWT string.
 * @param {object} payload - Data to embed (userId, stremioId, email …)
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(payload, EFFECTIVE_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * Verify and decode a JWT.
 * Throws JsonWebTokenError / TokenExpiredError on failure.
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyToken(token) {
  return jwt.verify(token, EFFECTIVE_SECRET);
}

/**
 * Decode WITHOUT verifying — useful for reading userId from proxy URLs.
 * Never trust this for authentication!
 */
function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = { signToken, verifyToken, decodeToken };