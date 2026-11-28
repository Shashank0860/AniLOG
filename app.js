/**
 * AniLOG — app.js
 * Phase 2: Full application logic + LocalStorage persistence.
 *
 * File is organised into five clear sections:
 *   1. STORAGE    — read/write LocalStorage, nothing else
 *   2. STATE      — the single source of truth for runtime data
 *   3. HELPERS    — small, reusable utility functions
 *   4. RENDER     — functions that build and inject HTML
 *   5. EVENTS     — all user-interaction listeners
 *
 * Data model (one anime object):
 * {
 *   id:         string   — unique id (timestamp-based)
 *   title:      string
 *   posterUrl:  string   — empty string if not provided
 *   totalEps:   number
 *   watchedEps: number
 *   status:     'watching' | 'completed' | 'plan' | 'dropped'
 *   genre:      string
 *   rating:     number   — 0–10, 0 means unrated
 *   review:     string
 *   notes:      string
 *   addedAt:    number   — Date.now() timestamp
 * }
 */

/* ═══════════════════════════════════════════════════════════
   1. STORAGE — LocalStorage interface
   All keys are prefixed with 'anilog_' to avoid collisions.
═══════════════════════════════════════════════════════════ */

var STORAGE_KEY = 'anilog_library';
var SCHEMA_VERSION = 2;
var ACTIVITY_STORAGE_KEY = 'anilog_activity';
var ACTIVITY_SCHEMA_VERSION = 1;

/**
 * Formats a timestamp into YYYY-MM-DD in the user's local timezone.
 * @param {number} timestamp
 * @returns {string}
 */
function toLocalDateKey(timestamp) {
  var d = new Date(timestamp);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Sanitizes raw watch activity events.
 * @param {Array} raw
 * @returns {Array}
 */
function sanitizeWatchEvents(raw) {
  if (!Array.isArray(raw)) return [];
  var seen = {};
  return raw
    .filter(function(ev) {
      if (!ev || typeof ev !== 'object') return false;
      if (typeof ev.title !== 'string' || !ev.title.trim()) return false;
      var eps = parseInt(ev.episodes, 10);
      if (isNaN(eps) || eps < 1) return false;
      return true;
    })
    .map(function(ev) {
      var id = (ev.id && String(ev.id).trim()) ? String(ev.id).trim() : generateId();
      var ts = typeof ev.timestamp === 'number' && !isNaN(ev.timestamp) ? ev.timestamp : Date.now();
      var prevEp = Math.max(0, Math.floor(Number(ev.prevEp) || 0));
      var episodes = Math.max(1, Math.floor(Number(ev.episodes) || 1));
      var newEp = typeof ev.newEp === 'number' ? Math.max(prevEp + episodes, Math.floor(ev.newEp)) : (prevEp + episodes);
      var poster = (typeof ev.posterUrl === 'string' && isValidUrl(ev.posterUrl.trim())) ? ev.posterUrl.trim() : '';
      var localDate = (typeof ev.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.localDate))
        ? ev.localDate
        : toLocalDateKey(ts);
      return {
        id:        id,
        animeId:   typeof ev.animeId === 'string' ? ev.animeId : String(ev.animeId || ''),
        title:     ev.title.trim(),
        posterUrl: poster,
        episodes:  episodes,
        prevEp:    prevEp,
        newEp:     newEp,
        timestamp: ts,
        localDate: localDate
      };
    })
    .filter(function(ev) {
      if (seen[ev.id]) return false;
      seen[ev.id] = true;
      return true;
    });
}

/**
 * Sanitizes raw completion events.
 * @param {Array} raw
 * @returns {Array}
 */
function sanitizeCompletionEvents(raw) {
  if (!Array.isArray(raw)) return [];
  var seen = {};
  return raw
    .filter(function(ev) {
      return ev && typeof ev === 'object' && typeof ev.title === 'string' && ev.title.trim() !== '';
    })
    .map(function(ev) {
      var id = (ev.id && String(ev.id).trim()) ? String(ev.id).trim() : generateId();
      var ts = typeof ev.timestamp === 'number' && !isNaN(ev.timestamp) ? ev.timestamp : Date.now();
      var poster = (typeof ev.posterUrl === 'string' && isValidUrl(ev.posterUrl.trim())) ? ev.posterUrl.trim() : '';
      var localDate = (typeof ev.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.localDate))
        ? ev.localDate
        : toLocalDateKey(ts);
      return {
        id:        id,
        animeId:   typeof ev.animeId === 'string' ? ev.animeId : String(ev.animeId || ''),
        title:     ev.title.trim(),
        posterUrl: poster,
        format:    typeof ev.format === 'string' ? ev.format : '',
        timestamp: ts,
        localDate: localDate
      };
    })
    .filter(function(ev) {
      if (seen[ev.id]) return false;
      seen[ev.id] = true;
      return true;
    });
}

function activityLoad() {
  var raw = null;
  try {
    raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return { watchEvents: [], completionEvents: [] };
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid activity schema');
    return {
      watchEvents:      sanitizeWatchEvents(parsed.watchEvents),
      completionEvents: sanitizeCompletionEvents(parsed.completionEvents)
    };
  } catch (e) {
    console.warn('[AniLOG] Corrupt activity data. Backing up and starting fresh.', e);
    if (raw) {
      try { localStorage.setItem(ACTIVITY_STORAGE_KEY + ':corrupt-backup', raw); } catch (err) {}
    }
    return { watchEvents: [], completionEvents: [] };
  }
}

function activitySave(activity) {
  try {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({
      schemaVersion:    ACTIVITY_SCHEMA_VERSION,
      watchEvents:      activity.watchEvents || [],
      completionEvents: activity.completionEvents || []
    }));
    return true;
  } catch (e) {
    console.error('[AniLOG] Could not save activity to LocalStorage.', e);
    showToast('Could not save watch activity — browser storage may be full or blocked.', 'error');
    return false;
  }
}

/**
 * Displays a non-blocking manga-styled toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 * @param {number} [duration=4500]  0 keeps toast until manually dismissed
 */
function showToast(message, type, duration) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (type || 'info');
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  var textSpan = document.createElement('span');
  textSpan.textContent = message;

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  });

  toast.appendChild(textSpan);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  var ms = typeof duration === 'number' ? duration : 4500;
  if (ms > 0) {
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, ms);
  }
}

/**
 * Sanitizes a raw quotes array from LocalStorage.
 * Preserves valid quote objects and assigns defaults for missing metadata.
 * @param {*} rawQuotes
 * @returns {Array}
 */
function sanitizeQuotes(rawQuotes) {
  if (!Array.isArray(rawQuotes)) return [];
  return rawQuotes
    .filter(function(q) {
      return q && typeof q === 'object' && typeof q.text === 'string' && q.text.trim() !== '';
    })
    .map(function(q) {
      var epRaw = q.episode;
      var ep = null;
      if (epRaw !== null && epRaw !== undefined && epRaw !== '') {
        // Only accept positive whole numbers
        var epStr = String(epRaw);
        if (/^\d+$/.test(epStr)) {
          var parsedEp = parseInt(epStr, 10);
          if (parsedEp >= 1 && parsedEp <= 9999) ep = parsedEp;
        }
      }
      return {
        id:        String(q.id || generateId()),
        text:      q.text.trim(),
        speaker:   typeof q.speaker === 'string' ? q.speaker.trim() : '',
        episode:   ep,
        createdAt: typeof q.createdAt === 'number' ? q.createdAt : Date.now()
      };
    });
}

/**
 * Sanitizes an array of raw anime entries and ensures stable unique IDs.
 * @param {Array} rawArray
 * @returns {Array}
 */
function sanitizeLibraryEntries(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  return rawArray
    .filter(function(item) {
      return item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim() !== '';
    })
    .map(function(item) {
      var parsedTotal = item.totalEps === null ? null : parseInt(item.totalEps, 10);
      var totalEps    = (parsedTotal === null || isNaN(parsedTotal)) ? null : Math.max(1, parsedTotal);
      var rawWatched  = Math.max(0, Math.floor(Number(item.watchedEps) || 0));
      var watchedEps  = totalEps !== null ? Math.min(totalEps, rawWatched) : rawWatched;
      var parsedRating = (item.rating === null || item.rating === undefined || item.rating === '' || item.rating === 0 || item.rating === '0')
        ? null
        : parseInt(item.rating, 10);
      var rating      = (parsedRating === null || isNaN(parsedRating) || parsedRating < 1)
        ? null
        : Math.min(10, parsedRating);
      var anilistId   = typeof item.anilistId === 'number' ? item.anilistId : null;
      var stableId    = (item.id && String(item.id).trim())
        ? String(item.id).trim()
        : (anilistId !== null ? 'anilist-' + anilistId : generateId());

      return {
        id:            stableId,
        anilistId:     anilistId,
        title:         item.title.trim(),
        posterUrl:     typeof item.posterUrl === 'string' ? item.posterUrl.trim() : '',
        totalEps:      totalEps,
        watchedEps:    watchedEps,
        status:        ['watching', 'completed', 'plan', 'dropped'].indexOf(item.status) !== -1 ? item.status : 'plan',
        format:        typeof item.format === 'string' ? item.format : '',
        releaseYear:   typeof item.releaseYear === 'number' ? item.releaseYear : null,
        airingStatus:  typeof item.airingStatus === 'string' ? item.airingStatus : '',
        genre:         typeof item.genre === 'string' ? item.genre.trim() : '',
        rating:        rating,
        review:        typeof item.review === 'string' ? item.review : '',
        notes:         typeof item.notes === 'string' ? item.notes : '',
        addedAt:       typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
        updatedAt:     typeof item.updatedAt === 'number' ? item.updatedAt : (typeof item.addedAt === 'number' ? item.addedAt : Date.now()),
        autoCompleted: item.autoCompleted === true,
        demo:          item.demo === true,
        quotes:        sanitizeQuotes(item.quotes)
      };
    });
}

/**
 * Loads the anime array from LocalStorage, handling schema migration and corrupt data backup.
 * @returns {Array}
 */
function storageLoad() {
  var raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);

    var rawEntries = null;
    var needsMigration = false;

    if (Array.isArray(parsed)) {
      // Legacy v1 format (raw array without schemaVersion)
      rawEntries = parsed;
      needsMigration = true;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.library)) {
      rawEntries = parsed.library;
      if ((parsed.schemaVersion || 1) < SCHEMA_VERSION) {
        needsMigration = true;
      }
    } else {
      throw new Error('Unexpected storage schema');
    }

    var sanitized = sanitizeLibraryEntries(rawEntries);
    if (needsMigration) {
      storageSave(sanitized, true);
    }
    return sanitized;
  } catch (e) {
    console.warn('[AniLOG] Corrupt or unreadable stored data. Backing up and starting fresh.', e);
    if (raw) {
      try {
        localStorage.setItem(STORAGE_KEY + ':corrupt-backup', raw);
      } catch (backupErr) {
        console.error('[AniLOG] Could not write corrupt backup.', backupErr);
      }
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, library: [] }));
    } catch (resetErr) {
      // ignore if storage is completely blocked
    }
    state.corruptBackupNotice = true;
    return [];
  }
}

/**
 * Saves the current anime array with schemaVersion to LocalStorage.
 * @param {Array} library
 * @param {boolean} [silent=false]
 */
function storageSave(library, silent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      library: library
    }));
    return true;
  } catch (e) {
    console.error('[AniLOG] Could not save to LocalStorage.', e);
    if (!silent) {
      showToast('Could not save changes — browser storage may be full or blocked.', 'error');
    }
    return false;
  }
}


/* ═══════════════════════════════════════════════════════════
   2. STATE — single runtime object
   All reads and writes go through these functions so there
   is never more than one copy of the data in memory.
═══════════════════════════════════════════════════════════ */

var state = {
  library:        [],   // full anime array
  activity:       { watchEvents: [], completionEvents: [] },
  activeTab:      'all',
  searchQuery:    '',
  sortBy:         'added',
  statusFilter:   'all',
  journalFilter:  'all', // 'all' | 'reviews' | 'quotes'
  insightsTab:    'timeline', // 'timeline' | 'overview' | 'recap'
  timelineFilter: 'all', // 'all' | 'week' | 'month' | 'year'
  timelineLimit:  20,
  chartPeriod:    'daily', // 'daily' | 'weekly' | 'monthly' | 'yearly'
  recapYear:      new Date().getFullYear(),
  currentAnimeId: null  // id of the anime shown in Details
};

/** Load persisted data into state at startup. */
function stateInit() {
  state.library  = storageLoad();
  state.activity = activityLoad();
}

/**
 * Records a watch activity event when watched episodes increase.
 * @param {Object} anime
 * @param {number} prevEp
 * @param {number} newEp
 */
function recordWatchActivity(anime, prevEp, newEp) {
  if (!anime || newEp <= prevEp) return;
  var now = Date.now();
  var ev = {
    id:        generateId(),
    animeId:   anime.id,
    title:     anime.title,
    posterUrl: (anime.posterUrl && isValidUrl(anime.posterUrl)) ? anime.posterUrl : '',
    episodes:  newEp - prevEp,
    prevEp:    prevEp,
    newEp:     newEp,
    timestamp: now,
    localDate: toLocalDateKey(now)
  };
  state.activity.watchEvents.unshift(ev);
  activitySave(state.activity);
}

/**
 * Records a completion event when an anime transitions to 'completed'.
 * Preserves prior completion history if status is toggled away and back.
 * @param {Object} anime
 */
function recordCompletionEvent(anime) {
  if (!anime) return;
  var now = Date.now();
  var today = toLocalDateKey(now);
  var alreadyToday = state.activity.completionEvents.some(function(c) {
    return c.animeId === anime.id && c.localDate === today;
  });
  if (alreadyToday) return;
  state.activity.completionEvents.unshift({
    id:        generateId(),
    animeId:   anime.id,
    title:     anime.title,
    posterUrl: (anime.posterUrl && isValidUrl(anime.posterUrl)) ? anime.posterUrl : '',
    format:    anime.format || '',
    timestamp: now,
    localDate: today
  });
  activitySave(state.activity);
}

/**
 * Persist state.library and re-render everything.
 * Called after every mutation (add, edit, delete, ep change, etc.)
 */
