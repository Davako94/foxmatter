// Foxmatter Backend - Main Entry Point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const addonRoutes = require('./routes/addons');
const configRoutes = require('./routes/config');
const proxyRoutes = require('./routes/proxy');
const { errorHandler } = require('./middleware/errorHandler');
const { logger } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security middleware ───────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Required for Stremio addon protocol
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL, /\.foxmatter\.app$/]
    : true,
  credentials: true,
}));

// ─── Rate limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Proxy endpoints need higher limits (Stremio calls them frequently)
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Parsing & logging ─────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', limiter, authRoutes);
app.use('/api/addons', limiter, addonRoutes);
app.use('/api/config', limiter, configRoutes);

// Proxy routes: /:userId/:addonSlug/... - Higher rate limits, no auth middleware
// (auth is validated per-request via userId token in the URL itself)
app.use('/proxy', proxyLimiter, proxyRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error handling ────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Foxmatter backend running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Proxy base URL: ${process.env.BASE_URL}/proxy`);
});

module.exports = app;