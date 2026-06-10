// services/formatterEngine.js - Core stream formatting logic
// Inspired by Airstream's approach but more powerful
const { logger } = require('../utils/logger');

/**
 * Main formatter: takes raw streams from upstream addon
 * and applies user-defined formatting rules.
 */
function formatStreams(streams, config, addonId) {
  if (!streams || streams.length === 0) return [];

  const addonConfig = getAddonConfig(config, addonId);
  const globalBadges = config.globalBadges || [];
  const addonBadges = addonConfig?.badges || [];
  
  // Merge global + addon-specific badges (addon badges take priority)
  const allBadges = mergeBadges(globalBadges, addonBadges);

  return streams
    .map(stream => formatSingleStream(stream, addonConfig, allBadges))
    .filter(Boolean); // Remove streams that were filtered out
}

/**
 * Format a single stream object.
 */
function formatSingleStream(stream, addonConfig, badges) {
  try {
    // Extract all parseable fields from the stream
    const parsed = parseStreamFields(stream);
    
    // Apply badges
    const matchedBadges = matchBadges(parsed, badges);
    
    // Build formatted output
    const formatted = { ...stream }; // Start with original stream
    
    // Apply name template
    if (addonConfig?.nameTemplate) {
      formatted.name = applyTemplate(addonConfig.nameTemplate, parsed, matchedBadges);
    } else if (matchedBadges.length > 0) {
      // Default: append badges to existing name
      const badgeString = matchedBadges.map(b => `[${b.label}]`).join(' ');
      formatted.name = `${stream.name || 'Stream'} ${badgeString}`.trim();
    }
    
    // Apply description template
    if (addonConfig?.descriptionTemplate) {
      formatted.description = applyTemplate(
        addonConfig.descriptionTemplate, 
        parsed, 
        matchedBadges
      );
    }
    
    // Apply title template (Stremio shows this as subtitle under name)
    if (addonConfig?.titleTemplate) {
      formatted.title = applyTemplate(addonConfig.titleTemplate, parsed, matchedBadges);
    }
    
    // Inject behaviorHints if configured
    if (addonConfig?.behaviorHints) {
      formatted.behaviorHints = {
        ...(stream.behaviorHints || {}),
        ...addonConfig.behaviorHints,
      };
    }
    
    return formatted;
  } catch (err) {
    logger.warn(`Error formatting stream: ${err.message}`);
    return stream; // Return original on error
  }
}

/**
 * Parse all useful fields from a stream object.
 * This handles the varied formats different addons use.
 */
function parseStreamFields(stream) {
  const raw = stream;
  
  // Combine all text fields for pattern matching
  const allText = [
    stream.name || '',
    stream.title || '',
    stream.description || '',
    stream.url || '',
  ].join(' ').toLowerCase();

  // Parse quality/resolution
  const quality = extractQuality(allText) || extractQuality(stream.name || '');
  
  // Parse file size
  const size = extractSize(allText);
  
  // Parse seeders (common in torrent addons like Torrentio)
  const seeders = extractSeeders(stream);
  
  // Parse audio info
  const audio = extractAudio(allText);
  
  // Parse language
  const language = extractLanguage(allText, stream);
  
  // Parse codec
  const codec = extractCodec(allText);
  
  // Parse source/uploader (Torrentio puts this in name)
  const source = extractSource(stream);
  
  // Parse release group
  const releaseGroup = extractReleaseGroup(allText);

  return {
    // Original fields (always available)
    originalName: stream.name || '',
    originalTitle: stream.title || '',
    originalDescription: stream.description || '',
    
    // Parsed fields
    quality: quality || 'Unknown',
    size: size || '',
    seeders: seeders !== null ? String(seeders) : '',
    audio: audio || '',
    language: language || '',
    codec: codec || '',
    source: source || '',
    releaseGroup: releaseGroup || '',
    
    // Derived
    isHDR: /hdr10\+?|hdr|dolby\s*vision|dv/i.test(allText),
    isDV: /dolby\s*vision|dv\b/i.test(allText),
    is4K: /4k|2160p|uhd/i.test(allText),
    isRemux: /remux/i.test(allText),
    isBluray: /bluray|blu-ray|bdremux/i.test(allText),
    isWebDL: /webdl|web-dl|web\.dl/i.test(allText),
    isCAM: /\bcam\b|camrip|hdcam/i.test(allText),
    
    // Raw stream for custom access
    _raw: raw,
  };
}

