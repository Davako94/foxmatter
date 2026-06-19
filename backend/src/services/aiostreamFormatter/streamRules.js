'use strict';

function compareByOrder(value, order) {
  const idx = order.indexOf(value);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function sortStreams(streams, sortConfig = {}) {
  const list = Array.isArray(streams) ? [...streams] : [];
  const criteria = Array.isArray(sortConfig.criteria) ? sortConfig.criteria : [];
  if (!criteria.length) return list;

  return list.sort((a, b) => {
    for (const criterion of criteria) {
      const dir = criterion.direction === 'desc' ? -1 : 1;
      const av = extractCriterionValue(a, criterion);
      const bv = extractCriterionValue(b, criterion);
      if (av === bv) continue;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    }
    return 0;
  });
}

function extractCriterionValue(stream, criterion) {
  switch (criterion.field) {
    case 'quality': return compareByOrder(stream.quality, criterion.order || []);
    case 'resolution': return compareByOrder(stream.resolution, criterion.order || []);
    case 'seeders': return Number(stream.seeders || 0);
    case 'audio': return compareByOrder(stream.audio, criterion.order || []);
    case 'audioChannels': return compareByOrder(stream.audioChannels, criterion.order || []);
    case 'languages': return Array.isArray(stream.languages) ? stream.languages.join(',') : String(stream.languages || '');
    case 'service': return stream.serviceName || '';
    case 'addon': return stream.addonName || '';
    case 'size': return Number(stream.size || 0);
    case 'bitrate': return Number(stream.bitrate || 0);
    default: return stream[criterion.field];
  }
}

function limitResults(streams, limits = {}) {
  const max = Number.isFinite(limits.maxResults) ? limits.maxResults : null;
  if (max === null || max < 0) return streams;
  return streams.slice(0, max);
}

module.exports = { sortStreams, limitResults };
