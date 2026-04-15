function getJson(url, options) {
  return fetch(url, options || {}).then(function (response) {
    if (!response || !response.ok) {
      throw new Error('Request failed: ' + url);
    }
    return response.json();
  });
}

function getText(url, options) {
  return fetch(url, options || {}).then(function (response) {
    if (!response || !response.ok) {
      throw new Error('Request failed: ' + url);
    }
    return response.text();
  });
}

function normalizeQuality(label) {
  var text = (label || '').toString();
  var match = text.match(/(2160p|1440p|1080p|720p|480p|360p|4K)/i);
  return match ? match[1].toUpperCase() : 'Auto';
}

function streamObject(provider, title, url, quality, headers) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  return {
    name: provider,
    title: title || provider,
    url: url,
    quality: quality || 'Auto',
    headers: headers || undefined
  };
}

function dedupeStreams(streams) {
  var seen = {};
  return (streams || []).filter(function (stream) {
    if (!stream || !stream.url) {
      return false;
    }
    if (seen[stream.url]) {
      return false;
    }
    seen[stream.url] = true;
    return true;
  });
}

function getTmdbMeta(tmdbId, mediaType) {
  var typePath = mediaType === 'tv' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + typePath + '/' + tmdbId + '?append_to_response=external_ids&api_key=ad301b7cc82ffe19273e55e4d4206885';
  return getJson(url);
}

function resolveVidEasy(tmdbId, mediaType, season, episode) {
  var typePath = mediaType === 'tv' ? 'tv' : 'movie';
  var dbUrl = 'https://db.videasy.net/3/' + typePath + '/' + tmdbId + '?append_to_response=external_ids&language=en&api_key=ad301b7cc82ffe19273e55e4d4206885';

  return getJson(dbUrl)
    .then(function (meta) {
      var isTv = mediaType === 'tv';
      var title = encodeURIComponent((isTv ? meta.name : meta.title) || '');
      var dateText = isTv ? meta.first_air_date : meta.release_date;
      var year = dateText ? new Date(dateText).getFullYear() : '';
      var imdbId = (meta.external_ids && meta.external_ids.imdb_id) || '';
      var fullUrl = 'https://api.videasy.net/cdn/sources-with-title?title=' + title + '&mediaType=' + (isTv ? 'tv' : 'movie') + '&year=' + year + '&episodeId=' + (isTv ? (episode || 1) : 1) + '&seasonId=' + (isTv ? (season || 1) : 1) + '&tmdbId=' + meta.id + '&imdbId=' + imdbId;
      return getText(fullUrl).then(function (encryptedText) {
        var body = JSON.stringify({ text: encryptedText, id: String(tmdbId) });
        return getJson('https://enc-dec.app/api/dec-videasy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: body
        });
      });
    })
    .then(function (decryptedData) {
      var result = (decryptedData && decryptedData.result) || {};
      var sources = Array.isArray(result.sources) ? result.sources : [];
      return sources
        .filter(function (source) {
          return source && source.url && !(source.quality || '').toUpperCase().includes('HDR');
        })
        .map(function (source) {
          return streamObject(
            'VidEasy',
            'VidEasy ' + (source.quality || 'Auto'),
            source.url,
            normalizeQuality(source.quality),
            {
              Origin: 'https://player.videasy.net',
              Referer: 'https://player.videasy.net/'
            }
          );
        })
        .filter(Boolean);
    })
    .catch(function () {
      return [];
    });
}

function resolveVidLink(tmdbId, mediaType, season, episode) {
  return getJson('https://enc-dec.app/api/enc-vidlink?text=' + encodeURIComponent(String(tmdbId)))
    .then(function (encrypted) {
      var encodedTmdb = encrypted && encrypted.result;
      if (!encodedTmdb) {
        return [];
      }

      var url = mediaType === 'tv'
        ? 'https://vidlink.pro/api/b/tv/' + encodedTmdb + '/' + (season || 1) + '/' + (episode || 1) + '?multiLang=0'
        : 'https://vidlink.pro/api/b/movie/' + encodedTmdb + '?multiLang=0';

      return getJson(url).then(function (payload) {
        var playlist = payload && payload.stream && payload.stream.playlist;
        var stream = streamObject('VidLink', 'VidLink Primary', playlist, 'Auto', { Referer: 'https://vidlink.pro' });
        return stream ? [stream] : [];
      });
    })
    .catch(function () {
      return [];
    });
}

function resolveHexa(tmdbId, mediaType, season, episode) {
  var key = '24ef089ebcab51d107a4e4709e87861ef609bace89ac23af13235f6ea743488f';
  var endpoint = mediaType === 'tv'
    ? 'https://themoviedb.hexa.su/api/tmdb/tv/' + tmdbId + '/season/' + (season || 1) + '/episode/' + (episode || 1) + '/images'
    : 'https://themoviedb.hexa.su/api/tmdb/movie/' + tmdbId + '/images';

  return getText(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'X-Api-Key': key
    }
  })
    .then(function (encryptedText) {
      return getJson('https://enc-dec.app/api/dec-hexa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ text: encryptedText, key: key })
      });
    })
    .then(function (decrypted) {
      var sources = (decrypted && decrypted.result && decrypted.result.sources) || [];
      if (!Array.isArray(sources)) {
        return [];
      }
      return sources
        .map(function (source) {
          return streamObject(
            'Hexa',
            'Hexa ' + (source.server || 'Server'),
            source.url,
            normalizeQuality(source.server),
            undefined
          );
        })
        .filter(Boolean);
    })
    .catch(function () {
      return [];
    });
}

