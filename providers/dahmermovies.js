// Dahmer Movies Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[DahmerMovies] Initializing Dahmer Movies scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 22000; // 22 seconds

const BATCH_SIZE = 3;          // links resolved in parallel per batch
const BATCH_GAP_MS = 1500;      // gap between batches (only paid when a 429 occurred)
const RETRY_MS = 8000;    // wait on 429 before retrying a single link

// Quality mapping
const Qualities = {
    Unknown: 0,
    P144: 144,
    P240: 240,
    P360: 360,
    P480: 480,
    P720: 720,
    P1080: 1080,
    P1440: 1440,
    P2160: 2160
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    const requestOptions = {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            ...options.headers
        },
        ...options
    };

    return fetch(url, requestOptions).then(function (response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Utility functions
function getEpisodeSlug(season = null, episode = null) {
    if (season === null && episode === null) {
        return ['', ''];
    }
    const seasonSlug = season < 10 ? `0${season}` : `${season}`;
    const episodeSlug = episode < 10 ? `0${episode}` : `${episode}`;
    return [seasonSlug, episodeSlug];
}

function getIndexQuality(str) {
    if (!str) return Qualities.Unknown;
    const match = str.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : Qualities.Unknown;
}

function getQualityWithCodecs(str) {
    if (!str) return 'Unknown';

    const qualityMatch = str.match(/(\d{3,4})[pP]/);
    const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';

    const codecs = [];
    const lowerStr = str.toLowerCase();

    if (lowerStr.includes('dv') || lowerStr.includes('dolby vision')) codecs.push('DV');
    if (lowerStr.includes('hdr10+')) codecs.push('HDR10+');
    else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) codecs.push('HDR');

    if (lowerStr.includes('remux')) codecs.push('REMUX');
    if (lowerStr.includes('imax')) codecs.push('IMAX');

    if (codecs.length > 0) {
        return `${baseQuality} | ${codecs.join(' | ')}`;
    }

    return baseQuality;
}

function getIndexQualityTags(str, fullTag = false) {
    if (!str) return '';

    if (fullTag) {
        const match = str.match(/(.*)\.(?:mkv|mp4|avi)/i);
        return match ? match[1].trim() : str;
    } else {
        const match = str.match(/\d{3,4}[pP]\.?(.*?)\.(mkv|mp4|avi)/i);
        return match ? match[1].replace(/\./g, ' ').trim() : str;
    }
}

function encodeUrl(url) {
    try {
        return encodeURI(url);
    } catch (e) {
        return url;
    }
}

function decode(input) {
    try {
        return decodeURIComponent(input);
    } catch (e) {
        return input;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolve redirects to get the final direct URL
// Returns { url, hit429 } so callers know whether to back off
function resolveFinalUrl(startUrl) {
    const maxRedirects = 5;
    const referer = 'https://a.111477.xyz/';
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

    function attemptResolve(url, count, retryCount = 0) {
        if (count >= maxRedirects) {
            return Promise.resolve({ url: url.includes('111477.xyz') ? null : url, hit429: false });
        }

        return fetch(url, {
            method: 'HEAD',
            redirect: 'manual',
            headers: { 'User-Agent': userAgent, 'Referer': referer }
        }).then(function (response) {
            if (response.status === 429) {
                if (retryCount < 3) {
                    const waitTime = RETRY_MS
                    console.log(`[DahmerMovies] 429 received, retrying in ${waitTime}ms (attempt ${retryCount + 1})`);
                    return sleep(waitTime).then(() => attemptResolve(url, count, retryCount + 1));
                }
                return { url: null, hit429: true };
            }

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    const nextUrl = location.startsWith('http')
                        ? location
                        : new URL(location, url).href;
                    return attemptResolve(nextUrl, count + 1);
                }
            }

            if (url.includes('111477.xyz')) {
                return { url: null, hit429: false };
            }

            return { url, hit429: false };
        }).catch(function () {
            return { url: null, hit429: false };
        });
    }

    return attemptResolve(startUrl, 0);
}

// Format file size from bytes to human readable format
function formatFileSize(sizeText) {
    if (!sizeText) return null;

    if (/\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeText)) {
        return sizeText;
    }

    const bytes = parseInt(sizeText);
    if (isNaN(bytes)) return sizeText;

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);

    return `${size} ${sizes[i]}`;
}

