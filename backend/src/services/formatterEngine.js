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
        
        // Estrai anno
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        s.year = yearMatch ? parseInt(yearMatch[0]) : null;
        
        // Estrai stagione e episodio (default -1 per condizioni >0)
        const seasonMatch = title.match(/S(\d{1,2})/i);
        const episodeMatch = title.match(/E(\d{1,2})/i);
        s.season = seasonMatch ? parseInt(seasonMatch[1]) : -1;
        s.episode = episodeMatch ? parseInt(episodeMatch[1]) : -1;
        
        // Estrai qualità
        const qualityMatch = title.match(/4K|2160p|1080p|1440p|720p|480p/i);
        s.quality = qualityMatch ? qualityMatch[0] : null;
        s.resolution = s.quality;
        
        // Estrai encode
        const encodeMatch = title.match(/(x265|HEVC|H265|x264|AV1)/i);
        s.encode = encodeMatch ? encodeMatch[0].toUpperCase() : null;
        
        // Estrai dimensione
        const sizeMatch = title.match(/([\d.]+)\s*(GB|MB|KB)/i);
        if (sizeMatch) {
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            s.size = Math.round(size * (unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3));
        } else {
            s.size = 0;
        }

        // Estrai linguaggi
        s.languages = extractLanguages(title);
        s.languageEmojis = s.languages.map(l => {
            if (l === 'ITA') return '🇮🇹';
            if (l === 'ENG') return '🇬🇧';
            return l;
        });
        
        // Estrai audio
        s.audio = extractAudio(title);
        s.audioChannels = s.audio;
        s.audioTags = extractAudioTags(title);
        s.visualTags = extractVisualTags(title);
        
        // Servizio
        s.serviceName = stream.serviceName || stream.service || 'Real-Debrid';
        
        // regexMatched
        s.regexMatched = extractRegexMatched(title);

        return s;
    });
}

function extractLanguages(title) {
    const langs = [];
    const hasITA = /ita|italian/i.test(title);
    const hasENG = /eng|english/i.test(title);
    const hasMULTI = /multi|multilang/i.test(title);
    
    if (hasITA || hasMULTI) langs.push('ITA');
    if (hasENG || hasMULTI) langs.push('ENG');
    
    // Se non trova nulla, prova con codice paese
    if (!langs.length) {
        if (/\[ita\]/i.test(title)) langs.push('ITA');
        if (/\[eng\]/i.test(title)) langs.push('ENG');
    }
    
    return langs;
}

function extractAudio(title) {
    if (/atmos/i.test(title)) return 'Atmos';
    if (/dolby.*atmos/i.test(title)) return 'Atmos';
    if (/dtshd|dts-hd/i.test(title)) return 'DTS-HD';
    if (/dts/i.test(title)) return 'DTS';
    if (/7\.1/i.test(title)) return '7.1';
    if (/5\.1/i.test(title)) return '5.1';
    if (/truehd/i.test(title)) return 'TrueHD';
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
    if (/hdr10\+|hdr10plus/i.test(title)) tags.push('HDR10+');
    if (/hdr10/i.test(title)) tags.push('HDR10');
    if (/hdr/i.test(title) && !tags.length) tags.push('HDR');
    if (/dv|dolby vision/i.test(title)) tags.push('DV');
    if (/hlg/i.test(title)) tags.push('HLG');
    return tags;
}

function extractRegexMatched(title) {
    const patterns = {
        'Remux T1': /remux.*t1|remux.*tier1|remux.*tier\s*1/i,
        'Remux T2': /remux.*t2|remux.*tier2|remux.*tier\s*2/i,
        'Remux T3': /remux.*t3|remux.*tier3|remux.*tier\s*3/i,
        'Bluray T1': /bluray.*t1|bluray.*tier1|bdremux|bluray\s*t1/i,
        'Bluray T2': /bluray.*t2|bluray.*tier2|bluray\s*t2/i,
        'Bluray T3': /bluray.*t3|bluray.*tier3|bluray\s*t3/i,
        'Web T1': /web.*t1|web.*tier1|webdl.*t1|web\s*t1/i,
        'Web T2': /web.*t2|web.*tier2|webdl.*t2|web\s*t2/i,
        'Web T3': /web.*t3|web.*tier3|webdl.*t3|web\s*t3/i,
        'Web Scene': /web.*scene|scene.*web|webscene/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
        if (pattern.test(title)) return key;
    }
    return null;
}

module.exports = { formatStreams };