function stateCommit() {
  storageSave(state.library);
  renderAll();
}


/* ═══════════════════════════════════════════════════════════
   3. HELPERS — small utilities (no DOM side-effects)
═══════════════════════════════════════════════════════════ */

/**
 * Generates a simple unique id using the current timestamp
 * plus a short random suffix.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Finds one anime object by id.
 * Returns undefined if not found.
 * @param {string} id
 * @returns {Object|undefined}
 */
function findAnimeById(id) {
  return state.library.find(function(a) { return a.id === id; });
}

/**
 * Finds one anime object by its AniList ID.
 * @param {number} anilistId
 * @returns {Object|undefined}
 */
function findAnimeByAnilistId(anilistId) {
  if (!anilistId) return undefined;
  return state.library.find(function(a) { return a.anilistId === anilistId; });
}

/**
 * Formats total episodes for display (handles null/unknown counts).
 * @param {Object} anime
 * @returns {string}
 */
function formatTotalEps(anime) {
  return anime.totalEps !== null && anime.totalEps !== undefined ? String(anime.totalEps) : '?';
}

/**
 * Formats a concise episode/format metadata string for cards.
 * Movies are not displayed as multi-episode TV shows.
 * @param {Object} anime
 * @returns {string}
 */
function formatCardMeta(anime) {
  var parts = [];
  if (anime.genre) parts.push(anime.genre);
  if (anime.format === 'MOVIE') {
    parts.push('Movie');
  } else {
    parts.push(formatTotalEps(anime) + ' eps');
  }
  return parts.join(' · ');
}

/**
 * Formats AniList airing/completion status for display.
 * @param {string} airingStatus
 * @returns {string}
 */
function formatAiringStatus(airingStatus) {
  var map = {
    FINISHED:         'Finished',
    RELEASING:        'Airing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED:        'Cancelled',
    HIATUS:           'Hiatus'
  };
  return map[airingStatus] || airingStatus || '—';
}

/**
 * Formats AniList media format for display.
 * @param {string} format
 * @returns {string}
 */
function formatMediaFormat(format) {
  var map = {
    TV:       'TV',
    TV_SHORT: 'TV Short',
    MOVIE:    'Movie',
    OVA:      'OVA',
    ONA:      'ONA',
    SPECIAL:  'Special'
  };
  return map[format] || format || '—';
}

/**
 * Computes normalized progress details for an anime entry.
 * Returns percent: null when totalEps is null, 0, or missing (never NaN/Infinity/0%).
 * @param {Object} entry
 * @returns {{ watched: number, total: number|null, percent: number|null, barWidth: number, label: string }}
 */
function getProgress(entry) {
  var watched = Math.max(0, Math.floor(Number(entry && entry.watchedEps) || 0));
  var total = (entry && typeof entry.totalEps === 'number' && entry.totalEps > 0) ? entry.totalEps : null;
  if (total === null) {
    return {
      watched:  watched,
      total:    null,
      percent:  null,
      barWidth: 0,
      label:    'Ongoing'
    };
  }
  var clampedWatched = Math.min(total, watched);
  var pct = Math.min(100, Math.round((clampedWatched / total) * 100));
  return {
    watched:  clampedWatched,
    total:    total,
    percent:  pct,
    barWidth: pct,
    label:    pct + '% complete'
  };
}

/**
 * Legacy alias for getProgress(anime).percent (returns 0 only when numeric needed).
 * @param {Object} anime
 * @returns {number|null}
 */
function calcProgress(anime) {
  return getProgress(anime).percent;
}

/**
 * Builds a string of filled (★) and empty (☆) stars from a 0–10 rating.
 * We display out of 10 as 10 symbols total.
 * @param {number} rating  0–10
 * @returns {string}
 */
function buildStarString(rating) {
  var filled = Math.round(rating);
  var empty  = 10 - filled;
  return '★'.repeat(filled) + '☆'.repeat(empty);
}

/**
 * Builds a compact 5-star summary string from a 0–10 rating.
 * @param {number} rating  0–10
 * @returns {string}
 */
