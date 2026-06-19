// Foxmatter Backend - Main Entry Point
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const addonRoutes = require('./routes/addons');
const configRoutes = require('./routes/config');
const proxyRoutes = require('./routes/proxy');
const { errorHandler } = require('./middleware/errorHandler');
const { logger } = require('./utils/logger');
const { verifyToken } = require('./utils/jwt');
const { parseTemplate, buildStreamContext } = require('./services/templateEngine');

const app = express();
app.set('trust proxy', 1); // se dietro a un reverse proxy (es. Heroku, Cloudflare) per ottenere IP reali e abilitare rate limiting basato os IP
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// ─── Security (Helmet configurato per sbloccare gli script-attr e gli stili inline della UI) ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"],
      // ABILITA GLI EVENTI INLINE (Risolve il blocco su onclick="window.saveAddonConfig()")
      "script-src-attr": ["'unsafe-inline'"],
      // ABILITA GLI STILI INLINE (Risolve il blocco su this.style.display='none')
      "style-src": ["'self'", "'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false
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
  standardHeaders: true, legacyHeaders: false,
});
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
});

// ─── Parsing & logging (Aumentato a 50mb per supportare file JSON massivi come AIOMetadata) ───
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ─── Static files (configure page) ────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Funzione Universale applicata ad ogni stream processato dal backend
 */
app.use((req, res, next) => {
  res.applyUniversalFormatter = function(streams, config, addonName = "Foxmatter") {
    if (!streams || !Array.isArray(streams)) return streams;
    if (!config?.namingTemplate && !config?.descriptionTemplate) return streams;

    return streams.map(stream => {
      const ctx = buildStreamContext(stream, { name: addonName }, config);

      const newName = config.namingTemplate 
        ? parseTemplate(config.namingTemplate, ctx) 
        : stream.name;

      const newTitle = config.descriptionTemplate 
        ? parseTemplate(config.descriptionTemplate, ctx)
        : stream.title;

      return {
        ...stream,
        name: newName.trim() || stream.name,
        title: newTitle.trim() || stream.title
      };
    });
  };
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────
app.use('/api/auth',   limiter, authRoutes);
app.use('/api/addons', limiter, addonRoutes);
app.use('/api/config', limiter, configRoutes);
app.use('/proxy',      proxyLimiter, proxyRoutes);

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── /api/me — decode JWT → return userId + install URLs ──────────────────
app.get('/api/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Provide: Authorization: Bearer <token>' });
  }
  try {
    const payload = verifyToken(authHeader.slice(7));
    res.json({
      userId:            payload.userId,
      stremioId:         payload.stremioId,
      email:             payload.email,
      installUrl:        `${BASE_URL}/proxy/${payload.userId}/manifest.json`,
      stremioInstallUrl: `stremio://${BASE_URL.replace(/^https?:\/\//, '')}/proxy/${payload.userId}/manifest.json`,
    });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// ─── Error handler (must be last) ─────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Foxmatter running on port ${PORT} — ${BASE_URL}`);
});

module.exports = app;