function parseLinks(html) {
    const links = [];

    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowContent = rowMatch[1];

        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        if (!linkMatch) continue;

        const href = linkMatch[1];
        const text = linkMatch[2].trim();

        if (!text || href === '../' || text === '../') continue;

        let size = null;

        const sizeMatch1 = rowContent.match(/<td[^>]*data-sort=["']?(\d+)["']?[^>]*>/i);
        if (sizeMatch1) size = sizeMatch1[1];

        if (!size) {
            const sizeMatch2 = rowContent.match(/<td[^>]*class=["']filesize["'][^>]*[^>]*>([^<]+)<\/td>/i);
            if (sizeMatch2) size = sizeMatch2[1].trim();
        }

        if (!size) {
            const sizeMatch3 = rowContent.match(/<\/a><\/td>\s*<td[^>]*>([^<]+(?:GB|MB|KB|B|\d+\s*(?:GB|MB|KB|B)))<\/td>/i);
            if (sizeMatch3) size = sizeMatch3[1].trim();
        }

        if (!size) {
            const sizeMatch4 = rowContent.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|B|bytes?))/i);
            if (sizeMatch4) size = sizeMatch4[1].trim();
        }

        links.push({ text, href, size });
    }

    if (links.length === 0) {
        const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const text = match[2].trim();
            if (text && href && href !== '../' && text !== '../') {
                links.push({ text, href, size: null });
            }
        }
    }

    return links;
}

// Resolve a single path entry into a result object (or null on failure)
function resolvePath(path, encodedUrl) {
    const qualityWithCodecs = getQualityWithCodecs(path.text);

    let fullUrl;
    if (path.href.startsWith('http')) {
        // Absolute URL — use as-is, strip query string
        try {
            const url = new URL(path.href);
            fullUrl = `${url.protocol}//${url.host}${url.pathname}`;
        } catch (error) {
            fullUrl = path.href.replace(/ /g, '%20');
        }
    } else if (path.href.startsWith('/')) {
        // Root-relative path e.g. "/movies/file.mkv" — join with domain only
        // to avoid producing /movies/movies/ duplication
        const safeHref = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
        fullUrl = `${new URL(DAHMER_MOVIES_API).origin}${safeHref}`;
    } else {
        // Filename only e.g. "file.mkv" — join with the full folder URL
        const baseUrl = encodedUrl.endsWith('/') ? encodedUrl : encodedUrl + '/';
        const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
        fullUrl = baseUrl + encodedPath;
    }

    // Final cleanup for player — decode then re-encode spaces and brackets
    fullUrl = decodeURIComponent(fullUrl)
        .replace(/ /g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');

    return resolveFinalUrl(fullUrl).then(function ({ url, hit429 }) {
        if (!url) return { result: null, hit429 };
        return {
            result: {
                name: "DahmerMovies",
                title: path.text,
                url,
                quality: qualityWithCodecs,
                size: formatFileSize(path.size),
                type: "direct",
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
                    'Referer': DAHMER_MOVIES_API + '/'
                },
                provider: "dahmermovies",
                filename: path.text
            },
            hit429
        };
    }).catch(function () {
        return { result: null, hit429: false };
    });
}

