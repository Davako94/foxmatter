'use strict';

function parseTemplate(template, ctx) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([^{}]+)\}/g, (match, expression) => {
        return evaluateExpression(expression.trim(), ctx) ?? '';
    });
}

function evaluateExpression(expr, ctx) {
    const parts = expr.split('::');
    const propPath = parts[0].trim();
    let val = getPath(ctx, propPath);

    // Gestione OR chain
    if (parts.includes('or')) {
        const orParts = expr.split('::or::');
        for (const p of orParts) {
            const res = evaluateExpression(p.trim(), ctx);
            if (res !== '' && res !== null && res !== undefined) return res;
        }
        return '';
    }

    // Processamento modificatori (::modifier)
    for (let i = 1; i < parts.length; i++) {
        const cond = parts[i].trim();
        
        // 1. Modificatori di valore
        if (cond.startsWith('replace')) {
            const m = cond.match(/replace\('(.*?)','(.*?)'\)/);
            if (m) val = String(val ?? '').split(m[1]).join(m[2]);
        } else if (cond.startsWith('join')) {
            const m = cond.match(/join\('(.*?)'\)/);
            if (Array.isArray(val)) val = val.join(m ? m[1] : ' | ');
        } else if (cond === 'bytes') {
            const b = parseFloat(val);
            val = (isNaN(b) || b === 0) ? '' : (b >= 1e9 ? (b/1e9).toFixed(1) + ' GB' : Math.round(b/1e6) + ' MB');
        }
        
        // 2. Condizionali [True || False]
        const outputMatch = cond.match(/\["(.*?)"\s*\|\|\s*"(.*?)"\]/);
        if (outputMatch) {
            const condType = parts[i-1]; // La condizione è prima della parentesi
            let met = false;
            if (condType === 'exists') met = (val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0));
            else if (condType.startsWith('~')) met = String(val ?? '').toLowerCase().includes(condType.slice(1).toLowerCase());
            else if (condType.startsWith('>')) met = parseFloat(val || 0) > parseFloat(condType.slice(1));
            
            return met ? outputMatch[1] : outputMatch[2];
        }
    }
    return val ?? '';
}

function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function buildStreamContext(stream, addonConfig) {
    return {
        stream: { ...stream, addonName: addonConfig?.name },
        service: { name: stream.name },
        addon: { name: addonConfig?.name }
    };
}

module.exports = { parseTemplate, buildStreamContext };