function buildStarSummary(rating) {
  if (!rating || rating <= 0) return '☆☆☆☆☆';
  var filled = Math.min(5, Math.max(1, Math.round(rating / 2)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/**
 * Returns a human-readable label for a status value.
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  var labels = { watching: 'Watching', completed: 'Completed', plan: 'Plan to Watch', dropped: 'Dropped' };
  return labels[status] || status;
}

/**
 * Returns a formatted date string from a timestamp.
 * @param {number} timestamp
 * @returns {string}  e.g. "November 26, 2026"
 */
function formatDate(timestamp) {
  var d = new Date(timestamp);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Escapes HTML special characters to prevent injection when
 * inserting user-supplied text via innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns a filtered + sorted copy of state.library.
 * Applies: activeTab, statusFilter (dropdown), searchQuery, sortBy.
 * @returns {Array}
 */
function getFilteredLibrary() {
  var list = state.library.slice(); // copy, never mutate original

  // Tab filter (also used by dropdown — both must agree)
  var statusTarget = state.activeTab !== 'all' ? state.activeTab : state.statusFilter;

  if (statusTarget && statusTarget !== 'all') {
    list = list.filter(function(a) { return a.status === statusTarget; });
  }

  // Search filter
  if (state.searchQuery) {
    var q = state.searchQuery.toLowerCase();
    list = list.filter(function(a) {
      return a.title.toLowerCase().includes(q);
    });
  }

  // Stable sort with Title A–Z tiebreak
  function compareTitle(a, b) {
    return a.title.localeCompare(b.title);
  }

  list.sort(function(a, b) {
    if (state.sortBy === 'title') {
      return compareTitle(a, b);
    }
    if (state.sortBy === 'rating') {
      var ra = typeof a.rating === 'number' && a.rating >= 1 ? a.rating : null;
      var rb = typeof b.rating === 'number' && b.rating >= 1 ? b.rating : null;
      if (ra === null && rb === null) return compareTitle(a, b);
      if (ra === null) return 1;  // unrated always last
      if (rb === null) return -1;
      return (rb - ra) || compareTitle(a, b);
    }
    if (state.sortBy === 'progress') {
      var pa = getProgress(a).percent;
      var pb = getProgress(b).percent;
      if (pa === null && pb === null) return compareTitle(a, b);
      if (pa === null) return 1;  // ongoing/unknown always last
      if (pb === null) return -1;
      return (pb - pa) || compareTitle(a, b);
    }
    // Default: 'added' — newest first, tiebreak by title
    return ((b.addedAt || 0) - (a.addedAt || 0)) || compareTitle(a, b);
  });

  return list;
}

/**
 * Builds the poster image element HTML.
 * Uses an <img> if posterUrl is set, otherwise a kanji placeholder.
 * @param {Object} anime
 * @param {string} sizeClass  CSS class like 'poster-lg', 'poster-xl'
 * @returns {string}  HTML string
 */
function buildPosterHtml(anime, sizeClass) {
  var safeUrl = anime.posterUrl && isValidUrl(anime.posterUrl) ? anime.posterUrl : '';
  var kanji = (anime.title || '?').charAt(0).toUpperCase();
  if (safeUrl) {
    return '<img class="poster-img js-poster-img ' + sizeClass + '" src="' + escapeHtml(safeUrl) +
           '" alt="Poster for ' + escapeHtml(anime.title) + '" loading="lazy" decoding="async">' +
           '<div class="poster-placeholder ' + sizeClass + '" style="display:none"><span class="poster-kanji">' + escapeHtml(kanji) + '</span></div>';
  }
  // No valid URL — show placeholder with first character of title
  return '<div class="poster-placeholder ' + sizeClass + '"><span class="poster-kanji">' + escapeHtml(kanji) + '</span></div>';
}


/* ═══════════════════════════════════════════════════════════
   4. RENDER — DOM builders
   Each render function is responsible for one part of the UI.
   They read from state and write to the DOM.
═══════════════════════════════════════════════════════════ */

/** Master render — calls every sub-render in the right order. */
function renderAll() {
  renderStats();
  renderDashboardWatching();
  renderDashboardCompleted();
  renderLibrary();
  renderTabCounts();
  renderJournal();
  if (typeof renderInsights === 'function') renderInsights();
  var removeDemoBtn = document.getElementById('remove-demo-btn');
  if (removeDemoBtn) {
    var hasDemo = state.library.some(function(a) { return a.demo === true; });
    removeDemoBtn.style.display = hasDemo ? '' : 'none';
  }
  // If a details panel is open, refresh it too
  if (state.currentAnimeId) {
    var anime = findAnimeById(state.currentAnimeId);
    if (anime) renderDetails(anime);
    else {
      // Anime was deleted — clear details and go back to library
      state.currentAnimeId = null;
      document.getElementById('details-content').innerHTML = '';
      navigateTo('library');
    }
  }
}

/* ── 4.1 Dashboard Stats ── */
function renderStats() {
  var lib = state.library;
  var totalEps = lib.reduce(function(sum, a) { return sum + (a.watchedEps || 0); }, 0);
  var completed = lib.filter(function(a) { return a.status === 'completed'; }).length;
  var watching  = lib.filter(function(a) { return a.status === 'watching';  }).length;
  var plan      = lib.filter(function(a) { return a.status === 'plan';      }).length;

  document.getElementById('stat-total').textContent     = lib.length;
  document.getElementById('stat-episodes').textContent  = totalEps;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-watching').textContent  = watching;
  document.getElementById('stat-plan').textContent      = plan;
}

/* ── 4.2 Dashboard — Currently Watching ── */
function renderDashboardWatching() {
  var container = document.getElementById('dashboard-watching');
  var watching = state.library.filter(function(a) { return a.status === 'watching'; });

  if (watching.length === 0) {
    var demoBtnHtml = state.library.length === 0
      ? ' <button type="button" class="btn-secondary btn-sm load-demo-btn">Load Demo Data</button>'
      : '';
    container.innerHTML =
      '<div class="empty-state">' +
        '<p>Nothing currently watching.<br><em>Add an anime to start tracking your progress.</em></p>' +
        '<div class="empty-state-actions">' +
          '<button type="button" class="btn-primary btn-sm empty-add-btn">+ Add Anime</button>' +
          demoBtnHtml +
        '</div>' +
      '</div>';
    return;
  }

  container.innerHTML = watching.slice(0, 5).map(function(anime) {
    var prog = getProgress(anime);
    return (
      '<div class="watching-card" data-id="' + anime.id + '">' +
        '<div class="watching-poster">' +
          buildPosterHtml(anime, '') +
          '<div class="status-badge status-watching">Watching</div>' +
        '</div>' +
        '<div class="watching-info">' +
          '<h3 class="watching-title">' + escapeHtml(anime.title) + '</h3>' +
          '<p class="watching-meta">' + escapeHtml(anime.genre || 'No genre set') + '</p>' +
          '<div class="episode-progress">' +
            '<span class="ep-label">EP</span>' +
            '<span class="ep-current">' + prog.watched + '</span>' +
            '<span class="ep-sep">/</span>' +
            '<span class="ep-total">' + (prog.total !== null ? prog.total : 'Ongoing') + '</span>' +
          '</div>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + prog.barWidth + '%"></div></div>' +
        '</div>' +
        '<div class="watching-actions">' +
          '<button type="button" class="btn-secondary btn-sm dash-ep-btn" data-id="' + anime.id + '" aria-label="Add 1 watched episode for ' + escapeHtml(anime.title) + '">+ EP</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ── 4.3 Dashboard — Recently Completed ── */
function renderDashboardCompleted() {
  var container = document.getElementById('dashboard-completed');
  var completed = state.library
    .filter(function(a) { return a.status === 'completed'; })
    .sort(function(a, b) { return b.addedAt - a.addedAt; })
    .slice(0, 5);

  if (completed.length === 0) {
    container.innerHTML = '<p class="empty-state">No completed anime yet.</p>';
    return;
  }

  container.innerHTML = completed.map(function(anime) {
    var stars = buildStarSummary(anime.rating);
    return (
      '<button type="button" class="completed-item" data-id="' + anime.id + '">' +
        '<div class="completed-poster-mini">' +
          buildPosterHtml(anime, 'completed-poster-img') +
        '</div>' +
        '<div class="completed-info">' +
          '<p class="completed-title">' + escapeHtml(anime.title) + '</p>' +
          '<div class="star-rating">' + stars + '</div>' +
        '</div>' +
      '</button>'
    );
  }).join('');
}

/* ── 4.4 Library Grid ── */
function renderLibrary() {
  var grid = document.getElementById('anime-grid');
  var list = getFilteredLibrary();

  if (list.length === 0) {
    if (state.library.length === 0) {
      grid.innerHTML =
        '<div class="empty-state empty-state--grid">' +
          '<p>Your library is empty.<br><em>Add your first anime or load sample data to explore AniLOG.</em></p>' +
          '<div class="empty-state-actions">' +
            '<button type="button" class="btn-primary btn-sm empty-add-btn">+ Add Anime</button>' +
            '<button type="button" class="btn-secondary btn-sm load-demo-btn">Load Demo Data</button>' +
          '</div>' +
        '</div>';
    } else {
      grid.innerHTML =
        '<div class="empty-state empty-state--grid">' +
          '<p>No anime match your current filter.<br><em>Try another keyword or reset filters.</em></p>' +
          '<button type="button" class="btn-secondary btn-sm empty-reset-btn">Clear Filters</button>' +
        '</div>';
    }
    return;
  }

  grid.innerHTML = list.map(function(anime) {
    var prog  = getProgress(anime);
    var stars = buildStarSummary(anime.rating);
    return (
      '<article class="anime-card" data-id="' + anime.id + '" data-status="' + anime.status + '">' +
        '<button type="button" class="anime-card-btn" aria-label="Open details for ' + escapeHtml(anime.title) + '">' +
          '<div class="anime-card-poster">' +
            buildPosterHtml(anime, 'poster-lg') +
            '<div class="status-badge status-' + anime.status + '">' + statusLabel(anime.status) + '</div>' +
          '</div>' +
          '<div class="anime-card-info">' +
            '<h3 class="anime-card-title">' + escapeHtml(anime.title) + '</h3>' +
            '<p class="anime-card-meta">' + escapeHtml(formatCardMeta(anime)) + '</p>' +
            '<div class="anime-card-progress">' +
              '<div class="progress-bar progress-bar--sm"><div class="progress-fill" style="width:' + prog.barWidth + '%"></div></div>' +
              '<span class="ep-fraction">' + prog.watched + '/' + (prog.total !== null ? prog.total : 'Ongoing') + '</span>' +
            '</div>' +
            '<div class="star-rating-sm">' + stars + '</div>' +
          '</div>' +
        '</button>' +
      '</article>'
    );
  }).join('');
}

/* ── 4.5 Tab Counts ── */
function renderTabCounts() {
  var lib = state.library;
  document.getElementById('count-all').textContent       = lib.length;
  document.getElementById('count-watching').textContent  = lib.filter(function(a){ return a.status==='watching';  }).length;
  document.getElementById('count-completed').textContent = lib.filter(function(a){ return a.status==='completed'; }).length;
  document.getElementById('count-plan').textContent      = lib.filter(function(a){ return a.status==='plan';      }).length;
  document.getElementById('count-dropped').textContent   = lib.filter(function(a){ return a.status==='dropped';   }).length;
}

/* ── 4.6 Details Panel ── */
/**
 * Builds the full details view for one anime and injects it into #details-content.
 * @param {Object} anime
 */
function renderDetails(anime) {
  var prog   = getProgress(anime);
  var rating = (typeof anime.rating === 'number' && anime.rating >= 1) ? anime.rating : null;

  // Build 10 clickable & keyboard-accessible star buttons
  var starsHtml = '';
  for (var i = 1; i <= 10; i++) {
    var filled = rating !== null && i <= rating ? '★' : '☆';
    var isCurrent = i === rating ? 'true' : 'false';
    starsHtml += '<button type="button" class="rating-star" data-star="' + i + '" aria-pressed="' + isCurrent + '" aria-label="Rate ' + i + ' out of 10">' + filled + '</button>';
  }

  var html = (
    '<div class="details-layout">' +
      /* Sidebar */
      '<aside class="details-sidebar">' +
        '<div class="details-poster">' +
          buildPosterHtml(anime, 'poster-xl') +
          '<div class="status-badge status-' + anime.status + '">' + statusLabel(anime.status) + '</div>' +
        '</div>' +
        '<div class="details-quick-stats">' +
          '<div class="qs-row"><span class="qs-label">Episodes</span><span class="qs-value">' + (anime.totalEps !== null ? anime.totalEps : 'Unknown') + '</span></div>' +
          (anime.format ? '<div class="qs-row"><span class="qs-label">Format</span><span class="qs-value">' + escapeHtml(formatMediaFormat(anime.format)) + '</span></div>' : '') +
          (anime.releaseYear ? '<div class="qs-row"><span class="qs-label">Year</span><span class="qs-value">' + anime.releaseYear + '</span></div>' : '') +
          (anime.airingStatus ? '<div class="qs-row"><span class="qs-label">Air Status</span><span class="qs-value">' + escapeHtml(formatAiringStatus(anime.airingStatus)) + '</span></div>' : '') +
          '<div class="qs-row"><span class="qs-label">Status</span><span class="qs-value">' + statusLabel(anime.status) + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Genre</span><span class="qs-value">' + escapeHtml(anime.genre || '—') + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Rating</span><span class="qs-value">' + (rating !== null ? rating + '/10' : 'Unrated') + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Added</span><span class="qs-value">' + formatDate(anime.addedAt) + '</span></div>' +
        '</div>' +
        '<div class="details-actions">' +
          '<button class="btn-primary btn-block" id="details-edit-btn" data-id="' + anime.id + '">Edit Entry</button>' +
          '<button class="btn-secondary btn-block" id="details-delete-btn" data-id="' + anime.id + '">Delete</button>' +
        '</div>' +
      '</aside>' +

      /* Main panel */
      '<div class="details-main">' +
        '<p class="section-label">// ANIME DETAILS</p>' +
        '<h2 class="details-title">' + escapeHtml(anime.title) + '</h2>' +

        /* General — Episode Progress */
        '<div class="details-block">' +
          '<h3 class="details-block-title">Episode Progress</h3>' +
          '<div class="ep-tracker">' +
            '<div class="ep-display">' +
              '<span class="ep-big" id="detail-ep-current">' + anime.watchedEps + '</span>' +
              '<span class="ep-sep-big">/</span>' +
              '<span class="ep-total-big">' + formatTotalEps(anime) + '</span>' +
            '</div>' +
            '<div class="progress-bar progress-bar--lg">' +
              '<div class="progress-fill" id="detail-ep-bar" style="width:' + prog.barWidth + '%"></div>' +
            '</div>' +
            '<div class="ep-controls">' +
              '<button class="btn-secondary btn-sm" id="detail-ep-minus" data-id="' + anime.id + '">− Episode</button>' +
              '<span class="ep-pct" id="detail-ep-pct">' + prog.label + '</span>' +
              '<button class="btn-primary btn-sm" id="detail-ep-plus" data-id="' + anime.id + '">+ Episode</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* General — My Rating */
        '<div class="details-block">' +
          '<h3 class="details-block-title">My Rating</h3>' +
          '<div class="rating-widget">' +
            '<div class="rating-stars" id="detail-rating-stars" data-id="' + anime.id + '" data-selected="' + (rating !== null ? rating : 0) + '" role="group" aria-label="Rate this anime">' +
              starsHtml +
            '</div>' +
            '<span class="rating-label" id="detail-rating-label">' + (rating !== null ? rating + ' / 10' : 'Unrated') + '</span>' +
          '</div>' +
        '</div>' +

        /* Section 2 — My Review */
        '<div class="details-block">' +
          '<h3 class="details-block-title">My Review</h3>' +
          '<textarea class="review-textarea" id="detail-review" placeholder="Write your thoughts about this anime..." rows="5">' + escapeHtml(anime.review || '') + '</textarea>' +
          '<button class="btn-primary" id="detail-save-review" data-id="' + anime.id + '">Save Review</button>' +
        '</div>' +

        /* Section 3 — Favourite Quotes */
        buildDetailsQuotesSectionHtml(anime) +
      '</div>' +
    '</div>'
  );

  document.getElementById('details-content').innerHTML = html;

  // Wire up the detail-panel buttons (they are freshly created each render)
  wireDetailsEvents(anime.id);
}

var editingQuoteId = null;

/**
 * Builds the Favourite Quotes section HTML for the anime details page.
 * @param {Object} anime
 * @returns {string}
 */
function buildDetailsQuotesSectionHtml(anime) {
  var quotes = Array.isArray(anime.quotes) ? anime.quotes.slice() : [];
  quotes.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

  var editingQuote = null;
  if (editingQuoteId) {
    editingQuote = quotes.find(function(q) { return q.id === editingQuoteId; }) || null;
    if (!editingQuote) editingQuoteId = null;
  }

  var listHtml;
  if (quotes.length === 0) {
    listHtml =
      '<div class="quotes-empty">' +
        '<span class="quotes-empty-mark" aria-hidden="true">“</span>' +
        '<p>No favourite quotes saved yet.</p>' +
        '<p class="quotes-empty-sub">Capture memorable lines, speeches, or dialogue that stuck with you.</p>' +
      '</div>';
  } else {
    listHtml = '<div class="details-quotes-list" id="detail-quotes-list">' +
      quotes.map(function(q) {
        var metaParts = [];
        if (q.speaker) metaParts.push('<span class="quote-card-speaker">— ' + escapeHtml(q.speaker) + '</span>');
        if (q.episode !== null && q.episode !== undefined) {
          metaParts.push('<span class="tag quote-card-ep">EP ' + q.episode + '</span>');
        }
        return (
          '<article class="detail-quote-card' + (editingQuoteId === q.id ? ' is-editing' : '') + '" data-quote-id="' + escapeHtml(q.id) + '">' +
            '<span class="detail-quote-mark" aria-hidden="true">“</span>' +
            '<blockquote class="detail-quote-text">' + escapeHtml(q.text) + '</blockquote>' +
            '<div class="detail-quote-footer">' +
              '<div class="detail-quote-meta">' +
                (metaParts.length ? metaParts.join(' ') : '<span class="quote-card-speaker quote-card-speaker--muted">Unattributed</span>') +
                '<span class="detail-quote-date">' + formatDate(q.createdAt) + '</span>' +
              '</div>' +
              '<div class="detail-quote-actions">' +
                '<button type="button" class="btn-secondary btn-xs detail-quote-edit" data-quote-id="' + escapeHtml(q.id) + '">Edit</button>' +
                '<button type="button" class="btn-secondary btn-xs detail-quote-delete" data-quote-id="' + escapeHtml(q.id) + '">Delete</button>' +
              '</div>' +
            '</div>' +
          '</article>'
        );
      }).join('') +
    '</div>';
  }

  var legacyNotesHtml = '';
  if (anime.notes && anime.notes.trim() !== '') {
    legacyNotesHtml =
      '<details class="legacy-notes-box">' +
        '<summary class="legacy-notes-summary">Legacy Personal Notes (preserved)</summary>' +
        '<p class="legacy-notes-text">' + escapeHtml(anime.notes) + '</p>' +
      '</details>';
  }

  return (
    '<div class="details-block quotes-block">' +
      '<div class="quotes-block-header">' +
        '<h3 class="details-block-title">Favourite Quotes</h3>' +
        '<span class="quotes-count-badge">' + quotes.length + (quotes.length === 1 ? ' quote' : ' quotes') + '</span>' +
      '</div>' +
      '<form class="quote-composer" id="detail-quote-form" novalidate>' +
        '<div class="quote-composer-label">' + (editingQuote ? 'Editing Saved Quote' : 'Collect a Memorable Line') + '</div>' +
        '<div class="form-group">' +
          '<label class="form-label" for="quote-text-input">Quote <span class="form-required">*</span></label>' +
          '<textarea class="review-textarea quote-textarea" id="quote-text-input" rows="3" placeholder="e.g. If you don\'t take risks, you can\'t create a future.">' + (editingQuote ? escapeHtml(editingQuote.text) : '') + '</textarea>' +
          '<span class="form-error" id="error-quote-text"></span>' +
        '</div>' +
        '<div class="form-row quote-meta-row">' +
          '<div class="form-group">' +
            '<label class="form-label" for="quote-speaker-input">Character / Speaker <span class="form-hint">(optional)</span></label>' +
            '<input class="form-input" type="text" id="quote-speaker-input" placeholder="e.g. Monkey D. Luffy" value="' + (editingQuote ? escapeHtml(editingQuote.speaker || '') : '') + '" />' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="quote-episode-input">Episode <span class="form-hint">(optional)</span></label>' +
            '<input class="form-input" type="number" id="quote-episode-input" min="1" max="9999" placeholder="e.g. 12" value="' + (editingQuote && editingQuote.episode !== null ? editingQuote.episode : '') + '" />' +
            '<span class="form-error" id="error-quote-episode"></span>' +
          '</div>' +
        '</div>' +
        '<div class="quote-composer-actions">' +
          '<button type="submit" class="btn-primary" id="detail-save-quote">' + (editingQuote ? 'Update Quote' : '+ Save Quote') + '</button>' +
          (editingQuote ? '<button type="button" class="btn-secondary" id="quote-cancel-edit">Cancel Edit</button>' : '') +
        '</div>' +
      '</form>' +
      listHtml +
      legacyNotesHtml +
    '</div>'
  );
}

/* ── 4.7 Journal ── */

var QUOTE_PANEL_VARIANTS = ['dramatic', 'bubble', 'split', 'inverted'];

function getLatestQuoteTimestamp(anime) {
  if (!Array.isArray(anime.quotes) || anime.quotes.length === 0) return 0;
  return anime.quotes.reduce(function(max, q) {
    return Math.max(max, q.createdAt || 0);
  }, 0);
}

/**
 * Builds one manga-styled quote panel for the Journal.
 * Cycles through 4 editorial monochrome compositions for visual variety.
 * @param {Object} quote
 * @param {Object} anime
 * @param {number} globalIdx
 * @returns {string}
 */
function buildJournalQuotePanel(quote, anime, globalIdx) {
  var variant = QUOTE_PANEL_VARIANTS[globalIdx % QUOTE_PANEL_VARIANTS.length];
  var panelId = 'journal-quote-' + escapeHtml(quote.id);
  var speakerHtml = quote.speaker
    ? '<span class="jq-speaker">— ' + escapeHtml(quote.speaker) + '</span>'
    : '<span class="jq-speaker jq-speaker--muted">— Memorable Line</span>';
  var episodeHtml = (quote.episode !== null && quote.episode !== undefined)
    ? '<span class="jq-episode">EP ' + quote.episode + '</span>'
    : '';
  var animeTitleHtml =
    '<button type="button" class="jq-anime-title journal-view-btn" data-id="' + anime.id + '" title="Open anime details">' +
      escapeHtml(anime.title) +
    '</button>';
  var metaInlineHtml =
    '<span class="jq-meta-group">' +
      animeTitleHtml +
      (episodeHtml ? '<span class="jq-meta-sep" aria-hidden="true">·</span>' + episodeHtml : '') +
    '</span>';

  if (variant === 'bubble') {
    return (
      '<figure class="quote-panel quote-panel--bubble" id="' + panelId + '">' +
        '<div class="jq-bubble-box">' +
          '<span class="jq-mark" aria-hidden="true">“</span>' +
          '<blockquote class="jq-text">' + escapeHtml(quote.text) + '</blockquote>' +
          '<span class="jq-bubble-tail" aria-hidden="true"></span>' +
        '</div>' +
        '<figcaption class="jq-attribution">' +
          speakerHtml +
          metaInlineHtml +
        '</figcaption>' +
      '</figure>'
    );
  }

  if (variant === 'split') {
    return (
      '<figure class="quote-panel quote-panel--split" id="' + panelId + '">' +
        '<div class="jq-split-main">' +
          '<span class="jq-mark" aria-hidden="true">“</span>' +
          '<blockquote class="jq-text">' + escapeHtml(quote.text) + '</blockquote>' +
        '</div>' +
        '<figcaption class="jq-split-aside">' +
          '<div class="jq-stamp">QUOTE // ' + String(globalIdx + 1).padStart(2, '0') + '</div>' +
          speakerHtml +
          '<div class="jq-meta-stack">' + animeTitleHtml + episodeHtml + '</div>' +
        '</figcaption>' +
      '</figure>'
    );
  }

  if (variant === 'inverted') {
    return (
      '<figure class="quote-panel quote-panel--inverted" id="' + panelId + '">' +
        '<span class="jq-mark" aria-hidden="true">“</span>' +
        '<blockquote class="jq-text">' + escapeHtml(quote.text) + '</blockquote>' +
        '<figcaption class="jq-attribution">' +
          speakerHtml +
          metaInlineHtml +
        '</figcaption>' +
      '</figure>'
    );
  }

  // Default: 'dramatic' full-width manga panel
  return (
    '<figure class="quote-panel quote-panel--dramatic" id="' + panelId + '">' +
      '<span class="jq-mark" aria-hidden="true">“</span>' +
      '<blockquote class="jq-text">' + escapeHtml(quote.text) + '</blockquote>' +
      '<figcaption class="jq-attribution">' +
        speakerHtml +
        metaInlineHtml +
      '</figcaption>' +
    '</figure>'
  );
}

function renderJournal() {
  var feed    = document.getElementById('journal-feed');
  var tocList = document.getElementById('journal-toc-list');

  var withReview = state.library.filter(function(a) { return a.review && a.review.trim() !== ''; });
  var withQuotes = state.library.filter(function(a) { return Array.isArray(a.quotes) && a.quotes.length > 0; });
  var withEither = state.library.filter(function(a) {
    return (a.review && a.review.trim() !== '') || (Array.isArray(a.quotes) && a.quotes.length > 0);
  });

  // Update filter tab counts
  var elAll = document.getElementById('jcount-all');
  var elRev = document.getElementById('jcount-reviews');
  var elQuo = document.getElementById('jcount-quotes');
  if (elAll) elAll.textContent = withEither.length;
  if (elRev) elRev.textContent = withReview.length;
  if (elQuo) elQuo.textContent = withQuotes.length;

  var filter = state.journalFilter || 'all';
  var entries = filter === 'reviews' ? withReview : (filter === 'quotes' ? withQuotes : withEither);

  if (entries.length === 0) {
    var emptyMsg;
    var emptyCta;
    if (filter === 'reviews') {
      emptyMsg = 'No reviews written yet.<br><em>Open any anime\'s Details page and write a review in "My Review".</em>';
      emptyCta = '<button type="button" class="btn-secondary btn-sm" data-nav="library">Browse Library</button>';
    } else if (filter === 'quotes') {
      emptyMsg = 'No favourite quotes saved yet.<br><em>Open any anime\'s Details page and save memorable lines under "Favourite Quotes".</em>';
      emptyCta = '<button type="button" class="btn-secondary btn-sm" data-nav="library">Browse Library</button>';
    } else {
      emptyMsg = 'Your journal archive is empty.<br><em>Write a review or save a favourite quote on any anime\'s Details page to start your archive.</em>';
      emptyCta = state.library.length === 0
        ? '<button type="button" class="btn-primary btn-sm empty-add-btn">+ Add Anime</button> <button type="button" class="btn-secondary btn-sm load-demo-btn">Load Demo Data</button>'
        : '<button type="button" class="btn-secondary btn-sm" data-nav="library">Browse Library</button>';
    }
    feed.innerHTML    = '<div class="empty-state"><p>' + emptyMsg + '</p><div class="empty-state-actions">' + emptyCta + '</div></div>';
    tocList.innerHTML = '';
    return;
  }

  // Quotes-only tab: render a pure quote-focused gallery without anime posters or headers
  if (filter === 'quotes') {
    var allQuotes = [];
    withQuotes.forEach(function(anime) {
      anime.quotes.forEach(function(q) {
        allQuotes.push({ quote: q, anime: anime });
      });
    });
    allQuotes.sort(function(a, b) {
      return (b.quote.createdAt || 0) - (a.quote.createdAt || 0);
    });

    tocList.innerHTML = allQuotes.map(function(item, idx) {
      var num = String(idx + 1).padStart(2, '0');
      var label = item.quote.speaker
        ? item.quote.speaker
        : (item.quote.text.length > 26 ? item.quote.text.slice(0, 26) + '…' : item.quote.text);
      var badge = (item.quote.episode !== null && item.quote.episode !== undefined)
        ? 'EP ' + item.quote.episode
        : 'Q';
      return (
        '<li class="toc-item" data-scroll-target="journal-quote-' + escapeHtml(item.quote.id) + '">' +
          '<button type="button" class="toc-btn">' +
            '<span class="toc-num">' + num + '</span>' +
            '<span class="toc-label">' + escapeHtml(label) + '</span>' +
            '<span class="toc-badge">' + badge + '</span>' +
          '</button>' +
        '</li>'
      );
    }).join('');

    var standalonePanels = allQuotes.map(function(item, idx) {
      return buildJournalQuotePanel(item.quote, item.anime, idx);
    }).join('');

    feed.innerHTML = '<div class="journal-quotes-grid journal-quotes-standalone">' + standalonePanels + '</div>';
    return;
  }

  // Sort by latest activity (review update, quote creation, or addedAt)
  entries = entries.slice().sort(function(a, b) {
    var aLatest = Math.max(a.updatedAt || 0, a.addedAt || 0, getLatestQuoteTimestamp(a));
    var bLatest = Math.max(b.updatedAt || 0, b.addedAt || 0, getLatestQuoteTimestamp(b));
    return bLatest - aLatest;
  });

  tocList.innerHTML = entries.map(function(anime, idx) {
    var num = String(idx + 1).padStart(2, '0');
    var qCount = Array.isArray(anime.quotes) ? anime.quotes.length : 0;
    var hasRev = Boolean(anime.review && anime.review.trim() !== '');
    var badge = (hasRev && qCount > 0) ? 'R+' + qCount + 'Q' : (hasRev ? 'R' : qCount + 'Q');
    var sortedQ = qCount > 0 ? anime.quotes.slice().sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }) : [];
    var targetId = hasRev
      ? 'journal-entry-' + anime.id
      : ('journal-quote-' + escapeHtml(sortedQ[0].id));
    return (
      '<li class="toc-item" data-scroll-target="' + targetId + '">' +
        '<button type="button" class="toc-btn">' +
          '<span class="toc-num">' + num + '</span>' +
          '<span class="toc-label">' + escapeHtml(anime.title) + '</span>' +
          '<span class="toc-badge">' + badge + '</span>' +
        '</button>' +
      '</li>'
    );
  }).join('');

  var globalQuoteIdx = 0;

  feed.innerHTML = entries.map(function(anime, idx) {
    var num        = String(idx + 1).padStart(2, '0');
    var stars      = buildStarSummary(anime.rating);
    var entryDate  = Math.max(anime.updatedAt || 0, anime.addedAt || 0, getLatestQuoteTimestamp(anime));
    var hasReview  = Boolean(anime.review && anime.review.trim() !== '');
    var quotes     = Array.isArray(anime.quotes) ? anime.quotes.slice() : [];
    quotes.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    var showReview = hasReview && (filter === 'all' || filter === 'reviews');
    var showQuotes = quotes.length > 0 && (filter === 'all' || filter === 'quotes');

    // Quote-only entries in "All" tab: render pure quote cards without anime poster or header
    if (!showReview && showQuotes) {
      var purePanels = quotes.map(function(q) {
        var html = buildJournalQuotePanel(q, anime, globalQuoteIdx);
        globalQuoteIdx++;
        return html;
      }).join('');
      return '<div class="journal-quotes-grid journal-quotes-standalone">' + purePanels + '</div>';
    }

    var reviewHtml = '';
    if (showReview) {
      reviewHtml =
        '<section class="journal-review-section">' +
          '<div class="journal-sub-label">// MY REVIEW</div>' +
          '<div class="journal-body">' +
            '<p>' + escapeHtml(anime.review).replace(/\n/g, '<br>') + '</p>' +
          '</div>' +
        '</section>';
    }

    var quotesHtml = '';
    if (showQuotes) {
      var panelsHtml = quotes.map(function(q) {
        var html = buildJournalQuotePanel(q, anime, globalQuoteIdx);
        globalQuoteIdx++;
        return html;
      }).join('');

      quotesHtml =
        '<section class="journal-quotes-section">' +
          '<div class="journal-sub-label">// FAVOURITE QUOTES (' + quotes.length + ')</div>' +
          '<div class="journal-quotes-grid">' + panelsHtml + '</div>' +
        '</section>';
    }

    return (
      '<article class="journal-entry" id="journal-entry-' + anime.id + '">' +
        '<div class="journal-entry-header">' +
          '<div class="journal-poster-wrap">' + buildPosterHtml(anime, 'poster-sm') + '</div>' +
          '<div class="journal-header-main">' +
            '<div class="journal-meta">' +
              '<span class="journal-num">[ ' + num + ' ]</span>' +
              '<div>' +
                '<h3 class="journal-entry-title">' + escapeHtml(anime.title) + '</h3>' +
                '<span class="journal-date">' + formatDate(entryDate) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="journal-rating">' + stars + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="journal-tags">' +
          '<span class="tag status-tag-' + anime.status + '">' + statusLabel(anime.status) + '</span>' +
          (anime.genre ? '<span class="tag">' + escapeHtml(anime.genre) + '</span>' : '') +
          '<span class="tag">EP ' + anime.watchedEps + '/' + formatTotalEps(anime) + '</span>' +
        '</div>' +
        reviewHtml +
        quotesHtml +
        '<div class="journal-footer">' +
          '<span class="journal-status">' +
            (hasReview ? 'Review ✓' : 'No review') + ' · ' + quotes.length + (quotes.length === 1 ? ' Quote' : ' Quotes') +
          '</span>' +
          '<div class="journal-actions">' +
            '<button class="btn-secondary btn-sm journal-view-btn" data-id="' + anime.id + '">View Details</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }).join('');
}


/* ═══════════════════════════════════════════════════════════
   5. EVENTS — user interaction
═══════════════════════════════════════════════════════════ */

/* ── 5.1 Navigation ── */

var VALID_SECTIONS = ['dashboard', 'library', 'details', 'journal', 'insights'];

/**
 * Shows the requested section and hides all others.
 * Updates the active nav link and synchronizes the URL hash.
 * @param {string} sectionId
 * @param {boolean} [updateHash=true]
 */
function navigateTo(sectionId, updateHash, detailId) {
  if (VALID_SECTIONS.indexOf(sectionId) === -1) {
    sectionId = 'dashboard';
  }
  if (sectionId !== 'details') editingQuoteId = null;

  if (sectionId === 'details' && detailId) {
    state.currentAnimeId = detailId;
  }

  // Hide Anime Details nav link unless details route is active
  var detailsNavLink = document.querySelector('.nav-link[data-section="details"]');
  if (detailsNavLink) {
    detailsNavLink.style.display = sectionId === 'details' ? '' : 'none';
    if (sectionId === 'details' && state.currentAnimeId) {
      detailsNavLink.setAttribute('href', '#details/' + encodeURIComponent(state.currentAnimeId));
    }
  }

  // Ensure #details has a helpful message if opened directly with no anime selected
  if (sectionId === 'details' && !state.currentAnimeId) {
    document.getElementById('details-content').innerHTML =
      '<div class="empty-state">' +
        '<p>No anime selected.<br><em>Choose an anime from your library to view its details.</em></p>' +
        '<button class="btn-primary btn-sm" data-nav="library">Browse Library</button>' +
      '</div>';
  }

  document.querySelectorAll('.app-section').forEach(function(s) { s.classList.remove('active'); });
  var target = document.getElementById(sectionId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-link').forEach(function(link) {
    link.classList.toggle('active', link.dataset.section === sectionId);
  });

  var targetHash = (sectionId === 'details' && state.currentAnimeId)
    ? '#details/' + encodeURIComponent(state.currentAnimeId)
    : '#' + sectionId;

  if (updateHash !== false && window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }

  document.getElementById('main-nav').classList.remove('open');
  var navToggleBtn = document.getElementById('nav-toggle');
  if (navToggleBtn) navToggleBtn.setAttribute('aria-expanded', 'false');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

/**
 * Reads the current URL hash and activates the matching section.
 * Routes: #dashboard, #library, #journal, #details/<id>
 */
function syncFromHash() {
  var hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (!hash) {
    navigateTo('dashboard', true);
    return;
  }

  if (hash === 'details' || hash === 'details/') {
    state.currentAnimeId = null;
    document.getElementById('details-content').innerHTML = '';
    navigateTo('library', true);
    return;
  }

  if (hash.indexOf('details/') === 0) {
    var rawId = hash.slice('details/'.length);
    var animeId = rawId;
    try {
      animeId = decodeURIComponent(rawId);
    } catch (e) {
      animeId = rawId;
    }
    var anime = findAnimeById(animeId);
    if (!anime) {
      state.currentAnimeId = null;
      document.getElementById('details-content').innerHTML = '';
      showToast('Anime not found.', 'warning');
      navigateTo('library', true);
      return;
    }
    state.currentAnimeId = anime.id;
    renderDetails(anime);
    navigateTo('details', false, anime.id);
    return;
  }

  var targetSection = (hash === 'dashboard' || hash === 'library' || hash === 'journal' || hash === 'insights') ? hash : 'dashboard';
  if (targetSection !== hash) {
    navigateTo('dashboard', true);
    return;
  }
  navigateTo(targetSection, false);
}

window.addEventListener('hashchange', syncFromHash);

// Nav link clicks
document.querySelectorAll('.nav-link').forEach(function(link) {
  link.addEventListener('click', function(e) {
    e.preventDefault();
    navigateTo(this.dataset.section);
  });
});

// data-nav buttons (Browse Library, Open Journal, Back buttons)
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-nav]');
  if (el) navigateTo(el.dataset.nav);
});

// Mobile hamburger
document.getElementById('nav-toggle').addEventListener('click', function() {
  var isOpen = document.getElementById('main-nav').classList.toggle('open');
  this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});


/* ── 5.2 Add / Edit Modal ── */

/** Opens the modal in "Add" mode (blank form). */
function openAddModal() {
  document.getElementById('modal-title').textContent   = 'Add Anime';
  document.getElementById('form-submit').textContent   = 'Save Anime';
  document.getElementById('anime-form').reset();
  document.getElementById('form-id').value = '';
  // Reset unknown-episodes checkbox and re-enable the input
  var unknownCb  = document.getElementById('form-episodes-unknown');
  var episodesEl = document.getElementById('form-episodes');
  unknownCb.checked      = false;
  episodesEl.disabled    = false;
  episodesEl.required    = true;
  clearFormErrors();
  showModal('modal-overlay');
}

/**
 * Opens the modal pre-filled for editing an existing anime.
 * @param {string} animeId
 */
function openEditModal(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;

  var unknownCb  = document.getElementById('form-episodes-unknown');
  var episodesEl = document.getElementById('form-episodes');
  var isUnknown  = anime.totalEps === null;

  document.getElementById('modal-title').textContent = 'Edit Anime';
  document.getElementById('form-submit').textContent = 'Save Changes';
  document.getElementById('form-id').value           = anime.id;
  document.getElementById('form-title').value        = anime.title;
  document.getElementById('form-poster').value       = anime.posterUrl || '';
  unknownCb.checked      = isUnknown;
  episodesEl.disabled    = isUnknown;
  episodesEl.required    = !isUnknown;
  episodesEl.value       = isUnknown ? '' : anime.totalEps;
  document.getElementById('form-watched').value      = anime.watchedEps;
  document.getElementById('form-status').value       = anime.status;
  document.getElementById('form-genre').value        = anime.genre || '';
  clearFormErrors();
  showModal('modal-overlay');
}

var lastFocusedBeforeModal = null;

function getFocusableInModal(modalEl) {
  return Array.prototype.slice.call(
    modalEl.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  ).filter(function(el) {
    return el.offsetParent !== null;
  });
}

function showModal(id) {
  var modalEl = document.getElementById(id);
  if (!modalEl) return;
  if (!document.querySelector('.modal-overlay.modal-visible')) {
    lastFocusedBeforeModal = document.activeElement;
  }
  modalEl.classList.add('modal-visible');
  document.body.classList.add('modal-open');
  setTimeout(function() {
    var focusables = getFocusableInModal(modalEl);
    if (focusables.length > 0) focusables[0].focus();
  }, 20);
}

function hideModal(id) {
  var modalEl = document.getElementById(id);
  if (modalEl) modalEl.classList.remove('modal-visible');
  // Only remove scroll-lock when no other modal is still open
  var anyVisible = document.querySelector('.modal-overlay.modal-visible');
  if (!anyVisible) {
    document.body.classList.remove('modal-open');
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
      lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
  }
}

function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(function(el) { el.textContent = ''; });
  document.querySelectorAll('.form-input').forEach(function(el) { el.classList.remove('input-error'); });
}

/**
 * Validates the add/edit form.
 * Returns true if valid, false if there are errors.
 * Shows inline error messages for invalid fields.
 */
function validateForm() {
  var valid      = true;
  var currentId  = document.getElementById('form-id').value;
  var title      = document.getElementById('form-title').value.trim();
  var unknownEps = document.getElementById('form-episodes-unknown').checked;
  var episodes   = parseInt(document.getElementById('form-episodes').value, 10);
  var rawWatched = document.getElementById('form-watched').value.trim();
  var watched    = rawWatched === '' ? 0 : parseInt(rawWatched, 10);
  var status     = document.getElementById('form-status').value;
  var poster     = document.getElementById('form-poster').value.trim();

  clearFormErrors();

  if (!title) {
    showFieldError('form-title', 'error-title', 'Title is required.');
    valid = false;
  } else {
    var duplicate = state.library.some(function(a) {
      return a.id !== currentId && a.title.toLowerCase() === title.toLowerCase();
    });
    if (duplicate) {
      showFieldError('form-title', 'error-title', 'An anime with this title already exists.');
      valid = false;
    }
  }

  if (!status) {
    showFieldError('form-status', 'error-status', 'Please select a watching status.');
    valid = false;
  }

  if (!unknownEps) {
    // Only validate episode count when total is known
    if (!episodes || isNaN(episodes) || episodes < 1) {
      showFieldError('form-episodes', 'error-episodes', 'Enter at least 1 total episode, or tick "Unknown / Ongoing".');
      valid = false;
    } else if (episodes > 9999) {
      showFieldError('form-episodes', 'error-episodes', 'Maximum 9999 episodes allowed.');
      valid = false;
    }
  }

  if (isNaN(watched) || watched < 0) {
    showFieldError('form-watched', 'error-watched', 'Watched episodes cannot be negative.');
    valid = false;
  } else if (!unknownEps && !isNaN(episodes) && watched > episodes) {
    showFieldError('form-watched', 'error-watched', 'Cannot exceed total episodes (' + episodes + ').');
    valid = false;
  }

  // Enforce consistency between episode progress and manually selected status
  if (status === 'plan' && !isNaN(watched) && watched > 0) {
    showFieldError('form-watched', 'error-watched', 'Plan to Watch entries must have 0 watched episodes.');
    valid = false;
  } else if (status === 'completed' && !unknownEps && !isNaN(episodes) && !isNaN(watched) && watched < episodes) {
    showFieldError('form-watched', 'error-watched', 'Completed anime must have all ' + episodes + ' episodes watched.');
    valid = false;
  } else if (status === 'watching' && !unknownEps && !isNaN(episodes) && !isNaN(watched) && watched === episodes) {
    showFieldError('form-status', 'error-status', 'All episodes watched — select Completed instead.');
    valid = false;
  }

  if (poster && !isValidUrl(poster)) {
    showFieldError('form-poster', 'error-poster', 'Enter a valid http:// or https:// URL or leave blank.');
    valid = false;
  }

  return valid;
}

function showFieldError(inputId, errorId, message) {
  document.getElementById(inputId).classList.add('input-error');
  document.getElementById(errorId).textContent = message;
}

/** Validates poster URL using the URL constructor; allows only HTTP and HTTPS. */
function isValidUrl(str) {
  try {
    var parsed = new URL(str);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Hero "+ Add Anime" button -> opens AniList search modal
document.getElementById('hero-add-btn').addEventListener('click', openSearchModal);

// Library "+ Add Anime" button -> opens AniList search modal
document.getElementById('library-add-btn').addEventListener('click', openSearchModal);

// "Unknown / Ongoing" checkbox — toggle episode input requirement
document.getElementById('form-episodes-unknown').addEventListener('change', function() {
  var episodesEl = document.getElementById('form-episodes');
  episodesEl.disabled = this.checked;
  episodesEl.required = !this.checked;
  if (this.checked) episodesEl.value = '';
});

// Auto-sync watched episodes when status is set to Completed (known total) or Plan to Watch
document.getElementById('form-status').addEventListener('change', function() {
  var unknownEps = document.getElementById('form-episodes-unknown').checked;
  var totalEps = parseInt(document.getElementById('form-episodes').value, 10);
  var watchedEl = document.getElementById('form-watched');
  if (this.value === 'completed' && !unknownEps && !isNaN(totalEps) && totalEps > 0) {
    watchedEl.value = String(totalEps);
    document.getElementById('error-watched').textContent = '';
    watchedEl.classList.remove('input-error');
  } else if (this.value === 'plan') {
    watchedEl.value = '0';
  }
});

// Clamp watched episodes to [0, total] on change/blur with inline feedback
function clampManualWatchedInput() {
  var watchedEl = document.getElementById('form-watched');
  var errEl = document.getElementById('error-watched');
  var raw = watchedEl.value.trim();
  if (raw === '') return;
  var val = Math.floor(Number(raw));
  var unknownEps = document.getElementById('form-episodes-unknown').checked;
  var totalEps = parseInt(document.getElementById('form-episodes').value, 10);

  if (isNaN(val) || val < 0) {
    watchedEl.value = '0';
    errEl.textContent = 'Watched episodes clamped to 0.';
  } else if (!unknownEps && !isNaN(totalEps) && totalEps > 0 && val > totalEps) {
    watchedEl.value = String(totalEps);
    errEl.textContent = 'Clamped to maximum episodes (' + totalEps + ').';
  } else if (String(val) !== raw) {
    watchedEl.value = String(val);
  }
}
document.getElementById('form-watched').addEventListener('change', clampManualWatchedInput);
document.getElementById('form-watched').addEventListener('blur', clampManualWatchedInput);

// Modal close / cancel
document.getElementById('modal-close').addEventListener('click', function() { hideModal('modal-overlay'); });
document.getElementById('form-cancel').addEventListener('click', function() { hideModal('modal-overlay'); });

// Click outside modal panel to close
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) hideModal('modal-overlay');
});

// Form submit — Add or Edit
document.getElementById('anime-form').addEventListener('submit', function(e) {
  e.preventDefault();
  if (!validateForm()) return;

  var id       = document.getElementById('form-id').value;
  var title    = document.getElementById('form-title').value.trim();
  var poster   = document.getElementById('form-poster').value.trim();
  var unknownEps = document.getElementById('form-episodes-unknown').checked;
  var totalEps = unknownEps ? null : parseInt(document.getElementById('form-episodes').value, 10);
  var watched  = parseInt(document.getElementById('form-watched').value, 10) || 0;
  var status   = document.getElementById('form-status').value;
  var genre    = document.getElementById('form-genre').value.trim();

  // Clamp watched to totalEps only when totalEps is known
  if (totalEps !== null) watched = Math.min(watched, totalEps);

  if (id) {
    // EDIT — update existing entry
    var anime = findAnimeById(id);
    if (anime) {
      var prevWatched = anime.watchedEps || 0;
      var prevStatus  = anime.status;
      anime.title         = title;
      anime.posterUrl     = poster;
      anime.totalEps      = totalEps;
      anime.watchedEps    = watched;
      anime.status        = status;
      anime.genre         = genre;
      anime.updatedAt     = Date.now();
      // User manually chose the status — clear any auto-complete flag
      anime.autoCompleted = false;

      if (watched > prevWatched) {
        recordWatchActivity(anime, prevWatched, watched);
      }
      if (prevStatus !== 'completed' && status === 'completed') {
        recordCompletionEvent(anime);
      }
    }
  } else {
    // ADD — create new manual entry
    var now = Date.now();
    state.library.push({
      id:            generateId(),
      anilistId:     null,
      title:         title,
      posterUrl:     poster,
      totalEps:      totalEps,
      watchedEps:    watched,
      status:        status,
      format:        '',
      releaseYear:   null,
      airingStatus:  '',
      genre:         genre,
      rating:        null,
      review:        '',
      notes:         '',
      addedAt:       now,
      updatedAt:     now,
      autoCompleted: false,
      quotes:        []
    });
  }

  hideModal('modal-overlay');
  stateCommit();
});


/* ── 5.3 Delete Modal (Anime & Quotes) ── */

var pendingDeleteId    = null; // holds id of anime awaiting deletion
var pendingDeleteQuote = null; // holds { animeId, quoteId } when deleting a quote

function openDeleteConfirm(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;
  pendingDeleteId    = animeId;
  pendingDeleteQuote = null;
  document.getElementById('confirm-title').textContent = 'Delete Anime';
  document.getElementById('confirm-message').innerHTML =
    'Remove <strong>' + escapeHtml(anime.title) + '</strong> from your library? This cannot be undone.';
  showModal('confirm-overlay');
}

function openDeleteQuoteConfirm(animeId, quoteId) {
  var anime = findAnimeById(animeId);
  if (!anime || !Array.isArray(anime.quotes)) return;
  var quote = anime.quotes.find(function(q) { return q.id === quoteId; });
  if (!quote) return;
  pendingDeleteId    = null;
  pendingDeleteQuote = { animeId: animeId, quoteId: quoteId };
  document.getElementById('confirm-title').textContent = 'Delete Quote';
  var preview = quote.text.length > 60 ? quote.text.slice(0, 60) + '…' : quote.text;
  document.getElementById('confirm-message').innerHTML =
    'Remove quote "<strong>' + escapeHtml(preview) + '</strong>" from ' + escapeHtml(anime.title) + '?';
  showModal('confirm-overlay');
}

document.getElementById('confirm-close').addEventListener('click', function() {
  pendingDeleteId = null;
  pendingDeleteQuote = null;
  hideModal('confirm-overlay');
});
document.getElementById('confirm-cancel').addEventListener('click', function() {
  pendingDeleteId = null;
  pendingDeleteQuote = null;
  hideModal('confirm-overlay');
});

document.getElementById('confirm-overlay').addEventListener('click', function(e) {
  if (e.target === this) {
    pendingDeleteId = null;
    pendingDeleteQuote = null;
    hideModal('confirm-overlay');
  }
});

document.getElementById('confirm-delete').addEventListener('click', function() {
  if (pendingDeleteQuote) {
    var targetAnime = findAnimeById(pendingDeleteQuote.animeId);
    var targetQuoteId = pendingDeleteQuote.quoteId;
    pendingDeleteQuote = null;
    hideModal('confirm-overlay');
    if (targetAnime && Array.isArray(targetAnime.quotes)) {
      targetAnime.quotes = targetAnime.quotes.filter(function(q) { return q.id !== targetQuoteId; });
      if (editingQuoteId === targetQuoteId) editingQuoteId = null;
      stateCommit();
    }
    return;
  }

  if (!pendingDeleteId) return;
  // Remove the anime from the array
  state.library = state.library.filter(function(a) { return a.id !== pendingDeleteId; });
  if (state.currentAnimeId === pendingDeleteId) {
    state.currentAnimeId = null;
    document.getElementById('details-content').innerHTML = '';
  }
  pendingDeleteId = null;
  hideModal('confirm-overlay');
  stateCommit();
  navigateTo('library');
});


/* ── 5.4 Library — search, filter, tabs ── */

document.getElementById('search-input').addEventListener('input', function() {
  state.searchQuery = this.value.trim();
  renderLibrary();
});

document.getElementById('status-filter').addEventListener('change', function() {
  state.statusFilter = this.value;
  // Sync tab to match dropdown
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === state.statusFilter ||
      (state.statusFilter === 'all' && btn.dataset.tab === 'all'));
  });
  state.activeTab = state.statusFilter;
  renderLibrary();
});

document.getElementById('sort-select').addEventListener('change', function() {
  state.sortBy = this.value;
  renderLibrary();
});

// Status tabs
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    state.activeTab  = this.dataset.tab;
    state.statusFilter = this.dataset.tab; // keep dropdown in sync
    document.getElementById('status-filter').value = this.dataset.tab;
    renderLibrary();
  });
});


