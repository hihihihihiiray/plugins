// VidEasy Scraper for Nuvio Local Scrapers by D3adlyRocket
// React Native compatible version

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/fmovies/index.js
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var DECRYPT_API_URL = "https://enc-dec.app/api/dec-videasy";
var REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  Connection: "keep-alive"
};
var PLAYBACK_HEADERS = {
  "User-Agent": REQUEST_HEADERS["User-Agent"],
  Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.cineby.sc/",
  Origin: "https://www.cineby.sc",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site"
};
var SERVERS = [
  {
    name: "Neon",
    language: "Original",
    url: "https://api.videasy.net/myflixerzupcloud/sources-with-title"
  },
  {
    name: "Yoru",
    language: "Original",
    url: "https://api.videasy.net/cdn/sources-with-title"
  }
];
function getJson(url) {
  return fetch(url, { headers: REQUEST_HEADERS }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  });
}
function getText(url) {
  return fetch(url, { headers: REQUEST_HEADERS }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
  });
}
function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    headers: __spreadProps(__spreadValues({}, REQUEST_HEADERS), {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify(payload)
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  });
}
function fetchMediaDetails(tmdbId, mediaType) {
  const normalizedType = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  const url = `${TMDB_BASE_URL}/${normalizedType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  return getJson(url).then((data) => ({
    tmdbId: String(data.id || tmdbId),
    mediaType: normalizedType,
    title: normalizedType === "tv" ? data.name : data.title,
    year: normalizedType === "tv" ? String(data.first_air_date || "").slice(0, 4) : String(data.release_date || "").slice(0, 4),
    imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : ""
  }));
}
function buildServerUrl(server, media, season, episode) {
  const params = new URLSearchParams();
  params.set("title", encodeURIComponent(encodeURIComponent(media.title).replace(/\+/g, "%20")));
  params.set("mediaType", media.mediaType);
  params.set("year", media.year || "");
  params.set("tmdbId", media.tmdbId);
  params.set("imdbId", media.imdbId || "");
  if (media.mediaType === "tv") {
    params.set("seasonId", String(season || 1));
    params.set("episodeId", String(episode || 1));
  }
  return `${server.url}?${params.toString()}`;
}
function decryptPayload(encryptedText, tmdbId) {
  return postJson(DECRYPT_API_URL, { text: encryptedText, id: String(tmdbId) }).then((response) => response.result || {});
}
function normalizeQuality(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Adaptive";
  }
  const upper = raw.toUpperCase();
  if (/^\d{3,4}P$/.test(upper)) {
    return upper;
  }
  if (/^\d{3,4}p$/.test(raw)) {
    return raw;
  }
  if (/hindi/i.test(raw)) {
    return "Adaptive";
  }
  return raw;
}
function createStream(source, server, media) {
  const quality = normalizeQuality(source.quality);
  const title = media.year ? `${media.title} (${media.year})` : media.title;
  return {
    name: `VidEasy ${server.name} - ${quality}`,
    title,
    url: source.url,
    quality,
    headers: PLAYBACK_HEADERS,
    provider: "fmovies",
    language: server.language
  };
}
function fetchFromServer(server, media, season, episode) {
  return getText(buildServerUrl(server, media, season, episode)).then((encryptedText) => {
    if (!encryptedText || !encryptedText.trim()) {
      return [];
    }
    return decryptPayload(encryptedText, media.tmdbId);
  }).then((payload) => {
    const sources = Array.isArray(payload && payload.sources) ? payload.sources : [];
    return sources.filter((source) => source && typeof source.url === "string" && source.url.includes("workers.dev")).map((source) => createStream(source, server, media));
  }).catch(() => []);
}
function dedupeStreams(streams) {
  const seen = /* @__PURE__ */ new Set();
  return streams.filter((stream) => {
    if (seen.has(stream.url)) {
      return false;
    }
    seen.add(stream.url);
    return true;
  });
}
function sortStreams(streams) {
  function sortStreams(streams) {
  const rank = (quality) => {
    if (!quality) return 0;

    const q = String(quality).toLowerCase();

    // Explicit 4K detection
    if (q.includes("4k") || q.includes("2160")) return 2160;

    // Extract numeric resolution (e.g., 1080p, 720p)
    const match = q.match(/(\d{3,4})/);
    if (match) {
      return parseInt(match[1], 10);
    }

    // Adaptive streams should be BELOW real resolutions
    if (q.includes("adaptive") || q.includes("auto")) {
      return 1;
    }

    return 0;
  };

  return [...streams].sort((a, b) => rank(b.quality) - rank(a.quality));
}
  return [...streams].sort((left, right) => rank(right.quality) - rank(left.quality));
}
function flattenResults(results) {
  return results.reduce((all, item) => all.concat(item || []), []);
}
function getStreams(tmdbIdOrMedia, mediaType = "movie", season = null, episode = null) {
  return __async(this, null, function* () {
    try {
      let tmdbId;
      let type;
      let s;
      let e;
      if (typeof tmdbIdOrMedia === "object" && tmdbIdOrMedia !== null) {
        tmdbId = tmdbIdOrMedia.tmdb_id || tmdbIdOrMedia.tmdbId;
        type = tmdbIdOrMedia.type || tmdbIdOrMedia.mediaType || "movie";
        s = tmdbIdOrMedia.season;
        e = tmdbIdOrMedia.episode;
      } else {
        tmdbId = tmdbIdOrMedia;
        type = mediaType;
        s = season;
        e = episode;
      }
      const normalizedMediaType = type === "series" ? "tv" : type;
      const normalizedSeason = s == null ? null : parseInt(s, 10);
      const normalizedEpisode = e == null ? null : parseInt(e, 10);
      const media = yield fetchMediaDetails(tmdbId, normalizedMediaType);
      const results = yield Promise.all(
        SERVERS.map((server) => fetchFromServer(server, media, normalizedSeason, normalizedEpisode))
      );
      return sortStreams(dedupeStreams(flattenResults(results)));
    } catch (_error) {
      return [];
    }
  });
}
module.exports = { getStreams };
