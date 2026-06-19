'use strict';

/**
 * Template Engine for AIOStreams-compatible formatter syntax.
 * Supports:
 * - {path.to.value}
 * - chained modifiers with ::
 * - conditional modifiers like ::exists["A"||"B"] and ::>5["A"||"B"]
 * - logical chaining with ::or::, ::and::, ::xor::
 */

function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    const result = evaluateExpression(expression.trim(), ctx);
    return result === undefined || result === null ? '' : String(result);
  });
}

function evaluateExpression(expr, ctx) {
  if (expr.includes('::or::') || expr.includes('::and::') || expr.includes('::xor::')) {
    return evaluateLogical(expr, ctx);
  }

  const parts = expr.split('::');
  const path = parts[0].trim();
  let val = getValue(ctx, path);

  if (parts.length === 1) return val;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();

    const conditional = evaluateConditionalModifier(part, val, ctx);
    if (conditional.handled) return conditional.value;

    val = applyModifier(part, val);
  }

  return val;
}

function evaluateConditionalModifier(part, val, ctx) {
  const match = part.match(/^(exists|~|>=|<=|>|<|=)\s*(?:([^[]*))?\s*\["(.*?)"(?:\s*\|\|\s*"(.*?)")?\]$/);
  if (!match) return { handled: false };

  const type = match[1];
  const condVal = (match[2] || '').trim();
  const trueVal = match[3] || '';
  const falseVal = match[4] || '';
  const met = matchesCondition(type, val, condVal);
  const chosen = met ? trueVal : falseVal;

  if (!chosen) return { handled: true, value: '' };
  return { handled: true, value: chosen.includes('{') ? parseTemplate(chosen, ctx) : chosen };
}

function matchesCondition(type, val, condVal) {
  const strVal = Array.isArray(val) ? val.join(' ') : String(val ?? '');
  const numVal = parseFloat(val);

  switch (type) {
    case 'exists':
      return val !== undefined && val !== null && val !== '' && val !== false && !(Array.isArray(val) && val.length === 0);
    case '~':
      return strVal.toLowerCase().includes(condVal.toLowerCase());
    case '>':
      return !Number.isNaN(numVal) && numVal > parseFloat(condVal);
    case '<':
      return !Number.isNaN(numVal) && numVal < parseFloat(condVal);
    case '>=':
      return !Number.isNaN(numVal) && numVal >= parseFloat(condVal);
    case '<=':
      return !Number.isNaN(numVal) && numVal <= parseFloat(condVal);
    case '=':
      return strVal === condVal;
    default:
      return false;
  }
}

function evaluateLogical(expr, ctx) {
  if (expr.includes('::or::')) {
    const parts = expr.split('::or::');
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (isTruthy(res)) return res;
    }
    return '';
  }

  if (expr.includes('::and::')) {
    const parts = expr.split('::and::');
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (!isTruthy(res)) return '';
    }
    return evaluateExpression(parts[parts.length - 1].trim(), ctx);
  }

  if (expr.includes('::xor::')) {
    const parts = expr.split('::xor::');
    let count = 0;
    let lastTruthy = '';
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (isTruthy(res)) {
        count++;
        lastTruthy = res;
      }
    }
    return count % 2 === 1 ? lastTruthy : '';
  }

  return '';
}

function isTruthy(value) {
  return value !== '' && value !== null && value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0);
}

