// 1Movies Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[1Movies] Initializing 1Movies scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const BASE_URL = 'https://1movies.bz';
const AJAX_URL = 'https://1movies.bz/ajax';
const ENC_DEC_API = 'https://enc-dec.app/api';
const TIMEOUT = 20000;

// Quality mapping
const qualityOrder = {
    '2160p': 4,
    '1440p': 3,
    '1080p': 2,
    '720p': 1,
    '480p': 0,
    '360p': -1,
    'Unknown': -2
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    const requestOptions = {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': BASE_URL + '/',
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

// Search for content on 1Movies
function searchContent(title, year, isSeries) {
    const searchUrl = `${BASE_URL}/browser?keyword=${encodeURIComponent(title)}`;
    console.log(`[1Movies] Searching: ${searchUrl}`);

    return makeRequest(searchUrl).then(function (response) {
        return response.text();
    }).then(function (html) {
        // Extract search results
        const posterHrefRegex = /href="([^"]*)" class="poster"/g;
        const titleRegex = /class="title" href="[^"]*">([^<]*)</g;

        const posterMatches = [...html.matchAll(posterHrefRegex)];
        const titleMatches = [...html.matchAll(titleRegex)];

        // Find best match
        for (let i = 0; i < Math.min(posterMatches.length, titleMatches.length); i++) {
            const resultTitle = titleMatches[i][1]
                .replace(/&#039;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .toLowerCase();
            
            const searchTitle = title.toLowerCase();

            // Check if title matches and year is in the URL or title
            if (resultTitle.includes(searchTitle)) {
                const href = posterMatches[i][1];
                const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
                
                // Verify it's the right type (movie vs TV)
                const isSeriesUrl = fullUrl.includes('/tv/');
                if (isSeriesUrl === isSeries) {
                    console.log(`[1Movies] Found match: ${fullUrl}`);
                    return fullUrl;
                }
            }
        }

        throw new Error('Content not found on 1Movies');
    });
}

// Extract content ID from the movie/show page
function getContentId(pageUrl) {
    console.log(`[1Movies] Getting content ID from: ${pageUrl}`);

    return makeRequest(pageUrl).then(function (response) {
        return response.text();
    }).then(function (html) {
        const contentIdMatch = html.match(/<div[^>]*id="movie-rating"[^>]*data-id="([^"]+)"/);
        if (!contentIdMatch) {
            throw new Error('Content ID not found');
        }
        return contentIdMatch[1];
    });
}

// Encrypt text using the enc-movies-flix API
function encryptToken(text) {
    const url = `${ENC_DEC_API}/enc-movies-flix?text=${encodeURIComponent(text)}`;
    return makeRequest(url).then(function (response) {
        return response.json();
    }).then(function (data) {
        return data.result;
    });
}

// Decrypt text using the dec-movies-flix API
function decryptToken(text) {
    const url = `${ENC_DEC_API}/dec-movies-flix`;
    return makeRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        return data.result;
    });
}

// Get episode ID for TV shows
function getEpisodeId(contentId, seasonNum, episodeNum) {
    console.log(`[1Movies] Getting episode ID for S${seasonNum}E${episodeNum}`);

    return encryptToken(contentId).then(function (token) {
        const url = `${AJAX_URL}/episodes/list?id=${contentId}&_=${token}`;
        return makeRequest(url);
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        const cleanedHtml = data.result
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');

        // Parse episodes - looking for specific season/episode
        const episodeRegex = /<a[^>]+eid="([^"]+)"[^>]+num="([^"]+)"[^>]*>/g;
        const episodeMatches = [...cleanedHtml.matchAll(episodeRegex)];

        for (const match of episodeMatches) {
            const eid = match[1];
            const num = parseInt(match[2], 10);
            
            // Episode numbers are sequential, need to figure out which is which
            // For now, assume episodes are listed in order
            if (num === episodeNum) {
                console.log(`[1Movies] Found episode ID: ${eid}`);
                return eid;
            }
        }

        throw new Error(`Episode S${seasonNum}E${episodeNum} not found`);
    });
}

// Get Server 1 link ID
function getServerId(episodeId) {
    console.log(`[1Movies] Getting server ID for episode: ${episodeId}`);

    return encryptToken(episodeId).then(function (token) {
        const url = `${AJAX_URL}/links/list?eid=${episodeId}&_=${token}`;
        return makeRequest(url);
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        const cleanedHtml = data.result
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');

        // Find Server 1
        const server1Regex = /<div class="server wnav-item"[^>]*data-lid="([^"]+)"[^>]*>\s*<span>Server 1<\/span>/;
        const server1Match = server1Regex.exec(cleanedHtml);

        if (!server1Match) {
            throw new Error('Server 1 not found');
        }

        const serverId = server1Match[1];
        console.log(`[1Movies] Found server ID: ${serverId}`);
        return serverId;
    });
}

