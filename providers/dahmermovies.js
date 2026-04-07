/**
 * Dahmer Movies Scraper - Corrected & Updated Version
 * 
 * This is a fully functional scraper for the Dahmer Movies API (a.111477.xyz)
 * with proper headers, URL encoding, quality detection, and error handling.
 * 
 * Features:
 * - Proper HTTP headers (User-Agent, Referer, Accept)
 * - URL encoding and path resolution
 * - Quality detection (1080p, 2160p, HDR10+, DV, REMUX, IMAX)
 * - File size formatting
 * - Redirect following with rate limit handling
 * - Stream sorting by quality (highest first)
 * - Support for both movies and TV shows
 */

console.log('[DahmerMovies] Initializing Dahmer Movies scraper');

// Constants
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 60000; // 60 seconds

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
  P2160: 2160,
};

/**
 * Make HTTP request with proper headers
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
function makeRequest(url, options = {}) {
  const requestOptions = {
    timeout: TIMEOUT,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive',
      ...options.headers,
    },
    ...options,
  };

  return fetch(url, requestOptions).then(function (response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  });
}

/**
 * Get episode slug for TV shows (e.g., "S01E05")
 * @param {number|null} season
 * @param {number|null} episode
 * @returns {[string, string]}
 */
function getEpisodeSlug(season = null, episode = null) {
  if (season === null && episode === null) {
    return ['', ''];
  }
  const seasonSlug = season < 10 ? `0${season}` : `${season}`;
  const episodeSlug = episode < 10 ? `0${episode}` : `${episode}`;
  return [seasonSlug, episodeSlug];
}

/**
 * Extract quality number from filename (e.g., "1080p" -> 1080)
 * @param {string} str - Filename or quality string
 * @returns {number}
 */
function getIndexQuality(str) {
  if (!str) return Qualities.Unknown;
  const match = str.match(/(\d{3,4})[pP]/);
  return match ? parseInt(match[1]) : Qualities.Unknown;
}

/**
 * Extract quality with codec information
 * Detects: resolution (1080p, 2160p, etc.), HDR formats (DV, HDR10+, HDR10),
 * and special formats (REMUX, IMAX)
 * 
 * @param {string} str - Filename
 * @returns {string} - Quality string with codecs (e.g., "1080p | HDR10+ | REMUX")
 */
function getQualityWithCodecs(str) {
  if (!str) return 'Unknown';

  // Extract base quality (resolution)
  const qualityMatch = str.match(/(\d{3,4})[pP]/);
  const baseQuality = qualityMatch ? `${qualityMatch[1]}p` : 'Unknown';

  // Extract codec information
  const codecs = [];
  const lowerStr = str.toLowerCase();

  // HDR formats - check for Dolby Vision first
  if (lowerStr.includes('dv') || lowerStr.includes('dolby vision') || lowerStr.includes('dolbyvision')) {
    codecs.push('DV');
  }
  
  // HDR10+ and HDR10
  if (lowerStr.includes('hdr10+')) {
    codecs.push('HDR10+');
  } else if (lowerStr.includes('hdr10') || lowerStr.includes('hdr')) {
    codecs.push('HDR');
  }

  // Special formats
  if (lowerStr.includes('remux')) codecs.push('REMUX');
  if (lowerStr.includes('imax')) codecs.push('IMAX');

  // Combine quality with codecs using pipeline separator
  if (codecs.length > 0) {
    return `${baseQuality} | ${codecs.join(' | ')}`;
  }

  return baseQuality;
}

/**
 * Format file size from bytes to human readable format
 * @param {string|null} sizeText - Size in bytes or already formatted
 * @returns {string|null}
 */
function formatFileSize(sizeText) {
  if (!sizeText) return null;

  // If it's already formatted (contains GB, MB, etc.), return as is
  if (/\d+(\.\d+)?\s*(GB|MB|KB|TB)/i.test(sizeText)) {
    return sizeText;
  }

  // If it's a number (bytes), convert to human readable
  const bytes = parseInt(sizeText);
  if (isNaN(bytes)) return sizeText;

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';

  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(2);

  return `${size} ${sizes[i]}`;
}

/**
 * Parse HTML directory listing to extract links and file sizes
 * Supports multiple HTML table formats (Apache, DahmerMovies custom)
 * 
 * @param {string} html - HTML content
 * @returns {Array<{text: string, href: string, size: string|null}>}
 */