// Main Dahmer Movies fetcher function
async function invokeDahmerMovies(title, year, season = null, episode = null) {
    console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);

    // Try "Title (Year)" first, fall back to just "Title" if nothing found
    const titleVariations = [
        title.replace(/:/g, '') + ' (' + year + ')',
        title.replace(/:/g, '')
    ];

    let html = null;
    let encodedUrl = null;

    for (const variant of titleVariations) {
        const safeVariant = variant.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
        const tryUrl = season === null
            ? `${DAHMER_MOVIES_API}/movies/${safeVariant}/`
            : `${DAHMER_MOVIES_API}/tvs/${safeVariant}/${season < 10 ? 'Season%200' + season : 'Season%20' + season}/`;

        try {
            const res = await makeRequest(tryUrl);
            const text = await res.text();
            if (text && text.includes('<a')) {
                html = text;
                encodedUrl = tryUrl;
                break;
            }
        } catch (e) { continue; }
    }

    if (!html) {
        console.log('[DahmerMovies] No matching content found for any title variation');
        return [];
    }
    console.log(`[DahmerMovies] Fetching from: ${encodedUrl}`);
    console.log(`[DahmerMovies] Response length: ${html.length}`);

    const paths = parseLinks(html);
    console.log(`[DahmerMovies] Found ${paths.length} total links`);

    let filteredPaths;
    if (season === null) {
        // Try 2160p filtering first
        filteredPaths = paths.filter(path => /2160p/i.test(path.text));
        
        if (filteredPaths.length > 0) {
            console.log(`[DahmerMovies] Found ${filteredPaths.length} 2160p links, prioritizing those`);
        } else {
            // No 2160p found — fall back to 1080p only, take first 5 links
            filteredPaths = paths.filter(path => /1080p/i.test(path.text)).slice(0, 5);
            console.log(`[DahmerMovies] No 2160p found, falling back to first ${filteredPaths.length} 1080p links`);
        }
    } else {
        const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
        
        // Build multiple patterns to match different episode naming formats:
        const patterns = [
            new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i'),           // S01E03
            new RegExp(`${parseInt(season)}x${episodeSlug}`, 'i'),      // 1x03
            new RegExp(`E${episodeSlug}(?!\\d)`, 'i'),                  // E03 (not followed by more digits)
            new RegExp(`Episode[\\s._-]*${episodeSlug}(?!\\d)`, 'i')   // Episode 03, Episode.03, etc.
        ];
        
        filteredPaths = paths.filter(path => 
            patterns.some(pattern => pattern.test(path.text))
        );
        
        console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} TV episode links (S${seasonSlug}E${episodeSlug} or variants)`);
    }

    if (filteredPaths.length === 0) {
        console.log('[DahmerMovies] No matching content found');
        return [];
    }
    // If 2160p found, fetch first 5 links
    const pathsToProcess = filteredPaths.slice(0, 5);
    const results = [];

    try {
        console.log(`[DahmerMovies] Processing all ${pathsToProcess.length} links in parallel`);
        
        // Fire all resolvePath calls in parallel
        const allResults = await Promise.all(
            pathsToProcess.map(path => resolvePath(path, encodedUrl))
        );
        
        // Collect successful results
        allResults.forEach(function ({ result, hit429 }) {
            if (result) results.push(result);
        });

        results.sort((a, b) => getIndexQuality(b.filename) - getIndexQuality(a.filename));
        console.log(`[DahmerMovies] Successfully processed ${results.length} streams`);
        return results;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[DahmerMovies] Request timeout - server took too long to respond');
        } else {
            console.log(`[DahmerMovies] Error: ${error.message}`);
        }
        return [];
    }
}

// Main function to get streams for TMDB content
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[DahmerMovies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(tmdbUrl).then(function (tmdbResponse) {
        return tmdbResponse.json();
    }).then(function (tmdbData) {
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[DahmerMovies] TMDB Info: "${title}" (${year})`);

        return invokeDahmerMovies(
            title,
            year ? parseInt(year) : null,
            seasonNum,
            episodeNum
        );

    }).catch(function (error) {
        console.error(`[DahmerMovies] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