// Get encrypted stream URL
function getEncryptedStream(serverId) {
    console.log(`[1Movies] Getting encrypted stream for server: ${serverId}`);

    return encryptToken(serverId).then(function (token) {
        const url = `${AJAX_URL}/links/view?id=${serverId}&_=${token}`;
        return makeRequest(url);
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        if (!data.result) {
            throw new Error('Encrypted stream not found');
        }
        return data.result;
    });
}

// Decrypt and extract m3u8 URL
function decryptAndExtractM3U8(encrypted) {
    console.log(`[1Movies] Decrypting stream URL`);

    return decryptToken(encrypted).then(function (decrypted) {
        if (!decrypted || !decrypted.url) {
            throw new Error('Decryption failed');
        }

        // Get media JSON URL by replacing /e/ with /media/
        const mediaUrl = decrypted.url.replace('/e/', '/media/');
        console.log(`[1Movies] Fetching media JSON: ${mediaUrl}`);

        return makeRequest(mediaUrl, {
            headers: {
                'Referer': BASE_URL + '/'
            }
        });
    }).then(function (response) {
        return response.json();
    }).then(function (mediaJson) {
        if (!mediaJson.result) {
            throw new Error('Media result not found');
        }

        // Decrypt the final media result
        const url = `${ENC_DEC_API}/dec-mega`;
        return makeRequest(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                text: mediaJson.result,
                agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
        });
    }).then(function (response) {
        return response.json();
    }).then(function (finalJson) {
        const m3u8Link = finalJson?.result?.sources?.[0]?.file;
        if (!m3u8Link) {
            throw new Error('M3U8 link not found');
        }
        return m3u8Link;
    });
}

// Parse m3u8 playlist and extract quality streams
function parseM3U8(m3u8Url) {
    console.log(`[1Movies] Parsing M3U8: ${m3u8Url}`);

    return makeRequest(m3u8Url).then(function (response) {
        return response.text();
    }).then(function (m3u8Text) {
        const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
        const streams = [];
        const lines = m3u8Text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
                let quality = 'Unknown';

                if (resolutionMatch) {
                    const height = resolutionMatch[2];
                    quality = `${height}p`;
                }

                if (i + 1 < lines.length) {
                    const streamPath = lines[i + 1].trim();
                    const fullUrl = streamPath.startsWith('http') ? streamPath : baseUrl + streamPath;
                    
                    streams.push({
                        name: '1Movies',
                        title: `1Movies Server 1 - ${quality}`,
                        url: fullUrl,
                        quality: quality,
                        type: 'hls',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
                            'Referer': BASE_URL + '/'
                        },
                        provider: '1movies'
                    });
                }
            }
        }

        // Sort by quality (highest first)
        streams.sort((a, b) => {
            const qualityA = qualityOrder[a.quality] || -10;
            const qualityB = qualityOrder[b.quality] || -10;
            return qualityB - qualityA;
        });

        return streams;
    });
}

// Main function to get streams
async function invoke1Movies(title, year, seasonNum = null, episodeNum = null) {
    const isSeries = seasonNum !== null;
    console.log(`[1Movies] ${isSeries ? 'TV Show' : 'Movie'}: ${title} (${year})${isSeries ? ` S${seasonNum}E${episodeNum}` : ''}`);

    try {
        // Step 1: Search for content
        const pageUrl = await searchContent(title, year, isSeries);

        // Step 2: Get content ID
        const contentId = await getContentId(pageUrl);

        // Step 3: For TV shows, get episode ID
        let episodeId;
        if (isSeries) {
            episodeId = await getEpisodeId(contentId, seasonNum, episodeNum);
        } else {
            episodeId = contentId; // For movies, content ID = episode ID
        }

        // Step 4: Get server ID (Server 1)
        const serverId = await getServerId(episodeId);

        // Step 5: Get encrypted stream
        const encrypted = await getEncryptedStream(serverId);

        // Step 6: Decrypt and get m3u8
        const m3u8Url = await decryptAndExtractM3U8(encrypted);

        // Step 7: Parse m3u8 and return streams
        const streams = await parseM3U8(m3u8Url);

        console.log(`[1Movies] Successfully extracted ${streams.length} streams`);
        return streams;

    } catch (error) {
        console.error(`[1Movies] Error: ${error.message}`);
        return [];
    }
}

// Main function to get streams for TMDB content
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[1Movies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(tmdbUrl).then(function (tmdbResponse) {
        return tmdbResponse.json();
    }).then(function (tmdbData) {
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const year = mediaType === 'tv' ? tmdbData.first_air_date?.substring(0, 4) : tmdbData.release_date?.substring(0, 4);

        if (!title) {
            throw new Error('Could not extract title from TMDB response');
        }

        console.log(`[1Movies] TMDB Info: "${title}" (${year})`);

        return invoke1Movies(
            title,
            year ? parseInt(year) : null,
            seasonNum,
            episodeNum
        );

    }).catch(function (error) {
        console.error(`[1Movies] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
