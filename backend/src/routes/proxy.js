const express = require('express');
const router  = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { getUserConfig } = require('../services/configService');
const { fetchUpstreamStreams, fetchAddonManifest } = require('../services/stremioService');
const { formatStreams } = require('../services/formatterEngine');
const { parseTemplate, buildStreamContext } = require('../services/templateEngine');

// Helper per applicare i template in sicurezza
function applyTemplates(streams, addonConfig) {
  const { titleTemplate, descriptionTemplate } = addonConfig;
  if (!titleTemplate && !descriptionTemplate) return streams;

  return streams.map(stream => {
    const ctx = buildStreamContext(stream, addonConfig);
    
    // Funzione per parsare evitando che rimangano segnaposto non risolti
    const safeParse = (tmpl) => {
        if (!tmpl) return null;
        const res = parseTemplate(tmpl, ctx);
        // Se il risultato contiene ancora parentesi graffe, il template è malformato o mancano dati
        return (res && !res.includes('{')) ? res : null;
    };

    return {
      ...stream,
      name:  safeParse(titleTemplate) || stream.name,
      title: safeParse(descriptionTemplate) || stream.title
    };
  });
}

// ── Rotte Proxy ──────────────────────────────────────────────────────────

router.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', 'application/json');
  next();
});

router.get('/:userId/:addonSlug/stream/:type/:id.json', asyncHandler(async (req, res) => {
  const { userId, addonSlug, type, id } = req.params;
  const config = await getUserConfig(userId);
  if (!config) return res.json({ streams: [] });

  const addonConfig = config.addonConfigs?.find(a => a.slug === addonSlug);
  if (!addonConfig?.transportUrl || addonConfig.enabled === false) return res.json({ streams: [] });

  const upstream = await fetchUpstreamStreams(addonConfig.transportUrl, type, id);
  if (!upstream.success || !upstream.streams.length) return res.json({ streams: [] });

  let formatted = formatStreams(upstream.streams, config, addonConfig.id);
  formatted = applyTemplates(formatted, addonConfig);

  res.json({ streams: formatted });
}));

module.exports = router;
