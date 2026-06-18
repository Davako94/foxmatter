'use strict';

/**
 * Risolve un template AIOStreams-compatibile
 */
function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';
  
  // Risolve le espressioni tra graffe { ... }
  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    return evaluateExpression(expression.trim(), ctx) ?? '';
  });
}

function evaluateExpression(expr, ctx) {
  // Gestione prioritaria degli OR
  if (expr.includes('::or::')) {
    const parts = expr.split('::or::');
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (res !== '' && res !== null && res !== undefined) return res;
    }
    return '';
  }

  const parts = expr.split('::');
  let val = getPath(ctx, parts[0].trim());

  // Elaborazione pipeline (::)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();

    // 1. Condizionali
    // Formato: operatore["valore_vero"||"valore_falso"]
    // Formato alternativo: operatore["valore"]
    const condMatch = part.match(/^(exists|~|>|<|=|>=|<=)(?:(.*?))?\["(.*?)(?:"\s*\|\|\s*"(.*?)")?\]$/);
    if (condMatch) {
      const type = condMatch[1];
      const condVal = condMatch[2] || '';
      const trueVal = condMatch[3];
      const falseVal = condMatch[4] || '';
      
      let met = false;
      const strVal = String(val ?? '');
      const numVal = parseFloat(val);
      
      switch(type) {
        case 'exists':
          met = (val !== undefined && val !== null && val !== '');
          break;
        case '~':
          met = strVal.toLowerCase().includes(condVal.toLowerCase());
          break;
        case '>':
          met = !isNaN(numVal) && numVal > parseFloat(condVal);
          break;
        case '<':
          met = !isNaN(numVal) && numVal < parseFloat(condVal);
          break;
        case '>=':
          met = !isNaN(numVal) && numVal >= parseFloat(condVal);
          break;
        case '<=':
          met = !isNaN(numVal) && numVal <= parseFloat(condVal);
          break;
        case '=':
          met = strVal === condVal;
          break;
      }
      
      return met ? trueVal : falseVal;
    }

    // 2. Trasformazioni
    if (part === 'bytes') {
      const b = parseFloat(val);
      if (isNaN(b) || b === 0) {
        val = '';
      } else if (b >= 1e9) {
        val = (b/1e9).toFixed(1) + ' GB';
      } else if (b >= 1e6) {
        val = Math.round(b/1e6) + ' MB';
      } else {
        val = Math.round(b/1e3) + ' KB';
      }
    } else if (part === 'join') {
      if (Array.isArray(val)) {
        val = val.join(' ');
      } else if (typeof val === 'string') {
        // Se è una stringa, non fare nulla
        val = val;
      }
    } else if (part.startsWith('join(')) {
      const m = part.match(/join\(['"](.*?)['"]\)/);
      if (m && Array.isArray(val)) {
        val = val.join(m[1]);
      }
    } else if (part.startsWith('replace(')) {
      const m = part.match(/replace\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
      if (m) {
        val = strVal.split(m[1]).join(m[2]);
      }
    }
  }

  return val ?? '';
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function buildStreamContext(stream, addonConfig) {
  return {
    stream: stream,
    service: { name: stream.serviceName || stream.name },
    addon: { name: addonConfig?.name || addonConfig?.slug }
  };
}

module.exports = { parseTemplate, buildStreamContext };
