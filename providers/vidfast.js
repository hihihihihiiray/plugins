// VidFast Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[VidFast] Initializing VidFast scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const VIDFAST_BASE = 'https://vidfast.pro';
const ENCRYPT_API = 'https://enc-dec.app/api/enc-vidfast';
const DECRYPT_API = 'https://enc-dec.app/api/dec-vidfast';

// Server filtering (uncomment one option or leave all commented to allow all)
// Option 1: Filter by server names
// const ALLOWED_SERVERS = ['vEdge', 'vRapid'];

// Option 2: Filter by description (e.g., only original audio)
const FILTER_DESCRIPTION = 'Original audio';

// Option 3: Exclude specific servers
// const BLOCKED_SERVERS = ['vSlow', 'vBad'];

// Parse HLS master playlist to extract quality variants
async function parseM3U8Playlist(playlistUrl) {
    console.log(`[VidFast] Fetching m3u8 playlist: ${playlistUrl.substring(0, 80)}...`);
    
    try {
        const response = await fetch(playlistUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://vidfast.pro/'
            }
        });
        
        if (!response.ok) {
            console.log(`[VidFast] Playlist fetch failed: HTTP ${response.status}`);
            return null;
        }
        
        const playlistText = await response.text();
        console.log(`[VidFast] Playlist text length: ${playlistText.length}`);
        console.log(`[VidFast] Playlist first 300 chars: ${playlistText.substring(0, 300)}`);
        
        // Check if it's a master playlist (contains #EXT-X-STREAM-INF)
        const isMasterPlaylist = playlistText.includes('#EXT-X-STREAM-INF');
        console.log(`[VidFast] Is master playlist: ${isMasterPlaylist}`);
        
        if (!isMasterPlaylist) {
            console.log('[VidFast] Not a master playlist, skipping variant extraction');
            return null; // Not a master playlist, it's a single quality stream
        }
        
        const variants = [];
        const lines = playlistText.split('\n');
        console.log(`[VidFast] Parsing ${lines.length} lines...`);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                // Extract resolution
                const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
                const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
                
                console.log(`[VidFast] Found stream info line: ${line.substring(0, 100)}`);
                if (resolutionMatch) {
                    console.log(`[VidFast] Resolution: ${resolutionMatch[1]}x${resolutionMatch[2]}`);
                }
                
                // Next line should be the URL
                const urlLine = lines[i + 1]?.trim();
                if (!urlLine || urlLine.startsWith('#')) {
                    console.log(`[VidFast] No valid URL line found after stream info`);
                    continue;
                }
                
                console.log(`[VidFast] Variant URL: ${urlLine.substring(0, 80)}...`);
                
                // Build full URL if relative
                let variantUrl = urlLine;
                if (!urlLine.startsWith('http')) {
                    const baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
                    variantUrl = baseUrl + urlLine;
                    console.log(`[VidFast] Built full URL from relative path`);
                }
                
                // Determine quality from resolution
                let quality = 'Unknown';
                if (resolutionMatch) {
                    const height = parseInt(resolutionMatch[2]);
                    if (height >= 2160) quality = '2160p';
                    else if (height >= 1440) quality = '1440p';
                    else if (height >= 1080) quality = '1080p';
                    else if (height >= 720) quality = '720p';
                    else if (height >= 480) quality = '480p';
                    else if (height >= 360) quality = '360p';
                    else quality = `${height}p`;
                }
                
                console.log(`[VidFast] Detected quality: ${quality}`);
                
                variants.push({
                    url: variantUrl,
                    quality: quality,
                    bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0
                });
            }
        }
        
        console.log(`[VidFast] Extracted ${variants.length} quality variants`);
        if (variants.length > 0) {
            console.log(`[VidFast] Qualities found: ${variants.map(v => v.quality).join(', ')}`);
        }
        
        return variants.length > 0 ? variants : null;
    } catch (error) {
        console.log(`[VidFast] Playlist parsing error: ${error.message}`);
        return null;
    }
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    
    return fetch(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const isTv = mediaType === 'tv';
        return {
            title: isTv ? data.name : data.title,
            year: (isTv ? data.first_air_date : data.release_date)?.substring(0, 4) || '',
            mediaType: isTv ? 'tv' : 'movie'
        };
    });
}

