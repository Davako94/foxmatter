'use strict';

/**
 * Template Engine COMPLETO per AIOStreams
 * Supporta TUTTE le variabili e TUTTI i modificatori
 */

function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';
  
  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    const result = evaluateExpression(expression.trim(), ctx);
    return result !== undefined && result !== null ? String(result) : '';
  });
}

function evaluateExpression(expr, ctx) {
  // Gestione OR/AND/XOR
  if (expr.includes('::or::') || expr.includes('::and::') || expr.includes('::xor::')) {
    return evaluateLogical(expr, ctx);
  }

  const parts = expr.split('::');
  const path = parts[0].trim();
  let val = getValue(ctx, path);

  if (parts.length === 1) {
    return val !== undefined && val !== null && val !== '' ? String(val) : '';
  }

  // Pipeline di modificatori
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();

    // CONDIZIONALI: exists, ~, >, <, >=, <=, =
    const condMatch = part.match(/^(exists|~|>|<|=|>=|<=)(?:([^[]*))?\["(.*?)"(?:\s*\|\|\s*"(.*?)")?\]$/);
    if (condMatch) {
      const type = condMatch[1];
      const condVal = (condMatch[2] || '').trim();
      const trueVal = condMatch[3] || '';
      const falseVal = condMatch[4] || '';
      
      let met = false;
      const strVal = String(val ?? '');
      const numVal = parseFloat(val);
      
      switch(type) {
        case 'exists':
          met = (val !== undefined && val !== null && val !== '' && val !== false);
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
      
      if (met) {
        return trueVal.includes('{') ? parseTemplate(trueVal, ctx) : trueVal;
      }
      return falseVal.includes('{') ? parseTemplate(falseVal, ctx) : falseVal;
    }

    // MODIFICATORI: replace, join, bytes
    if (part === 'bytes') {
      val = formatBytes(val);
    } else if (part === 'join') {
      val = Array.isArray(val) ? val.join(' ') : val;
    } else if (part.startsWith('join(')) {
      const m = part.match(/join\(['"](.*?)['"]\)/);
      if (m && Array.isArray(val)) {
        val = val.join(m[1]);
      }
    } else if (part.startsWith('replace(')) {
      const m = part.match(/replace\(['"](.*?)['"],\s*['"](.*?)['"]\)/);
      if (m) {
        val = String(val ?? '').split(m[1]).join(m[2]);
      }
    }
  }

  return val !== undefined && val !== null ? String(val) : '';
}

function evaluateLogical(expr, ctx) {
  // OR
  if (expr.includes('::or::')) {
    const parts = expr.split('::or::');
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (res !== '' && res !== null && res !== undefined && res !== false) {
        return res;
      }
    }
    return '';
  }
  
  // AND
  if (expr.includes('::and::')) {
    const parts = expr.split('::and::');
    for (const p of parts) {
      const res = evaluateExpression(p.trim(), ctx);
      if (res === '' || res === null || res === undefined || res === false) {
        return '';
      }
    }
    return evaluateExpression(parts[0].trim(), ctx);
  }
  
  return '';
}

function getValue(ctx, path) {
  if (!ctx) return undefined;
  return path.split('.').reduce((o, k) => {
    if (o && o[k] !== undefined && o[k] !== null) {
      return o[k];
    }
    return undefined;
  }, ctx);
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '';
  const b = parseFloat(bytes);
  if (b >= 1e9) return (b/1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b/1e6) + ' MB';
  if (b >= 1e3) return Math.round(b/1e3) + ' KB';
  return b + ' B';
}

function buildStreamContext(stream, addonConfig) {
  return {
    stream: stream || {},
    service: { 
      name: stream?.serviceName || 'Real-Debrid' 
    },
    addon: { 
      name: addonConfig?.name || 'Addon' 
    }
  };
}

module.exports = { parseTemplate, buildStreamContext };
