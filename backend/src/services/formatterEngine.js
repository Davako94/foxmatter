'use strict';

function parseTemplate(template, ctx) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
    // Gestione OR chain
    if (expression.includes('::or::')) {
      const orParts = expression.split('::or::');
      for (const part of orParts) {
        const result = evaluateExpression(part.trim(), ctx);
        if (result !== '' && result !== null && result !== undefined) return result;
      }
      return '';
    }
    return evaluateExpression(expression.trim(), ctx) ?? '';
  });
}

function evaluateExpression(expr, ctx) {
  const parts = expr.split('::');
  const propPath = parts[0].trim();
  const rawValue = getPath(ctx, propPath);

  // Se non ci sono modificatori, restituisci il valore
  if (parts.length === 1) return rawValue ?? '';

  // Estrattore condizione/output: supporta [T||F], ["T"||"F"], ['T'||'F']
  const lastPart = parts[parts.length - 1];
  const outputMatch = lastPart.match(/^(.*?)\[(?:"|')?(.*?)(?:"|')?\s*\|\|\s*(?:"|')?(.*?)(?:"|')?\]$/s);

  let trueVal = String(rawValue ?? '');
  let falseVal = '';
  let condParts = parts.slice(1);

  if (outputMatch) {
    trueVal = outputMatch[2];
    falseVal = outputMatch[3];
    condParts = [...parts.slice(1, -1), outputMatch[1].trim()].filter(Boolean);
  }

  // Esecuzione trasformazioni (non condizionali)
  let currentVal = rawValue;
  for (const cond of condParts) {
    if (cond.startsWith('replace')) {
      const m = cond.match(/replace\('(.*?)','(.*?)'\)/);
      if (m) currentVal = String(currentVal ?? '').split(m[1]).join(m[2]);
    } else if (cond.startsWith('join')) {
      const m = cond.match(/join\('(.*?)'\)/);
      if (Array.isArray(currentVal)) currentVal = currentVal.join(m ? m[1] : ' | ');
    } else if (cond === 'title') {
      currentVal = String(currentVal ?? '').toUpperCase();
    } else if (cond === 'bytes') {
      const b = parseFloat(currentVal);
      currentVal = (isNaN(b) || b === 0) ? '' : (b >= 1e9 ? (b/1e9).toFixed(1) + ' GB' : Math.round(b/1e6) + ' MB');
    }
  }

  // Esecuzione valutazioni condizionali
  let conditionMet = false;
  for (const cond of condParts) {
    if (cond === 'exists') {
      conditionMet = (rawValue !== undefined && rawValue !== null && rawValue !== '' && (!Array.isArray(rawValue) || rawValue.length > 0));
    } else if (cond.startsWith('=')) {
      conditionMet = String(rawValue ?? '').toLowerCase() === cond.slice(1).toLowerCase();
    } else if (cond.startsWith('~')) {
      conditionMet = String(rawValue ?? '').toLowerCase().includes(cond.slice(1).toLowerCase());
    } else if (cond.startsWith('>=')) {
      conditionMet = parseFloat(rawValue || 0) >= parseFloat(cond.slice(2));
    } else if (cond.startsWith('<=')) {
      conditionMet = parseFloat(rawValue || 0) <= parseFloat(cond.slice(2));
    } else if (cond.startsWith('>')) {
      conditionMet = parseFloat(rawValue || 0) > parseFloat(cond.slice(1));
    } else if (cond.startsWith('<')) {
      conditionMet = parseFloat(rawValue || 0) < parseFloat(cond.slice(1));
    }
  }

  return (outputMatch ? (conditionMet ? trueVal : falseVal) : (currentVal ?? ''));
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o != null && o[k] !== undefined ? o[k] : undefined), obj);
}

module.exports = { parseTemplate, buildStreamContext };