function applyModifier(part, val) {
  const base = Array.isArray(val) ? [...val] : val;

  if (part === 'upper' || part === 'title') return String(val ?? '').toUpperCase();
  if (part === 'lower') return String(val ?? '').toLowerCase();
  if (part === 'smallcaps') return toSmallCaps(String(val ?? ''));
  if (part === 'string') return Array.isArray(val) ? val.map(String).join(',') : String(val ?? '');
  if (part === 'length') return Array.isArray(val) ? val.length : String(val ?? '').length;
  if (part === 'reverse') return Array.isArray(val) ? [...val].reverse() : String(val ?? '').split('').reverse().join('');
  if (part === 'sort') return Array.isArray(val) ? [...val].sort() : String(val ?? '').split('').sort().join('');
  if (part === 'rsort') return Array.isArray(val) ? [...val].sort().reverse() : String(val ?? '').split('').sort().reverse().join('');
  if (part === 'lsort') return Array.isArray(val) ? [...val].sort((a, b) => String(a).localeCompare(String(b))) : String(val ?? '');
  if (part === 'first') return Array.isArray(val) ? (val[0] ?? '') : String(val ?? '')[0] ?? '';
  if (part === 'last') return Array.isArray(val) ? (val[val.length - 1] ?? '') : String(val ?? '').slice(-1);
  if (part === 'random') return Array.isArray(val) && val.length ? val[Math.floor(Math.random() * val.length)] : val;
  if (part === 'bytes' || part === 'bytes10') return formatBytes(val, 10, false);
  if (part === 'sbytes' || part === 'sbytes10') return formatBytes(val, 10, true);
  if (part === 'bytes2') return formatBytes(val, 2, false);
  if (part === 'sbytes2') return formatBytes(val, 2, true);
  if (part === 'rbytes' || part === 'rbytes10') return formatBytes(val, 10, false, true);
  if (part === 'rbytes2') return formatBytes(val, 2, false, true);
  if (part === 'bitrate') return formatBitrate(val, false);
  if (part === 'rbitrate') return formatBitrate(val, true);
  if (part === 'sbitrate') return formatBitrate(val, false, true);
  if (part === 'time') return formatTime(val);
  if (part === 'hex') return Number.parseInt(val, 10).toString(16);
  if (part === 'octal') return Number.parseInt(val, 10).toString(8);
  if (part === 'binary') return Number.parseInt(val, 10).toString(2);
  if (part.startsWith('truncate(')) {
    const m = part.match(/truncate\((\d+)\)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const s = String(val ?? '');
      return s.length > n ? `${s.slice(0, n)}…` : s;
    }
  }
  if (part.startsWith('replace(')) {
    const m = part.match(/replace\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
    if (m) return String(val ?? '').split(m[1]).join(m[2]);
  }
  if (part.startsWith('join(')) {
    const m = part.match(/join\(['"](.*?)['"]\)/);
    if (m && Array.isArray(val)) return val.join(m[1]);
    if (Array.isArray(val)) return val.join(' ');
  }
  if (part.startsWith('slice(')) {
    const m = part.match(/slice\((\-?\d+)(?:,\s*(\-?\d+))?\)/);
    if (m && Array.isArray(val)) return val.slice(parseInt(m[1], 10), m[2] !== undefined ? parseInt(m[2], 10) : undefined);
  }

  return base;
}

function getValue(ctx, path) {
  if (!ctx || !path) return undefined;
  return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : undefined), ctx);
}

function formatBytes(bytes, base, smart, round = false) {
  if (bytes === null || bytes === undefined || bytes === '' || Number.isNaN(Number(bytes))) return '';
  let b = Number(bytes);
  if (round) b = Math.round(b);
  if (b === 0) return '0 B';
  const units = base === 2
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const step = base === 2 ? 1024 : 1000;
  let idx = 0;
  while (b >= step && idx < units.length - 1) {
    b /= step;
    idx++;
  }
  const value = round ? Math.round(b) : (smart ? (b >= 10 ? b.toFixed(0) : b.toFixed(1)) : b.toFixed(1));
  return `${value} ${units[idx]}`;
}

function formatBitrate(value, round = false, smart = false) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '';
  let b = Number(value);
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let idx = 0;
  while (b >= 1000 && idx < units.length - 1) {
    b /= 1000;
    idx++;
  }
  const out = round ? Math.round(b) : (smart ? (b >= 10 ? b.toFixed(0) : b.toFixed(1)) : b.toFixed(1));
  return `${out} ${units[idx]}`;
}

function formatTime(value) {
  const secs = parseInt(value, 10) || 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.length ? parts.join(' ') : '0s';
}

function toSmallCaps(str) {
  const map = {
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
    j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ',
    s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
  };
  return str.toLowerCase().split('').map(ch => map[ch] || ch).join('');
}

function buildStreamContext(stream, addonConfig) {
  return {
    stream: stream || {},
    service: {
      id: stream?.serviceId || '',
      shortName: stream?.serviceShortName || 'RD',
      name: stream?.serviceName || 'Real-Debrid',
      cached: stream?.cached ?? true,
    },
    addon: {
      presetId: addonConfig?.presetId || '',
      name: addonConfig?.name || 'Addon',
      manifestUrl: addonConfig?.transportUrl || '',
    },
    config: {
      addonName: process.env.ADDON_NAME || 'Foxmatter',
    },
    metadata: stream?.metadata || {},
    debug: {
      json: JSON.stringify(stream || {}),
      jsonf: JSON.stringify(stream || {}, null, 2),
    },
    tools: {
      newLine: '\n',
      removeLine: '',
    },
  };
}

module.exports = { parseTemplate, buildStreamContext };