function decodeMaybeBase64(text) {
  if (!text) {
    return text;
  }
  if (!/[A-Z]/.test(text)) {
    return text;
  }
  try {
    if (typeof atob === 'function') {
      return atob(text);
    }
  } catch (_error) {}
  return text;
}

function resolveSmashyStream(tmdbId, mediaType, season, episode) {
  return getTmdbMeta(tmdbId, mediaType)
    .then(function (meta) {
      var imdbId = mediaType === 'tv'
        ? (meta.external_ids && meta.external_ids.imdb_id)
        : meta.imdb_id;

      if (!imdbId) {
        return [];
      }

      return getJson('https://enc-dec.app/api/enc-vidstack')
        .then(function (tokenResponse) {
          var token = tokenResponse && tokenResponse.result && tokenResponse.result.token;
          if (!token) {
            return [];
          }

          var embedApi = mediaType === 'tv'
            ? 'https://api.smashystream.top/api/v1/videosmashyi/' + imdbId + '/155/' + (season || 1) + '/' + (episode || 1) + '?token=' + token + '&user_id='
            : 'https://api.smashystream.top/api/v1/videosmashyi/' + imdbId + '/155?token=' + token + '&user_id=';

          return getJson(embedApi)
            .then(function (embedData) {
              var embedUrl = embedData && embedData.data;
              if (!embedUrl || embedUrl.indexOf('#') === -1) {
                return [];
              }

              var embedId = embedUrl.split('#')[1];
              return getText('https://smashyplayer.top/api/v1/video?id=' + embedId)
                .then(function (encodedText) {
                  var encryptedText = decodeMaybeBase64(encodedText);
                  return getJson('https://enc-dec.app/api/dec-vidstack', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: encryptedText })
                  });
                })
                .then(function (decrypted) {
                  var result = (decrypted && decrypted.result) || {};
                  var streamPath = result.hls || result.cf || '';
                  if (!streamPath) {
                    return [];
                  }

                  var streamUrl = streamPath;
                  if (result.hls && streamPath.charAt(0) === '/') {
                    streamUrl = 'https://proxy.aether.mom/m3u8-proxy?url=https://smashyplayer.top' + streamPath;
                  }

                  var stream = streamObject('SmashyStream', 'SmashyStream Default', streamUrl, 'Auto', undefined);
                  return stream ? [stream] : [];
                });
            });
        });
    })
    .catch(function () {
      return [];
    });
}

function resolveVidSrc(tmdbId, mediaType, season, episode) {
  return getTmdbMeta(tmdbId, mediaType)
    .then(function (meta) {
      var imdbId = mediaType === 'tv'
        ? (meta.external_ids && meta.external_ids.imdb_id)
        : meta.imdb_id;

      if (!imdbId) {
        return [];
      }

      var embedUrl = mediaType === 'tv'
        ? 'https://vsrc.su/embed/tv?imdb=' + imdbId + '&season=' + (season || 1) + '&episode=' + (episode || 1)
        : 'https://vsrc.su/embed/' + imdbId;

      return getText(embedUrl)
        .then(function (embedHtml) {
          var iframeMatch = embedHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
          var iframeSrc = iframeMatch ? iframeMatch[1] : '';
          if (!iframeSrc) {
            return [];
          }

          return getText('https:' + iframeSrc, {
            headers: {
              referer: 'https://vsrc.su/'
            }
          })
            .then(function (iframeHtml) {
              var srcMatch = iframeHtml.match(/src:\s*['"]([^'"]+)['"]/i);
              var prorcpSrc = srcMatch ? srcMatch[1] : '';
              if (!prorcpSrc) {
                return [];
              }

              return getText('https://cloudnestra.com' + prorcpSrc, {
                headers: {
                  referer: 'https://cloudnestra.com/'
                }
              })
                .then(function (cloudHtml) {
                  var divMatch = cloudHtml.match(/<div id="([^"]+)"[^>]*style=["']display\s*:\s*none;?["'][^>]*>([a-zA-Z0-9:\/.,{}\-_=+ ]+)<\/div>/i);
                  var divId = divMatch ? divMatch[1] : '';
                  var divText = divMatch ? divMatch[2] : '';
                  if (!divId || !divText) {
                    return [];
                  }

                  return getJson('https://enc-dec.app/api/dec-cloudnestra', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ text: divText, div_id: divId })
                  })
                    .then(function (decrypted) {
                      var urls = (decrypted && decrypted.result) || [];
                      if (!Array.isArray(urls)) {
                        return [];
                      }
                      return urls
                        .map(function (url, index) {
                          return streamObject(
                            'VidSrc',
                            'VidSrc Server ' + (index + 1),
                            url,
                            'Auto',
                            {
                              referer: 'https://cloudnestra.com/',
                              origin: 'https://cloudnestra.com'
                            }
                          );
                        })
                        .filter(Boolean);
                    });
                });
            });
        });
    })
    .catch(function () {
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var resolvers = [
    resolveVidEasy,
    resolveVidLink,
    resolveHexa,
    resolveSmashyStream,
    resolveVidSrc
  ];

  return Promise.all(
    resolvers.map(function (resolver) {
      return resolver(tmdbId, mediaType, season, episode).catch(function () {
        return [];
      });
    })
  )
    .then(function (results) {
      var merged = [];
      results.forEach(function (group) {
        if (Array.isArray(group)) {
          merged = merged.concat(group);
        }
      });
      return dedupeStreams(merged).slice(0, 50);
    })
    .catch(function () {
      return [];
    });
}

module.exports = { getStreams: getStreams };