// Main scraping function
async function scrapeVidFast(tmdbId, mediaInfo, seasonNum, episodeNum) {
    try {
        // Build page URL
        const pageUrl = mediaInfo.mediaType === 'tv'
            ? `${VIDFAST_BASE}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `${VIDFAST_BASE}/movie/${tmdbId}`;

        // Headers
        const headers = {
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Origin': 'https://vidfast.pro',
            'Referer': pageUrl,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
            'X-Requested-With': 'XMLHttpRequest'
        };

        // Step 1: Fetch page
        const pageResponse = await fetch(pageUrl, { headers });
        
        if (!pageResponse.ok) {
            console.log(`[VidFast] Page fetch failed: HTTP ${pageResponse.status}`);
            return [];
        }
        
        const pageText = await pageResponse.text();

        // Step 2: Extract encrypted data
        let rawData = null;
        
        // Look for __NEXT_DATA__ script tag
        const nextDataMatch = pageText.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        if (nextDataMatch) {
            try {
                const jsonData = JSON.parse(nextDataMatch[1]);
                const propsStr = JSON.stringify(jsonData);
                const dataMatch = propsStr.match(/"en":"([^"]+)"/);
                if (dataMatch) rawData = dataMatch[1];
            } catch (e) {
                // Continue to fallback patterns
            }
        }
        
        // Fallback patterns
        if (!rawData) {
            const patterns = [
                /"en":"([^"]+)"/,
                /'en':'([^']+)'/,
                /\\"en\\":\\"([^"]+)\\"/,
                /data\s*=\s*"([^"]+)"/
            ];
            
            for (const pattern of patterns) {
                const match = pageText.match(pattern);
                if (match) {
                    rawData = match[1];
                    break;
                }
            }
        }

        if (!rawData) {
            console.log('[VidFast] Could not extract data from page');
            return [];
        }

        // Step 3: Get servers and stream URLs
        const apiUrl = `${ENCRYPT_API}?text=${encodeURIComponent(rawData)}&version=1`;
        const apiResponse = await fetch(apiUrl);
        
        if (!apiResponse.ok) {
            console.log('[VidFast] enc-vidfast API failed');
            return [];
        }
        
        const apiData = await apiResponse.json();

        if (apiData.status !== 200 || !apiData.result) {
            console.log('[VidFast] enc-vidfast API returned error');
            return [];
        }

        const apiServers = apiData.result.servers;
        const streamBase = apiData.result.stream;
        const token = apiData.result.token;

        // Update headers with token if provided
        if (token) {
            headers['X-CSRF-Token'] = token;
        }

        // Step 4: Fetch and decrypt servers list
        const serversResponse = await fetch(apiServers, { 
            method: 'POST',
            headers 
        });
        const serversEncrypted = await serversResponse.text();
        
        const decryptResponse = await fetch(DECRYPT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: serversEncrypted, version: '1' })
        });
        const decryptData = await decryptResponse.json();
        let serverList = decryptData.result;

        if (!serverList || !Array.isArray(serverList) || serverList.length === 0) {
            console.log('[VidFast] No servers available');
            return [];
        }

        // Apply server filtering
        if (typeof ALLOWED_SERVERS !== 'undefined') {
            serverList = serverList.filter(s => ALLOWED_SERVERS.includes(s.name));
            console.log(`[VidFast] Filtered to allowed servers: ${serverList.length} remaining`);
        }
        
        if (typeof FILTER_DESCRIPTION !== 'undefined') {
            serverList = serverList.filter(s => 
                s.description && s.description.includes(FILTER_DESCRIPTION)
            );
            console.log(`[VidFast] Filtered by description "${FILTER_DESCRIPTION}": ${serverList.length} remaining`);
        }
        
        if (typeof BLOCKED_SERVERS !== 'undefined') {
            serverList = serverList.filter(s => !BLOCKED_SERVERS.includes(s.name));
            console.log(`[VidFast] Blocked servers removed: ${serverList.length} remaining`);
        }

        if (serverList.length === 0) {
            console.log('[VidFast] No servers after filtering');
            return [];
        }

        console.log(`[VidFast] Found ${serverList.length} server(s)`);

        // Step 5: Fetch and decrypt streams from each server
        const rawStreams = [];

        for (let i = 0; i < serverList.length; i++) {
            const serverObj = serverList[i];
            const server = serverObj.data;
            const serverName = serverObj.name || `Server ${i + 1}`;
            const apiStream = `${streamBase}/${server}`;

            try {
                const streamResponse = await fetch(apiStream, { 
                    method: 'POST',
                    headers 
                });

                if (!streamResponse.ok) {
                    continue;
                }

                const streamEncrypted = await streamResponse.text();
                
                const streamDecryptResponse = await fetch(DECRYPT_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: streamEncrypted, version: '1' })
                });
                const streamDecryptData = await streamDecryptResponse.json();
                const data = streamDecryptData.result;

                if (!data.url) {
                    continue;
                }

                // Determine quality from response data
                let quality = 'Unknown';
                
                if (data.quality) {
                    quality = data.quality;
                    if (/2160|4k/i.test(quality)) quality = '2160p';
                    else if (/1440/i.test(quality)) quality = '1440p';
                    else if (/1080/i.test(quality)) quality = '1080p';
                    else if (/720/i.test(quality)) quality = '720p';
                    else if (/480/i.test(quality)) quality = '480p';
                    else if (/360/i.test(quality)) quality = '360p';
                    else if (/auto|adaptive/i.test(quality)) quality = 'Adaptive';
                } else if (data.label) {
                    quality = data.label;
                    if (/2160|4k/i.test(quality)) quality = '2160p';
                    else if (/1440/i.test(quality)) quality = '1440p';
                    else if (/1080/i.test(quality)) quality = '1080p';
                    else if (/720/i.test(quality)) quality = '720p';
                    else if (/480/i.test(quality)) quality = '480p';
                    else if (/360/i.test(quality)) quality = '360p';
                    else if (/auto|adaptive/i.test(quality)) quality = 'Adaptive';
                } else if (data.url.includes('.m3u8')) {
                    quality = 'Adaptive';
                } else {
                    const qualityMatch = data.url.match(/(\d{3,4})[pP]/);
                    if (qualityMatch) quality = `${qualityMatch[1]}p`;
                }

                rawStreams.push({
                    serverName: serverName,
                    url: data.url,
                    quality: quality,
                    isM3U8: data.url.includes('.m3u8')
                });
            } catch (error) {
                continue;
            }
        }

        // Step 6: Parse m3u8 playlists in parallel
        const m3u8Count = rawStreams.filter(s => s.isM3U8).length;
        console.log(`[VidFast] Found ${rawStreams.length} raw streams (${m3u8Count} are m3u8)`);
        
        const parsePromises = rawStreams.map(async function(stream) {
            if (!stream.isM3U8) {
                return [stream]; // Return as single-item array for consistency
            }
            
            console.log(`[VidFast] Parsing m3u8 for ${stream.serverName}...`);
            const variants = await parseM3U8Playlist(stream.url);
            
            if (variants && variants.length > 0) {
                console.log(`[VidFast] ${stream.serverName}: Extracted ${variants.length} quality variants`);
                return variants.map(v => ({
                    serverName: stream.serverName,
                    url: v.url,
                    quality: v.quality,
                    isM3U8: false
                }));
            }
            
            console.log(`[VidFast] ${stream.serverName}: No variants found, using original stream`);
            return [stream]; // Fallback to original
        });

        const parsedStreamArrays = await Promise.all(parsePromises);
        const allParsedStreams = parsedStreamArrays.flat();
        
        console.log(`[VidFast] After parsing: ${allParsedStreams.length} total streams`);

        // Step 7: Build final stream objects
        const streams = allParsedStreams.map(function(stream) {
            return {
                name: `VidFast ${stream.serverName} - ${stream.quality}`,
                title: `${mediaInfo.title} (${mediaInfo.year})`,
                url: stream.url,
                quality: stream.quality,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://vidfast.pro/'
                },
                provider: 'vidfast'
            };
        });

        // Deduplicate by URL
        const uniqueStreams = [];
        const seenUrls = new Set();

        streams.forEach(function(stream) {
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
    } catch (error) {
        console.error(`[VidFast] Error: ${error.message}`);
        return [];
    }
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
