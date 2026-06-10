// middleware/errorHandler.js - Centralised error handling for Foxmatter
const { logger } = require('../utils/logger');
const { ZodError } = require('zod');

/**
 * Wraps an async route handler and passes any thrown error to next().
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Express error-handling middleware (4-arg signature required).
 * Must be registered LAST with app.use().
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.flatten(),
    });
  }

  // Axios upstream errors
  if (err.isAxiosError) {
    const status = err.response?.status || 502;
    logger.warn(`Upstream HTTP error ${status}: ${err.config?.url}`);
    return res.status(502).json({
      error: 'Upstream addon error',
      status,
      url: err.config?.url,
    });
  }

  // JWT errors (shouldn't normally reach here — auth middleware handles them)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Generic server error
  logger.error(`Unhandled error [${req.method} ${req.path}]:`, err.message, err.stack);

  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: 'Internal server error',
    ...(isDev && { message: err.message, stack: err.stack }),
  });
}

module.exports = { asyncHandler, errorHandler };