/* ── 5.5 Library — click card to open Details ── */

// Delegated listener on the grid (cards & empty-state actions are dynamically rendered)
document.getElementById('anime-grid').addEventListener('click', function(e) {
  if (e.target.closest('.empty-add-btn')) {
    openSearchModal();
    return;
  }
  if (e.target.closest('.empty-reset-btn')) {
    state.searchQuery  = '';
    state.activeTab    = 'all';
    state.statusFilter = 'all';
    document.getElementById('search-input').value  = '';
    document.getElementById('status-filter').value = 'all';
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.tab === 'all');
    });
    renderLibrary();
    return;
  }
  var card = e.target.closest('.anime-card');
  if (!card) return;
  var id = card.dataset.id;
  var anime = findAnimeById(id);
  if (!anime) return;
  state.currentAnimeId = id;
  renderDetails(anime);
  navigateTo('details', true, id);
});

// Close open modals with Escape key & trap Tab inside visible modal
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    // Use closeSearchModal so debounce/abort cleanup always runs
    closeSearchModal();
    hideModal('modal-overlay');
    hideModal('confirm-overlay');
    pendingImportEntries = null;
    hideModal('import-overlay');
    return;
  }
  if (e.key === 'Tab') {
    var activeModal = document.querySelector('.modal-overlay.modal-visible');
    if (!activeModal) return;
    var focusables = getFocusableInModal(activeModal);
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});


