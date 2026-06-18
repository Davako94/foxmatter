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

    // 1. Condizionale [ "Vero" || "Falso" ]
    const condMatch = part.match(/^(exists|~|>|<|=|>=|<=)?(?:(.*?))?\["(.*?)"\s*\|\|\s*"(.*?)"\]$/);
    if (condMatch) {
      const type = condMatch[1] || 'exists';
      const condVal = condMatch[2] || '';
      const trueVal = condMatch[3];
      const falseVal = condMatch[4];
      
      let met = false;
      if (type === 'exists') met = (val !== undefined && val !== null && val !== '');
      else if (type === '~') met = String(val ?? '').toLowerCase().includes(condVal.toLowerCase());
      
      return met ? trueVal : falseVal;
    }

    // 2. Trasformazioni (bytes, replace, join)
    if (part === 'bytes') {
      const b = parseFloat(val);
      val = (isNaN(b) || b === 0) ? '' : (b >= 1e9 ? (b/1e9).toFixed(1) + ' GB' : Math.round(b/1e6) + ' MB');
    } else if (part.startsWith('replace')) {
      const m = part.match(/replace\('(.*?)','(.*?)'\)/);
      if (m) val = String(val ?? '').split(m[1]).join(m[2]);
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
    service: { name: stream.name },
    addon: { name: addonConfig?.name || addonConfig?.slug }
  };
}

module.exports = { parseTemplate, buildStreamContext };
