'use strict';

/**
 * formatterEngine.js
 * Arricchisce lo stream con dati strutturati per il templateEngine.
 */

function formatStreams(streams, config, addonId) {
    if (!Array.isArray(streams)) return [];
    
    return streams.map(stream => {
        const s = { ...stream };
        const title = s.title || s.name || '';
        
        // Estrazione qualità e risoluzione
        const qualityMatch = title.match(/4K|2160p|1080p|720p|480p/i);
        s.quality = qualityMatch ? qualityMatch[0] : null;
        s.resolution = s.quality;
        
        // Estrazione dimensione in bytes
        const sizeMatch = title.match(/([\d.]+)\s*(GB|MB)/i);
        if (sizeMatch) {
            s.size = Math.round(parseFloat(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === 'GB' ? 1e9 : 1e6));
        } else {
            s.size = 0;
        }

        // Estrazione linguaggi e audio
        s.languages = extractLanguages(title);
        s.languageEmojis = s.languages.map(l => l === 'ITA' ? '🇮🇹' : '🇬🇧');
        s.audio = extractAudio(title);
        s.audioChannels = s.audio; 
        s.visualTags = extractVisualTags(title);

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

function extractVisualTags(title) {
    const tags = [];
    if (/hdr/i.test(title)) tags.push('HDR');
    if (/dv|dolby vision/i.test(title)) tags.push('DV');
    return tags;
}

module.exports = { formatStreams };