/* ── 5.6 Dashboard — quick + EP button ── */

// Delegated on the watching list (dynamically rendered)
document.getElementById('dashboard-watching').addEventListener('click', function(e) {
  var btn = e.target.closest('.dash-ep-btn');
  if (!btn) return;
  var id = btn.dataset.id;
  incrementEpisode(id);
});

// Delegated on completed list — click to open details
document.getElementById('dashboard-completed').addEventListener('click', function(e) {
  var item = e.target.closest('.completed-item');
  if (!item) return;
  var id = item.dataset.id;
  var anime = findAnimeById(id);
  if (!anime) return;
  state.currentAnimeId = id;
  renderDetails(anime);
  navigateTo('details', true, id);
});


/* ── 5.7 Details panel — wired after each render ── */

/**
 * Attaches event listeners to the freshly-rendered details panel buttons.
 * Called by renderDetails() every time the panel is rebuilt.
 * @param {string} animeId
 */
function wireDetailsEvents(animeId) {

  // Edit button
  document.getElementById('details-edit-btn').addEventListener('click', function() {
    openEditModal(animeId);
  });

  // Delete button
  document.getElementById('details-delete-btn').addEventListener('click', function() {
    openDeleteConfirm(animeId);
  });

  // + Episode
  document.getElementById('detail-ep-plus').addEventListener('click', function() {
    incrementEpisode(animeId);
  });

  // − Episode
  document.getElementById('detail-ep-minus').addEventListener('click', function() {
    decrementEpisode(animeId);
  });

  // Save review (query freshly rendered button after stateCommit)
  document.getElementById('detail-save-review').addEventListener('click', function() {
    var anime = findAnimeById(animeId);
    if (!anime) return;
    anime.review    = document.getElementById('detail-review').value;
    anime.updatedAt = Date.now();
    stateCommit();
    var freshBtn = document.getElementById('detail-save-review');
    if (freshBtn) flashSaved(freshBtn, 'Saved!');
  });

  // Favourite Quotes — Add / Update quote form
  var quoteForm = document.getElementById('detail-quote-form');
  if (quoteForm) {
    quoteForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var anime = findAnimeById(animeId);
      if (!anime) return;
      if (!Array.isArray(anime.quotes)) anime.quotes = [];

      var textEl    = document.getElementById('quote-text-input');
      var speakerEl = document.getElementById('quote-speaker-input');
      var epEl      = document.getElementById('quote-episode-input');
      var errText   = document.getElementById('error-quote-text');
      var errEp     = document.getElementById('error-quote-episode');

      errText.textContent = '';
      errEp.textContent   = '';
      textEl.classList.remove('input-error');
      epEl.classList.remove('input-error');

      var text    = textEl.value.trim();
      var speaker = speakerEl.value.trim();
      var rawEp   = epEl.value.trim();
      var episode = null;
      var valid   = true;

      if (!text) {
        errText.textContent = 'Quote text is required.';
        textEl.classList.add('input-error');
        valid = false;
      }

      if (rawEp !== '') {
        // Strict: accept only positive whole numbers 1–9999 (reject 12.5, 12abc, etc.)
        if (!/^\d+$/.test(rawEp)) {
          errEp.textContent = 'Episode must be a whole number (1–9999).';
          epEl.classList.add('input-error');
          valid = false;
        } else {
          var parsedEp = parseInt(rawEp, 10);
          if (parsedEp < 1 || parsedEp > 9999) {
            errEp.textContent = 'Episode must be between 1 and 9999.';
            epEl.classList.add('input-error');
            valid = false;
          } else {
            episode = parsedEp;
          }
        }
      }

      if (!valid) return;

      if (editingQuoteId) {
        var target = anime.quotes.find(function(q) { return q.id === editingQuoteId; });
        if (target) {
          target.text    = text;
          target.speaker = speaker;
          target.episode = episode;
        }
        editingQuoteId = null;
      } else {
        anime.quotes.push({
          id:        generateId(),
          text:      text,
          speaker:   speaker,
          episode:   episode,
          createdAt: Date.now()
        });
      }

      anime.updatedAt = Date.now();
      stateCommit();
    });
  }

  // Cancel editing a quote
  var cancelQuoteBtn = document.getElementById('quote-cancel-edit');
  if (cancelQuoteBtn) {
    cancelQuoteBtn.addEventListener('click', function() {
      editingQuoteId = null;
      var anime = findAnimeById(animeId);
      if (anime) renderDetails(anime);
    });
  }

  // Edit / Delete individual quote buttons (delegated on quotes list)
  var quotesListEl = document.getElementById('detail-quotes-list');
  if (quotesListEl) {
    quotesListEl.addEventListener('click', function(e) {
      var editBtn = e.target.closest('.detail-quote-edit');
      if (editBtn) {
        editingQuoteId = editBtn.dataset.quoteId;
        var anime = findAnimeById(animeId);
        if (anime) {
          renderDetails(anime);
          var input = document.getElementById('quote-text-input');
          if (input) input.focus();
        }
        return;
      }
      var delBtn = e.target.closest('.detail-quote-delete');
      if (delBtn) {
        openDeleteQuoteConfirm(animeId, delBtn.dataset.quoteId);
      }
    });
  }

  // Rating stars (mouse + keyboard accessible)
  var starsContainer = document.getElementById('detail-rating-stars');

  function applyStarRating(value, restoreFocus) {
    var anime = findAnimeById(animeId);
    if (!anime) return;
    anime.rating = value;
    stateCommit(); // re-renders details, updating stars visually
    if (restoreFocus) {
      var targetStar = document.querySelector('#detail-rating-stars .rating-star[data-star="' + value + '"]');
      if (targetStar) targetStar.focus();
    }
  }

  starsContainer.addEventListener('click', function(e) {
    var star = e.target.closest('.rating-star');
    if (!star) return;
    applyStarRating(parseInt(star.dataset.star, 10), false);
  });

  starsContainer.addEventListener('keydown', function(e) {
    var star = e.target.closest('.rating-star');
    if (!star) return;
    var val = parseInt(star.dataset.star, 10);

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      applyStarRating(val, true);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      var next = starsContainer.querySelector('.rating-star[data-star="' + Math.min(10, val + 1) + '"]');
      if (next) next.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      var prev = starsContainer.querySelector('.rating-star[data-star="' + Math.max(1, val - 1) + '"]');
      if (prev) prev.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      var first = starsContainer.querySelector('.rating-star[data-star="1"]');
      if (first) first.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      var last = starsContainer.querySelector('.rating-star[data-star="10"]');
      if (last) last.focus();
    }
  });

  starsContainer.addEventListener('mouseover', function(e) {
    var star = e.target.closest('.rating-star');
    if (!star) return;
    var hoverVal = parseInt(star.dataset.star, 10);
    starsContainer.querySelectorAll('.rating-star').forEach(function(s, i) {
      s.textContent = (i + 1) <= hoverVal ? '★' : '☆';
    });
  });

  starsContainer.addEventListener('mouseleave', function() {
    var currentRating = parseInt(starsContainer.dataset.selected, 10) || 0;
    starsContainer.querySelectorAll('.rating-star').forEach(function(s, i) {
      s.textContent = (i + 1) <= currentRating ? '★' : '☆';
    });
  });
}