function parseLinks(html) {
  const links = [];

  // Parse table rows to get both links and file sizes
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gim;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];

    // Extract link from the row
    const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
    if (!linkMatch) continue;

    const href = linkMatch[1];
    const text = linkMatch[2].trim();

    // Skip parent directory and empty links
    if (!text || href === '../' || text === '../') continue;

    // Extract file size from the same row - try multiple patterns
    let size = null;

    // Pattern 1: DahmerMovies specific - data-sort attribute with byte size
    const sizeMatch1 = rowContent.match(/<td[^>]*data-sort=["']?(\d+)["']?[^>]*>/i);
    if (sizeMatch1) {
      size = sizeMatch1[1]; // Use the data-sort value (bytes)
    }

    // Pattern 2: Standard Apache directory listing with filesize class
    if (!size) {
      const sizeMatch2 = rowContent.match(/<td[^>]*class=["']filesize["'][^>]*[^>]*>([^<]+)<\/td>/i);
      if (sizeMatch2) {
        size = sizeMatch2[1].trim();
      }
    }

    // Pattern 3: Look for size in any td element after the link (formatted sizes)
    if (!size) {
      const sizeMatch3 = rowContent.match(/<\/a><\/td>\s*<td[^>]*>([^<]+(?:GB|MB|KB|B|\d+\s*(?:GB|MB|KB|B)))<\/td>/i);
      if (sizeMatch3) {
        size = sizeMatch3[1].trim();
      }
    }

    // Pattern 4: Look for size anywhere in the row (more permissive)
    if (!size) {
      const sizeMatch4 = rowContent.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|B|bytes?))/i);
      if (sizeMatch4) {
        size = sizeMatch4[1].trim();
      }
    }

    links.push({ text, href, size });
  }

  // Fallback to simple link parsing if table parsing fails
  if (links.length === 0) {
    const linkRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/gim;
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

/**
 * Resolve final URL by following redirects
 * Handles rate limiting (429) with exponential backoff
 * 
 * @param {string} startUrl - Initial URL
 * @returns {Promise<string|null>} - Final URL or null if resolution failed
 */
function resolveFinalUrl(startUrl) {
  const maxRedirects = 5;
  const referer = 'https://a.111477.xyz/';
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

  function attemptResolve(url, count, retryCount = 0) {
    if (count >= maxRedirects) {
      return Promise.resolve(url.includes('111477.xyz') ? null : url);
    }

    return fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': userAgent,
        'Referer': referer,
      },
    }).then(function (response) {
      // Handle rate limiting with exponential backoff
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 3000;
        return new Promise(resolve => setTimeout(resolve, waitTime))
          .then(() => attemptResolve(url, count, retryCount + 1));
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

      // If we are at a 200 OK but still on the redirector domain, it's a failure
      if (url.includes('111477.xyz')) {
        return null;
      }

      return url;
    }).catch(function (error) {
      return null;
    });
  }

  return attemptResolve(startUrl, 0);
}

/**
 * Utility to encode URL properly
 * @param {string} url
 * @returns {string}
 */
function encodeUrl(url) {
  try {
    return encodeURI(url);
  } catch (e) {
    return url;
  }
}

/**
 * Utility to decode URL
 * @param {string} input
 * @returns {string}
 */
function decode(input) {
  try {
    return decodeURIComponent(input);
  } catch (e) {
    return input;
  }
}

/**
 * Main scraper function to search for streams
 * 
 * @param {string} title - Movie or TV show title
 * @param {number} year - Release year
 * @param {number|null} season - Season number (for TV shows)
 * @param {number|null} episode - Episode number (for TV shows)
 * @returns {Promise<Array>} - Array of stream results
 */