/**
 * Match badges against parsed stream fields.
 * Returns matched badges sorted by priority.
 */
function matchBadges(parsed, badges) {
  if (!badges || badges.length === 0) return [];
  
  const allText = [
    parsed.originalName,
    parsed.originalTitle,
    parsed.originalDescription,
  ].join(' ');

  return badges
    .filter(badge => {
      if (!badge.pattern) return false;
      try {
        const regex = new RegExp(badge.pattern, 'i');
        return regex.test(allText);
      } catch {
        // Invalid regex - do string match instead
        return allText.toLowerCase().includes(badge.pattern.toLowerCase());
      }
    })
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

/**
 * Apply a template string, replacing {variable} placeholders.
 *
 * Available variables:
 * {original_name}, {original_title}, {original_description}
 * {quality}, {size}, {seeders}, {audio}, {language}, {codec}
 * {source}, {release_group}
 * {badges} - all matched badges as "[4K] [REMUX]"
 * {badge:LABEL} - specific badge presence as "4K" or ""
 */
function applyTemplate(template, parsed, matchedBadges) {
  if (!template) return '';
  
  const badgeString = matchedBadges.map(b => `[${b.label}]`).join(' ');
  const badgeLabels = new Set(matchedBadges.map(b => b.label.toUpperCase()));
  
  let result = template;
  
  // Simple variable substitutions
  const vars = {
    original_name: parsed.originalName,
    original_title: parsed.originalTitle,
    original_description: parsed.originalDescription,
    quality: parsed.quality,
    size: parsed.size,
    seeders: parsed.seeders,
    audio: parsed.audio,
    language: parsed.language,
    codec: parsed.codec,
    source: parsed.source,
    release_group: parsed.releaseGroup,
    badges: badgeString,
  };
  
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value || '');
  }
  
  // Conditional badge: {badge:4K} → "4K" if matched, "" if not
  result = result.replace(/\{badge:([^}]+)\}/g, (_, label) => {
    return badgeLabels.has(label.toUpperCase()) ? label : '';
  });
  
  // Conditional blocks: {if:seeders}🌱 {seeders}{/if}
  result = result.replace(/\{if:(\w+)\}(.*?)\{\/if\}/gs, (_, varName, content) => {
    const val = vars[varName] || parsed[varName];
    return val ? content : '';
  });
  
  // Clean up empty separators (e.g., "Title |  | Size" → "Title | Size")
  result = result
    .replace(/\|\s*\|/g, '|')
    .replace(/•\s*•/g, '•')
    .replace(/\s{2,}/g, ' ')
    .trim();
  
  // Remove trailing/leading separators
  result = result.replace(/^[\s|•-]+|[\s|•-]+$/g, '').trim();
  
  return result;
}

// ─── Field extractors ──────────────────────────────────────────────────────

function extractQuality(text) {
  const patterns = [
    { regex: /2160p|4k\s*uhd|uhd\s*4k/i, label: '4K' },
    { regex: /1080p/i, label: '1080p' },
    { regex: /720p/i, label: '720p' },
    { regex: /480p/i, label: '480p' },
    { regex: /360p/i, label: '360p' },
  ];
  
  for (const { regex, label } of patterns) {
    if (regex.test(text)) return label;
  }
  return null;
}

function extractSize(text) {
  // Matches: "1.2 GB", "850 MB", "2.3GB"
  const match = text.match(/(\d+\.?\d*)\s*(gb|mb|tb)/i);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    return `${num} ${unit}`;
  }
  return null;
}