/**
 * Increases watched episodes by 1 for the given anime.
 * Automatically sets status to 'completed' when a known total is reached
 * and the anime is not currently ongoing/airing.
 * @param {string} animeId
 */
function incrementEpisode(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;
  if (anime.totalEps !== null && anime.watchedEps >= anime.totalEps) return; // already at max

  var prevEp = anime.watchedEps || 0;
  var prevStatus = anime.status;
  anime.watchedEps = prevEp + 1;
  anime.updatedAt = Date.now();

  recordWatchActivity(anime, prevEp, anime.watchedEps);

  // Auto-complete only if total is known and anime is not ongoing.
  // Mark autoCompleted so decrementEpisode can distinguish this from a manual status choice.
  if (anime.totalEps !== null && anime.watchedEps === anime.totalEps && anime.airingStatus !== 'RELEASING') {
    anime.status        = 'completed';
    anime.autoCompleted = true;
    if (prevStatus !== 'completed') {
      recordCompletionEvent(anime);
    }
  }

  stateCommit();
}

/**
 * Decreases watched episodes by 1 for the given anime.
 * Prevents going below 0.
 * @param {string} animeId
 */
function decrementEpisode(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;
  if (anime.watchedEps <= 0) return; // already at min

  anime.watchedEps -= 1;

  // Only revert to Watching if the Completed status was set automatically by incrementEpisode.
  // If the user manually chose Completed (e.g. mid-series), preserve that choice.
  if (anime.status === 'completed' && anime.autoCompleted &&
      (anime.totalEps === null || anime.watchedEps < anime.totalEps)) {
    anime.status        = 'watching';
    anime.autoCompleted = false;
  }

  stateCommit();
}

/**
 * Briefly changes a button's label to confirm an action, then restores it.
 * @param {HTMLElement} btn
 * @param {string} message
 */
function flashSaved(btn, message) {
  var original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(function() {
    btn.textContent = original;
    btn.disabled = false;
  }, 1200);
}


/* ── 5.8 Journal — Filter tabs, TOC click & View Details button ── */

// Filter tabs: All / Reviews / Quotes
document.getElementById('journal-filter-tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  var filter = btn.dataset.journalFilter || 'all';
  state.journalFilter = filter;
  document.querySelectorAll('#journal-filter-tabs .tab-btn').forEach(function(b) {
    var active = b.dataset.journalFilter === filter;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderJournal();
});

// Delegated on the TOC list
document.getElementById('journal-toc-list').addEventListener('click', function(e) {
  var item = e.target.closest('.toc-item');
  if (!item) return;
  document.querySelectorAll('.toc-item').forEach(function(i) { i.classList.remove('active'); });
  item.classList.add('active');
  var targetId = item.dataset.scrollTarget || ('journal-entry-' + item.dataset.journalId);
  var entry = document.getElementById(targetId);
  if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Delegated on the feed — "View Details" button
document.getElementById('journal-feed').addEventListener('click', function(e) {
  var btn = e.target.closest('.journal-view-btn');
  if (!btn) return;
  var id = btn.dataset.id;
  var anime = findAnimeById(id);
  if (!anime) return;
  state.currentAnimeId = id;
  renderDetails(anime);
  navigateTo('details', true, id);
});


/* ═══════════════════════════════════════════════════════════
   5.9 ANILIST SEARCH & CATALOGUE INTEGRATION
═══════════════════════════════════════════════════════════ */

var ANILIST_ENDPOINT = 'https://graphql.anilist.co';
var ANILIST_QUERY = [
  'query ($search: String, $page: Int, $perPage: Int) {',
  '  Page(page: $page, perPage: $perPage) {',
  '    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {',
  '      id',
  '      isAdult',
  '      title { romaji english }',
  '      coverImage { large medium }',
  '      format',
  '      episodes',
  '      status',
  '      seasonYear',
  '      startDate { year }',
  '      genres',
  '    }',
  '  }',
  '}'
].join('\n');

var searchState = {
  debounceTimer: null,
  abortCtrl:     null,
  results:       [],
  selectedMedia: null,
  lastQuery:     ''
};

/** Opens the AniList search modal in Step 1 (search view). */
function openSearchModal() {
  // Cancel any in-flight debounce / fetch from a previous session
  clearTimeout(searchState.debounceTimer);
  if (searchState.abortCtrl) {
    searchState.abortCtrl.abort();
    searchState.abortCtrl = null;
  }

  // Reset all search state so each open is a clean slate
  searchState.results       = [];
  searchState.selectedMedia = null;
  searchState.lastQuery     = '';

  // Reset input field and clear button
  var inputEl = document.getElementById('anilist-search-input');
  if (inputEl) inputEl.value = '';
  var clearEl = document.getElementById('anilist-search-clear');
  if (clearEl) clearEl.style.display = 'none';

  // Reset results area to initial hint message
  var resultsEl = document.getElementById('anilist-results-area');
  if (resultsEl) resultsEl.innerHTML = '<p class="search-state-msg">Type at least 2 characters to search…</p>';

  // Show step 1 (search), hide step 2 (confirm)
  document.getElementById('search-view').style.display         = '';
  document.getElementById('search-confirm-view').style.display = 'none';
  document.getElementById('search-modal-title').textContent    = 'Search Anime Catalogue';

  // Clear any inline validation errors from a previous session
  var errStatus  = document.getElementById('error-search-status');
  var errWatched = document.getElementById('error-search-watched');
  if (errStatus)  errStatus.textContent  = '';
  if (errWatched) errWatched.textContent = '';

  showModal('search-modal-overlay');
  setTimeout(function() {
    if (inputEl) inputEl.focus();
  }, 50);
}

/** Closes the AniList search modal and cancels any pending request. */
function closeSearchModal() {
  clearTimeout(searchState.debounceTimer);
  if (searchState.abortCtrl) {
    searchState.abortCtrl.abort();
    searchState.abortCtrl = null;
  }
  hideModal('search-modal-overlay');
}

/** Returns preferred display title (English, falling back to Romaji). */
function getMediaTitle(media) {
  if (!media || !media.title) return 'Untitled';
  return media.title.english || media.title.romaji || 'Untitled';
}

/** Returns release year from seasonYear or startDate.year, or null. */
function getMediaYear(media) {
  if (!media) return null;
  return media.seasonYear || (media.startDate && media.startDate.year) || null;
}

/**
 * Executes a GraphQL search against AniList for ANIME media.
 * @param {string} query
 */
function fetchAniListSearch(query) {
  var resultsArea = document.getElementById('anilist-results-area');

  if (searchState.abortCtrl) {
    searchState.abortCtrl.abort();
  }
  searchState.abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  searchState.lastQuery = query;

  resultsArea.innerHTML =
    '<div class="search-loading" role="status" aria-live="polite">' +
      '<div class="search-spinner" aria-hidden="true"></div>' +
      '<p class="search-state-msg">Searching AniList catalogue…</p>' +
    '</div>';

  var fetchOpts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json'
    },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { search: query, page: 1, perPage: 12 }
    })
  };
  if (searchState.abortCtrl) fetchOpts.signal = searchState.abortCtrl.signal;

  fetch(ANILIST_ENDPOINT, fetchOpts)
    .then(function(res) {
      if (res.status === 429) {
        throw new Error('RATE_LIMIT');
      }
      if (!res.ok) {
        throw new Error('HTTP_' + res.status);
      }
      return res.json();
    })
    .then(function(json) {
      if (json.errors && json.errors.length > 0) {
        throw new Error(json.errors[0].message || 'API_ERROR');
      }
      var mediaList = (json.data && json.data.Page && Array.isArray(json.data.Page.media))
        ? json.data.Page.media.filter(function(m) { return !m.isAdult; })
        : [];
      searchState.results = mediaList;
      renderSearchResults(mediaList, query);
    })
    .catch(function(err) {
      if (err && err.name === 'AbortError') return; // superseded by newer query
      var msg = 'Could not reach AniList. Please check your connection and try again.';
      if (err && err.message === 'RATE_LIMIT') {
        msg = 'AniList rate limit reached (429). Please wait a moment and try again.';
      }
      resultsArea.innerHTML =
        '<div class="search-error-box">' +
          '<p class="search-state-msg">' + escapeHtml(msg) + '</p>' +
          '<button type="button" class="btn-secondary btn-sm" id="search-retry-btn">Retry Search</button>' +
        '</div>';
    });
}