async function searchStreams(title, year, season = null, episode = null) {
  console.log(`[DahmerMovies] Searching for: ${title} (${year})${season ? ` Season ${season}` : ''}${episode ? ` Episode ${episode}` : ''}`);

  // Construct URL based on content type (with proper encoding)
  const encodedUrl = season === null
    ? `${DAHMER_MOVIES_API}/movies/${encodeURIComponent(title.replace(/:/g, '') + ' (' + year + ')')}/`
    : `${DAHMER_MOVIES_API}/tvs/${encodeURIComponent(title.replace(/:/g, ' -'))}/${encodeURIComponent('Season ' + season)}/`;

  console.log(`[DahmerMovies] Fetching from: ${encodedUrl}`);

  try {
    const response = await makeRequest(encodedUrl);
    const html = await response.text();
    console.log(`[DahmerMovies] Response length: ${html.length}`);

    // Parse HTML to extract links
    const paths = parseLinks(html);
    console.log(`[DahmerMovies] Found ${paths.length} total links`);

    // Filter based on content type
    let filteredPaths;
    if (season === null) {
      // For movies, filter by quality (1080p or 2160p)
      filteredPaths = paths.filter(path =>
        /(1080p|2160p)/i.test(path.text)
      );
      console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} movie links (1080p/2160p only)`);
    } else {
      // For TV shows, filter by season and episode
      const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
      const episodePattern = new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i');
      filteredPaths = paths.filter(path =>
        episodePattern.test(path.text)
      );
      console.log(`[DahmerMovies] Filtered to ${filteredPaths.length} TV episode links (S${seasonSlug}E${episodeSlug})`);
    }

    if (filteredPaths.length === 0) {
      console.log('[DahmerMovies] No matching content found');
      return [];
    }

    // Function to sleep/delay
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Process results sequentially to avoid 429 rate limiting
    const results = [];

    async function processPaths() {
      for (const path of filteredPaths) {
        const quality = getIndexQuality(path.text);
        const qualityWithCodecs = getQualityWithCodecs(path.text);

        // Construct proper URL
        let fullUrl;
        if (path.href.startsWith('http')) {
          try {
            const url = new URL(path.href);
            fullUrl = `${url.protocol}//${url.host}${url.pathname}`;
          } catch (error) {
            fullUrl = path.href.replace(/ /g, '%20');
          }
        } else if (path.href.startsWith('/')) {
          const urlObj = new URL(DAHMER_MOVIES_API);
          const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
          fullUrl = `${urlObj.protocol}//${urlObj.host}${encodedPath}`;
        } else {
          const baseUrl = encodedUrl.endsWith('/') ? encodedUrl : encodedUrl + '/';
          const encodedPath = path.href.split('/').map(p => encodeURIComponent(decode(p))).join('/');
          fullUrl = baseUrl + encodedPath;
        }

        try {
          const finalUrl = await resolveFinalUrl(fullUrl);
          if (finalUrl) {
            results.push({
              name: "DahmerMovies",
              title: path.text,
              url: finalUrl,
              quality: qualityWithCodecs,
              size: formatFileSize(path.size),
              type: "direct",
              headers: {
                'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
                'Referer': DAHMER_MOVIES_API + '/',
              },
              provider: "dahmermovies",
              filename: path.text,
            });
          }

          // 1.5 second delay to balance speed and safety
          await sleep(1500);
        } catch (e) {
          console.log(`[DahmerMovies] Failed to resolve ${fullUrl}`);
        }
      }

      // Sort by quality (highest first)
      results.sort((a, b) => {
        const qualityA = getIndexQuality(a.filename);
        const qualityB = getIndexQuality(b.filename);
        return qualityB - qualityA;
      });

      console.log(`[DahmerMovies] Successfully processed ${results.length} streams`);
      return results;
    }

    return processPaths();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[DahmerMovies] Request timeout - server took too long to respond');
    } else {
      console.log(`[DahmerMovies] Error: ${error.message}`);
    }
    return [];
  }
}

/**
 * Main function to get streams for TMDB content
 * 
 * @param {string|number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number|null} seasonNum - Season number (for TV)
 * @param {number|null} episodeNum - Episode number (for TV)
 * @returns {Promise<Array>} - Array of stream results
 */
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
  console.log(`[DahmerMovies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

  // Get TMDB info
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

    // Call the main scraper function
    return searchStreams(
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

// Export the main function for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams, searchStreams };
} else if (typeof window !== 'undefined') {
  // Browser environment
  window.DahmerMovies = { getStreams, searchStreams };
} else {
  // React Native or other global environment
  global.getStreams = getStreams;
  global.searchStreams = searchStreams;
}

// Example usage:
// For movies:
// getStreams(550, 'movie')
//   .then(streams => console.log('Found streams:', streams))
//   .catch(err => console.error('Error:', err));
//
// For TV shows:
// getStreams(1399, 'tv', 1, 1)
//   .then(streams => console.log('Found streams:', streams))
//   .catch(err => console.error('Error:', err));
//
// Or directly search:
// searchStreams('The Matrix', 1999)
//   .then(streams => console.log('Found streams:', streams))
//   .catch(err => console.error('Error:', err));
