// VidFast Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[VidFast] Initializing VidFast scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const VIDFAST_BASE = 'https://vidfast.pro';
const ENCRYPT_API = 'https://enc-dec.app/api/enc-vidfast';
const VERSION = "1";

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Referer': 'https://vidfast.pro/',
    'X-Requested-With': 'XMLHttpRequest'
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    return fetch(url, {
        headers: { ...HEADERS, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return makeRequest(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const isTv = mediaType === 'tv';
        return {
            title: isTv ? data.name : data.title,
            year: (isTv ? data.first_air_date : data.release_date)?.substring(0, 4) || '',
            mediaType: isTv ? 'tv' : 'movie'
        };
    }).catch(function(error) {
        console.log(`[VidFast] TMDB lookup failed: ${error.message}`);
        return null;
    });
}

// Extract encrypted text from page HTML
function extractEncryptedText(html) {
    // Pattern: \\"en\\":\\"(.*?)\\"
    const match = html.match(/\\"en\\":\\"([^"\\]+)\\"/);
    if (!match) {
        throw new Error('Could not extract encrypted text from page');
    }
    return match[1];
}

// Get server and stream URLs + token from encrypted text
function getVidFastUrls(extractedText) {
    const url = `${ENCRYPT_API}?text=${encodeURIComponent(extractedText)}&version=${VERSION}`;
    
    return makeRequest(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        return data.result;
    });
}

// Extract quality from stream data
function extractQuality(data) {
    // VidFast streams come in different formats - check for quality indicators
    const url = data.url || '';
    
    // Check URL for quality
    if (/2160|4k/i.test(url)) return '4K';
    if (/1440/i.test(url)) return '1440p';
    if (/1080/i.test(url)) return '1080p';
    if (/720/i.test(url)) return '720p';
    if (/480/i.test(url)) return '480p';
    if (/360/i.test(url)) return '360p';
    
    // Check for HLS/adaptive
    if (url.includes('.m3u8')) return 'Adaptive';
    
    return 'Unknown';
}

// Fetch stream from a single server
function fetchServerStream(serverData, streamBaseUrl, token, mediaInfo) {
    const streamUrl = `${streamBaseUrl}/${serverData.data}`;
    
    return fetch(streamUrl, {
        method: 'POST',
        headers: {
            ...HEADERS,
            'X-CSRF-Token': token
        }
    }).then(function(response) {
        return response.json();
    }).then(function(data) {
        // Stream response is plain JSON (NOT encrypted)
        if (!data || !data.url) {
            return null;
        }

        const quality = extractQuality(data);
        const serverName = serverData.name || 'Server';
        const streamName = `VidFast ${serverName} - ${quality}`;

        return {
            name: streamName,
            title: `${mediaInfo.title} (${mediaInfo.year})`,
            url: data.url,
            quality: quality,
            headers: {
                'User-Agent': HEADERS['User-Agent'],
                'Referer': 'https://vidfast.pro/'
            },
            provider: 'vidfast'
        };
    }).catch(function(error) {
        console.log(`[VidFast] Server ${serverData.name || 'unknown'} failed: ${error.message}`);
        return null;
    });
}

// Main scraping function
async function scrapeVidFast(tmdbId, mediaInfo, seasonNum, episodeNum) {
    // Build page URL
    const pageUrl = mediaInfo.mediaType === 'tv'
        ? `${VIDFAST_BASE}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
        : `${VIDFAST_BASE}/movie/${tmdbId}`;

    console.log(`[VidFast] Fetching: ${pageUrl}`);

    // Step 1: Fetch page HTML
    const html = await makeRequest(pageUrl).then(r => r.text());

    // Step 2: Extract encrypted text from HTML
    const extractedText = extractEncryptedText(html);

    // Step 3: Decrypt to get server/stream URLs and token
    const vidFastData = await getVidFastUrls(extractedText);
    const { servers: serversUrl, stream: streamUrl, token } = vidFastData;

    // Step 4: Fetch servers list (plain JSON response)
    const serverList = await fetch(serversUrl, {
        method: 'POST',
        headers: {
            ...HEADERS,
            'X-CSRF-Token': token
        }
    }).then(r => r.json());

    if (!serverList || !Array.isArray(serverList) || serverList.length === 0) {
        console.log('[VidFast] No servers found');
        return [];
    }

    console.log(`[VidFast] Found ${serverList.length} server(s)`);

    // Step 5: Fetch streams from all servers in parallel
    const streamPromises = serverList.map(function(server) {
        return fetchServerStream(server, streamUrl, token, mediaInfo);
    });

    const results = await Promise.all(streamPromises);
    const validStreams = results.filter(s => s !== null);

    // Deduplicate by URL
    const uniqueStreams = [];
    const seenUrls = new Set();

    validStreams.forEach(function(stream) {
        if (!seenUrls.has(stream.url)) {
            seenUrls.add(stream.url);
            uniqueStreams.push(stream);
        }
    });

    // Sort by quality
    uniqueStreams.sort(function(a, b) {
        const qualityOrder = {
            'Adaptive': 4000,
            '2160p': 2160,
            '1440p': 1440,
            '1080p': 1080,
            '720p': 720,
            '480p': 480,
            '360p': 360,
            'Unknown': 0
        };
        return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
    });

    console.log(`[VidFast] Returning ${uniqueStreams.length} stream(s)`);
    return uniqueStreams;
}

// Main function
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VidFast] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    return getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
        if (!mediaInfo) {
            console.log('[VidFast] Failed to get TMDB details');
            return [];
        }

        console.log(`[VidFast] Title: "${mediaInfo.title}" (${mediaInfo.year})`);

        return scrapeVidFast(tmdbId, mediaInfo, seasonNum, episodeNum);
    }).catch(function(error) {
        console.error(`[VidFast] Error: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