/**
 * Renders AniList search result cards into #anilist-results-area.
 * @param {Array} mediaList
 * @param {string} query
 */
function renderSearchResults(mediaList, query) {
  var resultsArea = document.getElementById('anilist-results-area');

  if (!mediaList || mediaList.length === 0) {
    resultsArea.innerHTML =
      '<div class="search-empty-box">' +
        '<p class="search-state-msg">No anime found for "<strong>' + escapeHtml(query) + '</strong>".</p>' +
      '</div>';
    return;
  }

  resultsArea.innerHTML = '<div class="search-results-grid">' + mediaList.map(function(media) {
    var title      = getMediaTitle(media);
    var year       = getMediaYear(media);
    var format     = formatMediaFormat(media.format);
    var epsText    = media.format === 'MOVIE'
      ? 'Movie'
      : (media.episodes !== null && media.episodes !== undefined ? media.episodes + ' eps' : '? eps');
    var airText    = formatAiringStatus(media.status);
    var rawCover   = (media.coverImage && (media.coverImage.large || media.coverImage.medium)) || '';
    var cover      = isValidUrl(rawCover) ? rawCover : '';
    var alreadyIn  = !!findAnimeByAnilistId(media.id);

    return (
      '<button type="button" class="search-result-card' + (alreadyIn ? ' is-added' : '') + '" data-anilist-id="' + media.id + '">' +
        '<div class="search-result-cover">' +
          (cover
            ? '<img class="js-poster-img" src="' + escapeHtml(cover) + '" alt="Poster for ' + escapeHtml(title) + '" loading="lazy" decoding="async">' +
              '<div class="poster-placeholder search-result-fallback" style="display:none"><span class="poster-kanji-sm">' + escapeHtml(title.charAt(0)) + '</span></div>'
            : '<div class="poster-placeholder search-result-fallback"><span class="poster-kanji-sm">' + escapeHtml(title.charAt(0)) + '</span></div>') +
          (alreadyIn ? '<span class="search-added-badge">In Library</span>' : '') +
        '</div>' +
        '<div class="search-result-info">' +
          '<h3 class="search-result-title">' + escapeHtml(title) + '</h3>' +
          '<p class="search-result-meta">' +
            (year ? year + ' · ' : '') + escapeHtml(format) + ' · ' + escapeHtml(epsText) +
          '</p>' +
          '<span class="search-result-status">' + escapeHtml(airText) + '</span>' +
        '</div>' +
      '</button>'
    );
  }).join('') + '</div>';
}

/**
 * Transitions the search modal to Step 2 for the selected AniList entry.
 * @param {number} mediaId
 */
function selectSearchResult(mediaId) {
  var media = searchState.results.find(function(m) { return m.id === mediaId; });
  if (!media) return;

  searchState.selectedMedia = media;
  var title     = getMediaTitle(media);
  var year      = getMediaYear(media);
  var format    = formatMediaFormat(media.format);
  var isMovie   = media.format === 'MOVIE';
  var totalEps  = isMovie ? 1 : (typeof media.episodes === 'number' ? media.episodes : null);
  var epsLabel  = isMovie ? 'Movie (1 feature)' : (totalEps !== null ? totalEps + ' episodes' : 'Unknown (ongoing/TBA)');
  var rawCover  = (media.coverImage && (media.coverImage.large || media.coverImage.medium)) || '';
  var cover     = isValidUrl(rawCover) ? rawCover : '';
  var genres    = Array.isArray(media.genres) ? media.genres.slice(0, 4).join(', ') : '';
  var existing  = findAnimeByAnilistId(media.id);

  document.getElementById('search-modal-title').textContent    = 'Add to Library';
  document.getElementById('search-view').style.display         = 'none';
  document.getElementById('search-confirm-view').style.display = '';

  document.getElementById('selected-anime-preview').innerHTML =
    '<div class="selected-cover">' +
      (cover
        ? '<img class="js-poster-img" src="' + escapeHtml(cover) + '" alt="Poster for ' + escapeHtml(title) + '" loading="lazy" decoding="async">' +
          '<div class="poster-placeholder poster-lg" style="display:none"><span class="poster-kanji">' + escapeHtml(title.charAt(0)) + '</span></div>'
        : '<div class="poster-placeholder poster-lg"><span class="poster-kanji">' + escapeHtml(title.charAt(0)) + '</span></div>') +
    '</div>' +
    '<div class="selected-meta">' +
      '<h3 class="selected-title">' + escapeHtml(title) + '</h3>' +
      (media.title && media.title.romaji && media.title.romaji !== title
        ? '<p class="selected-romaji">' + escapeHtml(media.title.romaji) + '</p>'
        : '') +
      '<div class="selected-tags">' +
        '<span class="tag">' + escapeHtml(format) + '</span>' +
        (year ? '<span class="tag">' + year + '</span>' : '') +
        '<span class="tag">' + escapeHtml(epsLabel) + '</span>' +
        '<span class="tag">' + escapeHtml(formatAiringStatus(media.status)) + '</span>' +
      '</div>' +
      (genres ? '<p class="selected-genres">' + escapeHtml(genres) + '</p>' : '') +
      (existing
        ? '<p class="duplicate-notice">Already in your library (' + statusLabel(existing.status) + '). <button type="button" class="btn-link" id="view-existing-btn" data-id="' + existing.id + '">Open Details →</button></p>'
        : '') +
    '</div>';

  // Configure form defaults & constraints
  var statusEl  = document.getElementById('search-add-status');
  var watchedEl = document.getElementById('search-add-watched');
  var ratingEl  = document.getElementById('search-add-rating');
  var saveBtn   = document.getElementById('search-save-btn');
  var watchedLabel = document.querySelector('label[for="search-add-watched"]');

  document.getElementById('error-search-status').textContent  = '';
  document.getElementById('error-search-watched').textContent = '';
  watchedEl.classList.remove('input-error');
  statusEl.classList.remove('input-error');

  statusEl.value = media.status === 'NOT_YET_RELEASED' ? 'plan' : 'watching';
  watchedEl.value = '0';
  watchedEl.max   = totalEps !== null ? String(totalEps) : '9999';
  ratingEl.value  = '';

  var unknownRow = document.getElementById('search-unknown-row');
  if (unknownRow) {
    unknownRow.style.display = (!isMovie && totalEps === null) ? 'flex' : 'none';
  }

  if (isMovie) {
    watchedLabel.textContent = 'Watched (0 = No, 1 = Yes)';
  } else {
    watchedLabel.textContent = 'Episodes Watched' + (totalEps !== null ? ' (max ' + totalEps + ')' : '');
  }

  saveBtn.disabled = !!existing;
  saveBtn.textContent = existing ? 'Already Added' : 'Add to Library';
}

// Search input with 350ms debounce
document.getElementById('anilist-search-input').addEventListener('input', function() {
  var q = this.value.trim();
  var clearBtn = document.getElementById('anilist-search-clear');
  clearBtn.style.display = q.length > 0 ? '' : 'none';

  clearTimeout(searchState.debounceTimer);
  if (q.length < 2) {
    if (searchState.abortCtrl) searchState.abortCtrl.abort();
    document.getElementById('anilist-results-area').innerHTML =
      '<p class="search-state-msg">Type at least 2 characters to search the AniList catalogue.</p>';
    return;
  }

  searchState.debounceTimer = setTimeout(function() {
    fetchAniListSearch(q);
  }, 350);
});

// Immediate search on Enter
document.getElementById('anilist-search-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    var q = this.value.trim();
    if (q.length >= 2) {
      clearTimeout(searchState.debounceTimer);
      fetchAniListSearch(q);
    }
  }
});

// Clear search input
document.getElementById('anilist-search-clear').addEventListener('click', function() {
  var input = document.getElementById('anilist-search-input');
  input.value = '';
  this.style.display = 'none';
  clearTimeout(searchState.debounceTimer);
  if (searchState.abortCtrl) searchState.abortCtrl.abort();
  document.getElementById('anilist-results-area').innerHTML =
    '<p class="search-state-msg">Type at least 2 characters to search the AniList catalogue.</p>';
  input.focus();
});

// Delegated clicks inside results area (result selection + retry)
document.getElementById('anilist-results-area').addEventListener('click', function(e) {
  var retryBtn = e.target.closest('#search-retry-btn');
  if (retryBtn && searchState.lastQuery.length >= 2) {
    fetchAniListSearch(searchState.lastQuery);
    return;
  }
  var card = e.target.closest('.search-result-card');
  if (card) {
    selectSearchResult(parseInt(card.dataset.anilistId, 10));
  }
});

// Delegated click for "Open Details ->" on duplicate notice
document.getElementById('selected-anime-preview').addEventListener('click', function(e) {
  var btn = e.target.closest('#view-existing-btn');
  if (!btn) return;
  var anime = findAnimeById(btn.dataset.id);
  if (!anime) return;
  closeSearchModal();
  state.currentAnimeId = anime.id;
  renderDetails(anime);
  navigateTo('details', true, anime.id);
});

// Back to results
document.getElementById('search-back-btn').addEventListener('click', function() {
  searchState.selectedMedia = null;
  document.getElementById('search-modal-title').textContent    = 'Search Anime Catalogue';
  document.getElementById('search-confirm-view').style.display = 'none';
  document.getElementById('search-view').style.display         = '';
});

// Close & cancel buttons
document.getElementById('search-modal-close').addEventListener('click', closeSearchModal);
document.getElementById('search-cancel-btn').addEventListener('click', closeSearchModal);
document.getElementById('search-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeSearchModal();
});

// Switch to manual entry modal (preserve typed search title if any)
document.getElementById('open-manual-add-btn').addEventListener('click', function() {
  var typedQuery = (document.getElementById('anilist-search-input').value || '').trim();
  closeSearchModal();
  openAddModal();
  if (typedQuery) {
    document.getElementById('form-title').value = typedQuery;
  }
});

// Auto-sync watched episodes helper when user picks Completed on a known-length anime/movie
document.getElementById('search-add-status').addEventListener('change', function() {
  var media = searchState.selectedMedia;
  if (!media) return;
  var totalEps = media.format === 'MOVIE' ? 1 : (typeof media.episodes === 'number' ? media.episodes : null);
  var watchedEl = document.getElementById('search-add-watched');
  if (this.value === 'completed' && totalEps !== null) {
    watchedEl.value = String(totalEps);
  } else if (this.value === 'plan') {
    watchedEl.value = '0';
  }
});

// Clamp search-add-watched to [0, total] on change/blur with inline feedback
function clampSearchWatchedInput() {
  var media = searchState.selectedMedia;
  var watchedEl = document.getElementById('search-add-watched');
  var errEl = document.getElementById('error-search-watched');
  var raw = watchedEl.value.trim();
  if (raw === '') return;
  var val = Math.floor(Number(raw));
  var totalEps = media ? (media.format === 'MOVIE' ? 1 : (typeof media.episodes === 'number' ? media.episodes : null)) : null;

  if (isNaN(val) || val < 0) {
    watchedEl.value = '0';
    errEl.textContent = 'Watched episodes clamped to 0.';
  } else if (totalEps !== null && val > totalEps) {
    watchedEl.value = String(totalEps);
    errEl.textContent = 'Clamped to maximum episodes (' + totalEps + ').';
  } else if (String(val) !== raw) {
    watchedEl.value = String(val);
  }
}
document.getElementById('search-add-watched').addEventListener('change', clampSearchWatchedInput);
document.getElementById('search-add-watched').addEventListener('blur', clampSearchWatchedInput);