function extractSeeders(stream) {
  // Torrentio puts seeder count in behaviorHints or title
  if (stream.behaviorHints?.seeders !== undefined) {
    return stream.behaviorHints.seeders;
  }
  
  const text = [stream.name, stream.title, stream.description].join(' ');
  const match = text.match(/👤\s*(\d+)|(\d+)\s*seeds?|seeders?[:\s]+(\d+)/i);
  if (match) {
    return parseInt(match[1] || match[2] || match[3]);
  }
  
  return null;
}

function extractAudio(text) {
  const patterns = [
    { regex: /dolby\s*atmos|atmos/i, label: 'Atmos' },
    { regex: /dts[\s-]?hd\s*ma|dts-hd/i, label: 'DTS-HD MA' },
    { regex: /dts[\s-]?x/i, label: 'DTS:X' },
    { regex: /dts/i, label: 'DTS' },
    { regex: /dolby\s*digital\s*plus|dd\+|ddp|eac3/i, label: 'DD+' },
    { regex: /dolby\s*digital|dd5\.1|ac3/i, label: 'DD' },
    { regex: /truehd/i, label: 'TrueHD' },
    { regex: /aac/i, label: 'AAC' },
  ];
  
  for (const { regex, label } of patterns) {
    if (regex.test(text)) return label;
  }
  return null;
}

function extractLanguage(text, stream) {
  if (stream.behaviorHints?.language) return stream.behaviorHints.language;
  
  // Flag emojis or language codes
  const flagMatch = text.match(/🇮🇹|🇺🇸|🇬🇧|🇩🇪|🇫🇷|🇪🇸|🇧🇷|🇯🇵/);
  const flagMap = { '🇮🇹': 'IT', '🇺🇸': 'EN', '🇬🇧': 'EN', '🇩🇪': 'DE', 
                   '🇫🇷': 'FR', '🇪🇸': 'ES', '🇧🇷': 'PT', '🇯🇵': 'JA' };
  if (flagMatch) return flagMap[flagMatch[0]] || '';
  
  const langMatch = text.match(/\[?(ita|eng|ger|fra|spa|por|jpn)\]?/i);
  if (langMatch) return langMatch[1].toUpperCase();
  
  return null;
}

function extractCodec(text) {
  const patterns = [
    { regex: /av1/i, label: 'AV1' },
    { regex: /hevc|x265|h\.?265/i, label: 'HEVC' },
    { regex: /avc|x264|h\.?264/i, label: 'H.264' },
    { regex: /xvid|divx/i, label: 'XviD' },
  ];
  
  for (const { regex, label } of patterns) {
    if (regex.test(text)) return label;
  }
  return null;
}

function extractSource(stream) {
  // Torrentio: name usually starts with "Source\n..."
  if (stream.name?.includes('\n')) {
    return stream.name.split('\n')[0].trim();
  }
  
  const text = stream.name || '';
  const match = text.match(/^([A-Za-z0-9_\-. +]+?)(?:\s+\[|\s+\(|\n|$)/);
  return match ? match[1].trim() : null;
}

function extractReleaseGroup(text) {
  const match = text.match(/-([A-Z][A-Z0-9]{2,})\s*(?:\[|\(|$)/);
  return match ? match[1] : null;
}

// ─── Config helpers ────────────────────────────────────────────────────────

function getAddonConfig(config, addonId) {
  if (!config?.addonConfigs) return null;
  
  return config.addonConfigs.find(c => 
    c.addonId === addonId || addonId?.includes(c.addonId)
  ) || null;
}

function mergeBadges(globalBadges, localBadges) {
  const merged = [...globalBadges];
  
  for (const local of localBadges) {
    const existingIdx = merged.findIndex(g => 
      g.label.toLowerCase() === local.label.toLowerCase()
    );
    
    if (existingIdx >= 0) {
      // Local overrides global
      merged[existingIdx] = local;
    } else {
      merged.push(local);
    }
  }
  
  return merged.sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

module.exports = {
  formatStreams,
  formatSingleStream,
  parseStreamFields,
  matchBadges,
  applyTemplate,
};