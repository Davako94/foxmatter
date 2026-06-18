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

// ============================================================================
// ENGINE PARSER UNIVERSALE PER TEMPLATE SINTASSI CUSTOM (AIOMetadata / Torrentio / DMM)
// ============================================================================

/**
 * Risolve i costrutti del template come {prop::condizione["VALORE_IF_TRUE"||"VALORE_IF_FALSE"]}
 */
function parseCustomTemplate(template, streamContext) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{([^}]+)\}/g, (match, expression) => {
    // Separiamo i blocchi delimitati da ::
    // Esempio: stream.resolution::=2160p["4K🔥UHD"||""]
    const parts = expression.split('::');
    const mainProp = parts[0].trim();

    // Estraiamo il valore effettivo dall'oggetto di contesto dello stream
    const actualValue = getContextValue(streamContext, mainProp);

    // Cerchiamo se c'è un blocco di output condizionale tipo ["TRUE"||"FALSE"]
    const lastPart = parts[parts.length - 1];
    const outputMatch = lastPart.match(/\[\s*"(.*?)"\s*\|\|\s*"(.*?)"\s*\]/);
    
    let valueIfTrue = match; // fallback
    let valueIfFalse = '';
    if (outputMatch) {
      valueIfTrue = outputMatch[1];
      valueIfFalse = outputMatch[2];
    }

    // Valutazione delle condizioni specifiche
    if (parts.length === 1) {
      // Semplice placeholder {stream.title} o {addon.name}
      return actualValue !== undefined && actualValue !== null ? String(actualValue) : '';
    }

    // Se include un modificatore di stringa esteso (es: ::title, ::bytes, ::replace)
    if (parts.some(p => p.includes('replace') || p.includes('join') || p === 'title' || p === 'bytes')) {
      return applyStringFilters(actualValue, parts) || valueIfFalse;
    }

    // Verifica delle condizioni logiche
    let conditionMet = false;
    
    for (let i = 1; i < parts.length; i++) {
      const cond = parts[i].trim();

      if (cond === 'exists') {
        conditionMet = actualValue !== undefined && actualValue !== null && actualValue !== '';
      } else if (cond === 'istrue') {
        conditionMet = actualValue === true || actualValue === 'true';
      } else if (cond === 'isfalse') {
        conditionMet = actualValue === false || actualValue === 'false' || !actualValue;
      } else if (cond.startsWith('=')) {
        const targetStr = cond.slice(1).split('[')[0].trim();
        conditionMet = String(actualValue).toLowerCase() === targetStr.toLowerCase();
      } else if (cond.startsWith('~')) {
        const targetSub = cond.slice(1).split('[')[0].trim();
        conditionMet = String(actualValue).toLowerCase().includes(targetSub.toLowerCase());
      } else if (cond.startsWith('>')) {
        const num = parseFloat(cond.slice(1).split('[')[0]);
        conditionMet = parseFloat(actualValue) > num;
      }
    }

    return conditionMet ? valueIfTrue : valueIfFalse;
  });
}

function getContextValue(ctx, path) {
  return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, ctx);
}

function applyStringFilters(val, parts) {
  let result = val === undefined || val === null ? '' : String(val);
  
  for (const part of parts) {
    const p = part.trim();
    if (p === 'title') {
      result = result.toUpperCase();
    } else if (p.startsWith('replace')) {
      // Esegue le catene di ::replace('A','B')
      const matches = p.match(/replace\('(.*?)','(.*?)'\)/);
      if (matches) {
        const search = matches[1];
        const replaceWith = matches[2];
        result = result.split(search).join(replaceWith);
      }
    } else if (p.startsWith('join')) {
      const matches = p.match(/join\('(.*?)'\)/);
      const separator = matches ? matches[1] : ' | ';
      if (Array.isArray(val)) result = val.join(separator);
    }
  }
  return result;
}

/**
 * Funzione Universale applicata ad ogni stream processato dal backend
 */
app.use((req, res, next) => {
  res.applyUniversalFormatter = function(streams, config, addonName = "Foxmatter") {
    if (!streams || !Array.isArray(streams)) return streams;
    if (!config?.namingTemplate && !config?.descriptionTemplate) return streams;

    return streams.map(stream => {
      // Costruisci un contesto dati unificato compatibile con le convenzioni dei formatter estesi
      const ctx = {
        'addon.name': addonName,
        'service.shortName': stream.name?.match(/\[(.*?)\]/) ? stream.name.match(/\[(.*?)\]/)[1] : 'RD',
        'stream.library': false,
        'stream.type': stream.url?.startsWith('http') ? 'http' : 'Debrid',
        'service.cached': true,
        'stream.resolution': stream.title?.match(/2160p|4k/i) ? '2160p' : stream.title?.match(/1080p/i) ? '1080p' : '720p',
        'stream.title': stream.title?.split('\n')[0]?.replace(/^[🎬🔹📢\s]+/, '') || 'Featured Stream',
        'stream.size': 0,
        'stream.filename': stream.title || '',
        'stream.quality': stream.title?.match(/remux/i) ? 'Remux' : stream.title?.match(/bluray/i) ? 'BluRay' : 'WEB-DL',
        'stream.encode': stream.title?.match(/HEVC|x265/i) ? 'HEVC' : 'AVC',
        'stream.visualTags': [],
        'stream.audioTags': [],
        'stream.audioChannels': [],
        'stream.languages': ['it'],
        'stream.languageEmojis': ['🇮🇹']
      };

      const newName = config.namingTemplate 
        ? parseCustomTemplate(config.namingTemplate, ctx) 
        : stream.name;

      const newTitle = config.descriptionTemplate 
        ? parseCustomTemplate(config.descriptionTemplate, ctx) + `\n${stream.title}`
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