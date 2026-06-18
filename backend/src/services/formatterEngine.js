'use strict';

/**
 * formatterEngine.js
 * Si occupa di trasformare i dati grezzi dell'addon 
 * in oggetti strutturati per il templateEngine.
 */

function formatStreams(streams, config, addonId) {
    if (!Array.isArray(streams)) return [];
    
    return streams.map(stream => {
        // 1. Cloniamo lo stream per non sporcare l'originale
        const s = { ...stream };
        
        // 2. Estrazione dati comuni (Quality, Resolution, Size)
        const title = s.title || s.name || '';
        
        // Estrazione qualità/risoluzione
        const qualityMatch = title.match(/4K|2160p|1080p|720p|480p/i);
        s.quality = qualityMatch ? qualityMatch[0] : null;
        
        // Estrazione dimensione file
        const sizeMatch = title.match(/([\d.]+)\s*(GB|MB)/i);
        if (sizeMatch) {
            s.size = Math.round(parseFloat(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === 'GB' ? 1e9 : 1e6));
        } else {
            s.size = 0;
        }

        // 3. Logica personalizzata (es. tag audio/lingue)
        s.languages = extractLanguages(title);
        s.audio = extractAudio(title);
        
        // 4. Manteniamo la compatibilità con il parser
        return s;
    });
}

function extractLanguages(title) {
    const langs = [];
    if (/ita|italiano/i.test(title)) langs.push('ITA');
    if (/eng|english/i.test(title)) langs.push('ENG');
    return langs;
}

function extractAudio(title) {
    if (/atmos/i.test(title)) return 'Atmos';
    if (/5\.1/i.test(title)) return '5.1';
    return 'Stereo';
}

// IMPORTANTE: Esporta SOLO le funzioni di formattazione.
// NON esportare buildStreamContext qui.
module.exports = { formatStreams };
