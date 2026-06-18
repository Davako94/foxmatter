'use strict';

/**
 * formatterEngine.js
 * Arricchisce lo stream con dati strutturati per il templateEngine.
 * Supporta tutte le proprietà richieste da AIOStreams
 */

function formatStreams(streams, config, addonId) {
    if (!Array.isArray(streams)) return [];
    
    return streams.map(stream => {
        const s = { ...stream };
        const title = s.title || s.name || '';
        
        // Estrazione anno
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        s.year = yearMatch ? parseInt(yearMatch[0]) : null;
        
        // Estrazione stagione e episodio
        const seasonMatch = title.match(/S(\d{1,2})/i);
        const episodeMatch = title.match(/E(\d{1,2})/i);
        s.season = seasonMatch ? parseInt(seasonMatch[1]) : -1;
        s.episode = episodeMatch ? parseInt(episodeMatch[1]) : -1;
        
        // Estrazione qualità e risoluzione
        const qualityMatch = title.match(/4K|2160p|1080p|1440p|720p|480p/i);
        s.quality = qualityMatch ? qualityMatch[0] : null;
        s.resolution = s.quality;
        
        // Estrazione encoding
        const encodeMatch = title.match(/(x265|HEVC|H265|x264|AV1)/i);
        s.encode = encodeMatch ? encodeMatch[0].toUpperCase() : null;
        
        // Estrazione dimensione in bytes
        const sizeMatch = title.match(/([\d.]+)\s*(GB|MB|KB)/i);
        if (sizeMatch) {
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            s.size = Math.round(size * (unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3));
        } else {
            s.size = 0;
        }

        // Estrazione linguaggi e audio
        s.languages = extractLanguages(title);
        s.languageEmojis = s.languages.map(l => l === 'ITA' ? '🇮🇹' : '🇬🇧');
        s.audio = extractAudio(title);
        s.audioChannels = s.audio;
        s.audioTags = extractAudioTags(title);
        s.visualTags = extractVisualTags(title);
        
        // Estrazione metadata per regexMatched
        s.regexMatched = extractRegexMatched(title);

        return s;
    });
}

function extractLanguages(title) {
    const langs = [];
    if (/ita|italian/i.test(title)) langs.push('ITA');
    if (/eng|english/i.test(title)) langs.push('ENG');
    if (/multi|multilang/i.test(title)) {
        if (!langs.includes('ITA')) langs.push('ITA');
        if (!langs.includes('ENG')) langs.push('ENG');
    }
    return langs;
}

function extractAudio(title) {
    if (/atmos/i.test(title)) return 'Atmos';
    if (/dolby.*atmos/i.test(title)) return 'Atmos';
    if (/dts/i.test(title)) return 'DTS';
    if (/5\.1/i.test(title)) return '5.1';
    if (/7\.1/i.test(title)) return '7.1';
    return 'Stereo';
}

function extractAudioTags(title) {
    const tags = [];
    if (/dts/i.test(title)) tags.push('DTS');
    if (/atmos/i.test(title)) tags.push('Atmos');
    if (/5\.1/i.test(title)) tags.push('5.1');
    if (/7\.1/i.test(title)) tags.push('7.1');
    if (/truehd/i.test(title)) tags.push('TrueHD');
    return tags;
}

function extractVisualTags(title) {
    const tags = [];
    if (/hdr10/i.test(title)) tags.push('HDR10');
    if (/hdr/i.test(title) && !tags.includes('HDR10')) tags.push('HDR');
    if (/dv|dolby vision/i.test(title)) tags.push('DV');
    if (/hlg/i.test(title)) tags.push('HLG');
    return tags;
}

function extractRegexMatched(title) {
    // Cerca pattern comuni per source e quality
    const patterns = {
        'Remux T1': /remux.*tier1|remux.*t1/i,
        'Remux T2': /remux.*tier2|remux.*t2/i,
        'Remux T3': /remux.*tier3|remux.*t3/i,
        'Bluray T1': /bluray.*tier1|bluray.*t1|bdremux/i,
        'Bluray T2': /bluray.*tier2|bluray.*t2/i,
        'Bluray T3': /bluray.*tier3|bluray.*t3/i,
        'Web T1': /web.*tier1|web.*t1|webdl.*tier1/i,
        'Web T2': /web.*tier2|web.*t2/i,
        'Web T3': /web.*tier3|web.*t3/i,
        'Web Scene': /web.*scene|scene.*web/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
        if (pattern.test(title)) return key;
    }
    return null;
}

module.exports = { formatStreams };