// Save selected AniList anime to library
document.getElementById('search-add-form').addEventListener('submit', function(e) {
  e.preventDefault();
  var media = searchState.selectedMedia;
  if (!media) return;

  // Prevent duplicate by AniList ID
  if (findAnimeByAnilistId(media.id)) {
    return;
  }

  var statusEl  = document.getElementById('search-add-status');
  var watchedEl = document.getElementById('search-add-watched');
  var ratingEl  = document.getElementById('search-add-rating');
  var errStatus  = document.getElementById('error-search-status');
  var errWatched = document.getElementById('error-search-watched');

  errStatus.textContent  = '';
  errWatched.textContent = '';
  statusEl.classList.remove('input-error');
  watchedEl.classList.remove('input-error');

  var isMovie  = media.format === 'MOVIE';
  var totalEps = isMovie ? 1 : (typeof media.episodes === 'number' ? media.episodes : null);
  var status   = statusEl.value;
  var rawW     = watchedEl.value.trim();
  var watched  = rawW === '' ? 0 : Math.floor(Number(rawW));
  var rawR     = ratingEl.value;
  var parsedR  = (rawR === '' || rawR === '0') ? null : parseInt(rawR, 10);
  var rating   = (parsedR === null || isNaN(parsedR) || parsedR < 1) ? null : Math.min(10, parsedR);

  var valid = true;
  if (isNaN(watched) || watched < 0) {
    watchedEl.classList.add('input-error');
    errWatched.textContent = 'Watched episodes cannot be negative.';
    valid = false;
  } else if (totalEps !== null && watched > totalEps) {
    watchedEl.classList.add('input-error');
    errWatched.textContent = 'Cannot exceed total episodes (' + totalEps + ').';
    valid = false;
  }

  if (status === 'plan' && !isNaN(watched) && watched > 0) {
    watchedEl.classList.add('input-error');
    errWatched.textContent = 'Plan to Watch entries must have 0 watched episodes.';
    valid = false;
  } else if (status === 'completed' && media.status === 'RELEASING') {
    statusEl.classList.add('input-error');
    errStatus.textContent = 'Ongoing anime cannot be marked Completed yet.';
    valid = false;
  } else if (status === 'completed' && totalEps !== null && !isNaN(watched) && watched < totalEps) {
    watchedEl.classList.add('input-error');
    errWatched.textContent = 'Completed anime must have all ' + totalEps + ' episodes watched.';
    valid = false;
  }

  if (!valid) return;

  var now    = Date.now();
  var cover  = (media.coverImage && (media.coverImage.large || media.coverImage.medium)) || '';
  var genres = Array.isArray(media.genres) ? media.genres.slice(0, 3).join(', ') : '';

  var newAnime = {
    id:            generateId(),
    anilistId:     media.id,
    title:         getMediaTitle(media),
    posterUrl:     cover,
    totalEps:      totalEps,
    watchedEps:    watched,
    status:        status,
    format:        media.format || '',
    releaseYear:   getMediaYear(media),
    airingStatus:  media.status || '',
    genre:         genres,
    rating:        rating,
    review:        '',
    notes:         '',
    addedAt:       now,
    updatedAt:     now,
    autoCompleted: false,
    quotes:        []
  };
  state.library.push(newAnime);
  if (status === 'completed') {
    recordCompletionEvent(newAnime);
  }

  closeSearchModal();
  stateCommit();
});


/* ═══════════════════════════════════════════════════════════
   5.10 EXPORT & IMPORT BACKUP
═══════════════════════════════════════════════════════════ */

var pendingImportEntries = null;

function exportLibraryBackup() {
  var now = new Date();
  var yyyy = now.getFullYear();
  var mm = String(now.getMonth() + 1).padStart(2, '0');
  var dd = String(now.getDate()).padStart(2, '0');
  var filename = 'anilog-backup-' + yyyy + '-' + mm + '-' + dd + '.json';

  var payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    library: state.library
  };

  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Exported ' + state.library.length + ' anime entries to ' + filename + '.', 'success');
}

function handleImportFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var parsed = JSON.parse(ev.target.result);
      var rawEntries = null;
      if (Array.isArray(parsed)) {
        rawEntries = parsed;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.library)) {
        if (parsed.schemaVersion !== undefined && (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < 1)) {
          throw new Error('Invalid schemaVersion.');
        }
        rawEntries = parsed.library;
      } else {
        throw new Error('Backup must contain a library array.');
      }

      // Validate required fields on every entry
      for (var i = 0; i < rawEntries.length; i++) {
        var entry = rawEntries[i];
        if (!entry || typeof entry !== 'object' || typeof entry.title !== 'string' || !entry.title.trim()) {
          throw new Error('Entry #' + (i + 1) + ' is missing a valid title.');
        }
      }

      var sanitized = sanitizeLibraryEntries(rawEntries);
      var reviewCount = sanitized.filter(function(a) { return a.review && a.review.trim() !== ''; }).length;
      var quoteCount = sanitized.reduce(function(sum, a) { return sum + (Array.isArray(a.quotes) ? a.quotes.length : 0); }, 0);

      pendingImportEntries = sanitized;
      document.getElementById('import-summary').textContent =
        'Ready to import ' + sanitized.length + ' anime entries (' +
        reviewCount + ' reviews, ' + quoteCount + ' quotes). ' +
        'Choose Merge to combine by ID, or Replace All to overwrite your current library.';
      showModal('import-overlay');
    } catch (err) {
      pendingImportEntries = null;
      showToast('Invalid backup file: ' + (err && err.message ? err.message : 'could not parse JSON.'), 'error', 6000);
    }
  };
  reader.onerror = function() {
    showToast('Could not read the selected file.', 'error');
  };
  reader.readAsText(file);
}

document.getElementById('export-data-btn').addEventListener('click', exportLibraryBackup);

document.getElementById('import-data-btn').addEventListener('click', function() {
  var fileInput = document.getElementById('import-file-input');
  fileInput.value = '';
  fileInput.click();
});

document.getElementById('import-file-input').addEventListener('change', function() {
  if (this.files && this.files[0]) {
    handleImportFile(this.files[0]);
  }
});

document.getElementById('import-close').addEventListener('click', function() {
  pendingImportEntries = null;
  hideModal('import-overlay');
});

document.getElementById('import-cancel').addEventListener('click', function() {
  pendingImportEntries = null;
  hideModal('import-overlay');
});

document.getElementById('import-overlay').addEventListener('click', function(e) {
  if (e.target === this) {
    pendingImportEntries = null;
    hideModal('import-overlay');
  }
});

document.getElementById('import-replace').addEventListener('click', function() {
  if (!pendingImportEntries) return;
  state.library = pendingImportEntries;
  state.currentAnimeId = null;
  var count = pendingImportEntries.length;
  pendingImportEntries = null;
  hideModal('import-overlay');
  stateCommit();
  showToast('Replaced library with ' + count + ' imported entries.', 'success');
});

document.getElementById('import-merge').addEventListener('click', function() {
  if (!pendingImportEntries) return;
  var byId = {};
  state.library.forEach(function(item, idx) { byId[item.id] = idx; });
  var added = 0;
  var updated = 0;
  pendingImportEntries.forEach(function(entry) {
    if (Object.prototype.hasOwnProperty.call(byId, entry.id)) {
      state.library[byId[entry.id]] = entry;
      updated++;
    } else if (entry.anilistId !== null && findAnimeByAnilistId(entry.anilistId)) {
      var existing = findAnimeByAnilistId(entry.anilistId);
      var idx = state.library.indexOf(existing);
      if (idx !== -1) state.library[idx] = entry;
      updated++;
    } else {
      state.library.push(entry);
      added++;
    }
  });
  pendingImportEntries = null;
  hideModal('import-overlay');
  stateCommit();
  showToast('Merged backup: ' + added + ' added, ' + updated + ' updated.', 'success');
});


/* ── 5.11 DEMO DATA ── */

function loadDemoData() {
  if (state.library.length > 0) return;
  var now = Date.now();
  var day = 86400000;
  state.library = [
    {
      id: 'demo-frieren',
      anilistId: null,
      title: "Frieren: Beyond Journey's End",
      posterUrl: '',
      totalEps: 28,
      watchedEps: 18,
      status: 'watching',
      format: 'TV',
      releaseYear: 2023,
      airingStatus: 'FINISHED',
      genre: 'Adventure, Fantasy',
      rating: 10,
      review: 'A meditative story about memory, grief, and learning to appreciate fleeting moments.',
      notes: '',
      addedAt: now - 5 * day,
      updatedAt: now - 1 * day,
      autoCompleted: false,
      demo: true,
      quotes: [
        { id: 'dq-1', text: 'It was just a mere ten-year adventure.', speaker: 'Frieren', episode: 1, createdAt: now - 4 * day },
        { id: 'dq-2', text: 'What makes a hero is not strength, but the memories you leave behind.', speaker: 'Himmel', episode: 12, createdAt: now - 2 * day }
      ]
    },
    {
      id: 'demo-one-piece',
      anilistId: null,
      title: 'One Piece',
      posterUrl: '',
      totalEps: null,
      watchedEps: 1086,
      status: 'watching',
      format: 'TV',
      releaseYear: 1999,
      airingStatus: 'RELEASING',
      genre: 'Action, Adventure',
      rating: 9,
      review: '',
      notes: '',
      addedAt: now - 10 * day,
      updatedAt: now - 2 * day,
      autoCompleted: false,
      demo: true,
      quotes: [
        { id: 'dq-3', text: 'If you do not take risks, you cannot create a future.', speaker: 'Monkey D. Luffy', episode: 400, createdAt: now - 1 * day }
      ]
    },
    {
      id: 'demo-bebop',
      anilistId: null,
      title: 'Cowboy Bebop',
      posterUrl: '',
      totalEps: 26,
      watchedEps: 26,
      status: 'completed',
      format: 'TV',
      releaseYear: 1998,
      airingStatus: 'FINISHED',
      genre: 'Sci-Fi, Action',
      rating: 10,
      review: 'Timeless jazz noir in space. Every episode feels like a standalone short film.',
      notes: '',
      addedAt: now - 20 * day,
      updatedAt: now - 15 * day,
      autoCompleted: true,
      demo: true,
      quotes: [
        { id: 'dq-4', text: "You're gonna carry that weight.", speaker: 'Title Card', episode: 26, createdAt: now - 15 * day }
      ]
    },
    {
      id: 'demo-spirited',
      anilistId: null,
      title: 'Spirited Away',
      posterUrl: '',
      totalEps: 1,
      watchedEps: 1,
      status: 'completed',
      format: 'MOVIE',
      releaseYear: 2001,
      airingStatus: 'FINISHED',
      genre: 'Fantasy, Mystery',
      rating: 9,
      review: '',
      notes: '',
      addedAt: now - 12 * day,
      updatedAt: now - 12 * day,
      autoCompleted: true,
      demo: true,
      quotes: []
    },
    {
      id: 'demo-vinland',
      anilistId: null,
      title: 'Vinland Saga',
      posterUrl: '',
      totalEps: 24,
      watchedEps: 0,
      status: 'plan',
      format: 'TV',
      releaseYear: 2019,
      airingStatus: 'FINISHED',
      genre: 'Action, Drama',
      rating: null,
      review: '',
      notes: '',
      addedAt: now - 3 * day,
      updatedAt: now - 3 * day,
      autoCompleted: false,
      demo: true,
      quotes: []
    },
    {
      id: 'demo-mob',
      anilistId: null,
      title: 'Mob Psycho 100',
      posterUrl: '',
      totalEps: 12,
      watchedEps: 12,
      status: 'completed',
      format: 'TV',
      releaseYear: 2016,
      airingStatus: 'FINISHED',
      genre: 'Action, Comedy',
      rating: 8,
      review: '',
      notes: '',
      addedAt: now - 8 * day,
      updatedAt: now - 8 * day,
      autoCompleted: true,
      demo: true,
      quotes: []
    },
    {
      id: 'demo-dropped-ex',
      anilistId: null,
      title: 'Glasslip',
      posterUrl: '',
      totalEps: 13,
      watchedEps: 4,
      status: 'dropped',
      format: 'TV',
      releaseYear: 2014,
      airingStatus: 'FINISHED',
      genre: 'Slice of Life',
      rating: null,
      review: '',
      notes: '',
      addedAt: now - 18 * day,
      updatedAt: now - 18 * day,
      autoCompleted: false,
      demo: true,
      quotes: []
    }
  ];
  stateCommit();
  showToast('Loaded 7 sample demo entries.', 'success');
}

function removeDemoData() {
  var before = state.library.length;
  state.library = state.library.filter(function(a) { return a.demo !== true; });
  var removed = before - state.library.length;
  if (state.currentAnimeId && !findAnimeById(state.currentAnimeId)) {
    state.currentAnimeId = null;
    document.getElementById('details-content').innerHTML = '';
    if (window.location.hash.indexOf('#details') === 0) navigateTo('library');
  }
  stateCommit();
  showToast('Removed ' + removed + ' demo ' + (removed === 1 ? 'entry' : 'entries') + '.', 'info');
}

document.addEventListener('click', function(e) {
  if (e.target.closest('.load-demo-btn')) {
    loadDemoData();
    return;
  }
  if (e.target.closest('.empty-add-btn')) {
    openSearchModal();
    return;
  }
});

var removeDemoBtnEl = document.getElementById('remove-demo-btn');
if (removeDemoBtnEl) {
  removeDemoBtnEl.addEventListener('click', removeDemoData);
}


/* ═══════════════════════════════════════════════════════════
   BOOT — initialise on page load
═══════════════════════════════════════════════════════════ */
// Global capture-phase listener for broken poster images (replaces inline onerror)
document.addEventListener('error', function(e) {
  var img = e.target;
  if (img && img.tagName === 'IMG' && img.classList.contains('js-poster-img')) {
    img.style.display = 'none';
    if (img.nextElementSibling && img.nextElementSibling.classList.contains('poster-placeholder')) {
      img.nextElementSibling.style.display = 'flex';
    }
  }
}, true);

stateInit();
renderAll();
syncFromHash();
if (state.corruptBackupNotice) {
  showToast('Saved data was corrupted and backed up to "' + STORAGE_KEY + ':corrupt-backup". Started with an empty library.', 'warning', 0);
}
console.log('[AniLOG] Ready. Library:', state.library.length, 'entries.');
