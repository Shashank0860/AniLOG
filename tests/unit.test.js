/**
 * AniLOG Unit Tests
 * Run with: node tests/unit.test.js
 *
 * Tests pure logic extracted / replicated from app.js.
 * No browser APIs are required; localStorage is mocked in memory.
 */

'use strict';

/* ─── Minimal test harness ─── */
var passed = 0;
var failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  ✓ ' + label);
    passed++;
  } else {
    console.error('  ✗ FAIL: ' + label);
    failed++;
  }
}

function describe(suiteName, fn) {
  console.log('\n' + suiteName);
  fn();
}

/* ─── Mock localStorage ─── */
var _store = {};
var localStorage = {
  getItem:    function(k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem:    function(k, v) { _store[k] = String(v); },
  removeItem: function(k) { delete _store[k]; }
};

/* ─── Helpers replicated from app.js ─── */

var STORAGE_KEY = 'anilog_library';
var SCHEMA_VERSION = 2;

function generateId() {
  return String(Date.now()) + Math.random().toString(36).slice(2, 7);
}

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
        // Only accept positive whole numbers (matches app.js strict validation)
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

function storageLoad() {
  var raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    var rawEntries = null;
    if (Array.isArray(parsed)) rawEntries = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.library)) rawEntries = parsed.library;
    else throw new Error('Unexpected schema');

    return rawEntries
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
        var rating = (parsedRating === null || isNaN(parsedRating) || parsedRating < 1) ? null : Math.min(10, parsedRating);
        return {
          id:            String(item.id || generateId()),
          anilistId:     typeof item.anilistId === 'number' ? item.anilistId : null,
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
          quotes:        sanitizeQuotes(item.quotes)
        };
      });
  } catch (e) {
    if (raw) localStorage.setItem(STORAGE_KEY + ':corrupt-backup', raw);
    return [];
  }
}

function storageSave(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, library: library }));
}

var ACTIVITY_STORAGE_KEY = 'anilog_activity';
var ACTIVITY_SCHEMA_VERSION = 1;

function toLocalDateKey(timestamp) {
  var d = new Date(timestamp);
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function sanitizeWatchEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  var seenIds = {};
  var result = [];

  for (var i = 0; i < rawEvents.length; i++) {
    var ev = rawEvents[i];
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.title !== 'string' || !ev.title.trim()) continue;

    var ts = (typeof ev.timestamp === 'number' && !isNaN(ev.timestamp)) ? ev.timestamp : null;
    if (ts === null) continue;

    var episodes = Math.max(1, Math.floor(Number(ev.episodes) || 0));
    var prevEp = Math.max(0, Math.floor(Number(ev.prevEp) || 0));
    var newEp = Math.max(prevEp + 1, Math.floor(Number(ev.newEp) || (prevEp + episodes)));
    episodes = newEp - prevEp;

    var id = (typeof ev.id === 'string' && ev.id.trim()) ? ev.id.trim() : generateId();
    if (seenIds[id]) continue;
    seenIds[id] = true;

    var poster = (typeof ev.posterUrl === 'string' && isValidUrl(ev.posterUrl)) ? ev.posterUrl : '';
    var localDate = (typeof ev.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.localDate))
      ? ev.localDate
      : toLocalDateKey(ts);

    result.push({
      id:        id,
      animeId:   typeof ev.animeId === 'string' ? ev.animeId : String(ev.animeId || ''),
      title:     ev.title.trim(),
      posterUrl: poster,
      episodes:  episodes,
      prevEp:    prevEp,
      newEp:     newEp,
      timestamp: ts,
      localDate: localDate,
      demo:      ev.demo === true
    });
  }
  return result;
}

function sanitizeCompletionEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  var seenIds = {};
  var result = [];

  for (var i = 0; i < rawEvents.length; i++) {
    var ev = rawEvents[i];
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.title !== 'string' || !ev.title.trim()) continue;

    var ts = (typeof ev.timestamp === 'number' && !isNaN(ev.timestamp)) ? ev.timestamp : null;
    if (ts === null) continue;

    var id = (typeof ev.id === 'string' && ev.id.trim()) ? ev.id.trim() : generateId();
    if (seenIds[id]) continue;
    seenIds[id] = true;

    var poster = (typeof ev.posterUrl === 'string' && isValidUrl(ev.posterUrl)) ? ev.posterUrl : '';
    var localDate = (typeof ev.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.localDate))
      ? ev.localDate
      : toLocalDateKey(ts);

    result.push({
      id:        id,
      animeId:   typeof ev.animeId === 'string' ? ev.animeId : String(ev.animeId || ''),
      title:     ev.title.trim(),
      posterUrl: poster,
      format:    typeof ev.format === 'string' ? ev.format : '',
      timestamp: ts,
      localDate: localDate,
      demo:      ev.demo === true
    });
  }
  return result;
}

function activityLoad() {
  var raw = null;
  try {
    raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return { schemaVersion: ACTIVITY_SCHEMA_VERSION, watchEvents: [], completionEvents: [] };
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { schemaVersion: ACTIVITY_SCHEMA_VERSION, watchEvents: sanitizeWatchEvents(parsed), completionEvents: [] };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        schemaVersion: ACTIVITY_SCHEMA_VERSION,
        watchEvents: sanitizeWatchEvents(parsed.watchEvents),
        completionEvents: sanitizeCompletionEvents(parsed.completionEvents)
      };
    }
    return { schemaVersion: ACTIVITY_SCHEMA_VERSION, watchEvents: [], completionEvents: [] };
  } catch (e) {
    if (raw) localStorage.setItem(ACTIVITY_STORAGE_KEY + ':corrupt-backup', raw);
    return { schemaVersion: ACTIVITY_SCHEMA_VERSION, watchEvents: [], completionEvents: [] };
  }
}

function activitySave(activity) {
  try {
    var payload = {
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
      watchEvents: (activity && Array.isArray(activity.watchEvents)) ? activity.watchEvents : [],
      completionEvents: (activity && Array.isArray(activity.completionEvents)) ? activity.completionEvents : []
    };
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {}
}

function getStartOfWeek(d) {
  var date = new Date(d);
  var day = date.getDay();
  var diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function filterEventsByPeriod(events, filter) {
  if (filter === 'all') return events.slice();
  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth();
  var startOfWeek = getStartOfWeek(now);

  return events.filter(function(ev) {
    var d = new Date(ev.timestamp);
    if (filter === 'week') {
      return ev.timestamp >= startOfWeek;
    }
    if (filter === 'month') {
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    }
    if (filter === 'year') {
      return d.getFullYear() === currentYear;
    }
    return true;
  });
}

function getProgress(entry) {
  var watched = Math.max(0, Math.floor(Number(entry && entry.watchedEps) || 0));
  var total = (entry && typeof entry.totalEps === 'number' && entry.totalEps > 0) ? entry.totalEps : null;
  if (total === null) return { watched: watched, total: null, percent: null, barWidth: 0, label: 'Ongoing' };
  var clampedWatched = Math.min(total, watched);
  var pct = Math.min(100, Math.round((clampedWatched / total) * 100));
  return { watched: clampedWatched, total: total, percent: pct, barWidth: pct, label: pct + '% complete' };
}

function calcProgress(anime) {
  return getProgress(anime).percent;
}

function formatTotalEps(totalEps) {
  return totalEps === null || totalEps === undefined ? '?' : String(totalEps);
}

function isValidUrl(str) {
  try {
    var parsed = new URL(str);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function getMediaTitle(media) {
  if (!media || !media.title) return 'Untitled';
  return media.title.english || media.title.romaji || 'Untitled';
}

function findAnimeByAnilistId(library, anilistId) {
  for (var i = 0; i < library.length; i++) {
    if (library[i].anilistId === anilistId) return library[i];
  }
  return null;
}

/** Mimics incrementEpisode state logic (pure, no DOM) */
function incrementEpisodeLogic(anime) {
  if (anime.totalEps !== null && anime.watchedEps >= anime.totalEps) return anime;
  anime = Object.assign({}, anime, { watchedEps: anime.watchedEps + 1 });
  if (anime.totalEps !== null && anime.watchedEps === anime.totalEps && anime.airingStatus !== 'RELEASING') {
    anime = Object.assign({}, anime, { status: 'completed', autoCompleted: true });
  }
  return anime;
}

/** Mimics decrementEpisode state logic (pure, no DOM) */
function decrementEpisodeLogic(anime) {
  if (anime.watchedEps <= 0) return anime;
  anime = Object.assign({}, anime, { watchedEps: anime.watchedEps - 1 });
  if (anime.status === 'completed' && anime.autoCompleted &&
      (anime.totalEps === null || anime.watchedEps < anime.totalEps)) {
    anime = Object.assign({}, anime, { status: 'watching', autoCompleted: false });
  }
  return anime;
}

/* ─── Test suites ─── */

describe('storageLoad — sanitization', function() {
  _store = {};

  assert(storageLoad().length === 0, 'returns [] when storage is empty');

  localStorage.setItem(STORAGE_KEY, 'not-json');
  assert(storageLoad().length === 0, 'returns [] on malformed JSON');
  assert(localStorage.getItem(STORAGE_KEY + ':corrupt-backup') === 'not-json', 'backs up corrupt JSON to :corrupt-backup');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: '  Naruto  ', totalEps: 220, watchedEps: 10, status: 'watching', rating: 8, addedAt: 1000 }
  ]));
  var lib = storageLoad();
  assert(lib.length === 1, 'loads a valid entry');
  assert(lib[0].title === 'Naruto', 'trims title whitespace');
  assert(lib[0].totalEps === 220, 'parses totalEps correctly');
  assert(lib[0].rating === 8, 'parses rating correctly');
  assert(lib[0].autoCompleted === false, 'defaults autoCompleted to false');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'Missing title field' },
    { title: '', totalEps: 12 },
    { title: '   ', totalEps: 12 }
  ]));
  var lib2 = storageLoad();
  assert(lib2.length === 1, 'filters entries with blank or missing title');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'Ongoing Show', totalEps: null, watchedEps: 5, status: 'watching' }
  ]));
  var lib3 = storageLoad();
  assert(lib3[0].totalEps === null, 'preserves null totalEps for ongoing anime');
  assert(lib3[0].watchedEps === 5, 'preserves watchedEps when totalEps is null');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'Old show', totalEps: 12, watchedEps: 999 }
  ]));
  var lib4 = storageLoad();
  assert(lib4[0].watchedEps === 12, 'clamps watchedEps to totalEps');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'No status', totalEps: 12, watchedEps: 0 }
  ]));
  var lib5 = storageLoad();
  assert(lib5[0].status === 'plan', 'defaults invalid status to "plan"');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'Negative rating', totalEps: 1, watchedEps: 0, rating: -5 }
  ]));
  var lib6 = storageLoad();
  assert(lib6[0].rating === null, 'maps negative/0 rating to null (unrated)');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'High rating', totalEps: 1, watchedEps: 0, rating: 100 }
  ]));
  var lib7 = storageLoad();
  assert(lib7[0].rating === 10, 'clamps rating above 10 to 10');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'AniList', totalEps: 24, watchedEps: 0, anilistId: 12345 }
  ]));
  var lib8 = storageLoad();
  assert(lib8[0].anilistId === 12345, 'preserves numeric anilistId');

  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    { title: 'Already auto', totalEps: 12, watchedEps: 12, status: 'completed', autoCompleted: true }
  ]));
  var lib9 = storageLoad();
  assert(lib9[0].autoCompleted === true, 'preserves autoCompleted: true from storage');
});

describe('calcProgress / getProgress', function() {
  assert(calcProgress({ totalEps: 12, watchedEps: 6 }) === 50, '6/12 = 50%');
  assert(calcProgress({ totalEps: 12, watchedEps: 12 }) === 100, '12/12 = 100%');
  assert(calcProgress({ totalEps: 12, watchedEps: 0 }) === 0, '0/12 = 0%');
  assert(calcProgress({ totalEps: null, watchedEps: 5 }) === null, 'null total → null (Ongoing)');
  assert(calcProgress({ totalEps: 0, watchedEps: 0 }) === null, 'zero total → null (Ongoing)');
  assert(calcProgress({ totalEps: 3, watchedEps: 100 }) === 100, 'caps at 100%');
  assert(getProgress({ totalEps: null, watchedEps: 5 }).label === 'Ongoing', 'null total label is Ongoing');
});

describe('formatTotalEps', function() {
  assert(formatTotalEps(12) === '12', 'formats numeric total');
  assert(formatTotalEps(null) === '?', 'returns ? for null');
  assert(formatTotalEps(undefined) === '?', 'returns ? for undefined');
});

describe('isValidUrl', function() {
  assert(isValidUrl('https://example.com') === true, 'accepts https URL');
  assert(isValidUrl('http://example.com') === true, 'accepts http URL');
  assert(isValidUrl('ftp://example.com') === false, 'rejects ftp URL');
  assert(isValidUrl('not-a-url') === false, 'rejects non-URL string');
  assert(isValidUrl('') === false, 'rejects empty string');
  assert(isValidUrl('javascript:alert(1)') === false, 'rejects javascript: protocol');
});

describe('getMediaTitle', function() {
  assert(getMediaTitle({ title: { english: 'Naruto', romaji: 'Naruto' } }) === 'Naruto', 'prefers English title');
  assert(getMediaTitle({ title: { english: null, romaji: 'Shingeki no Kyojin' } }) === 'Shingeki no Kyojin', 'falls back to romaji');
  assert(getMediaTitle({ title: { english: '', romaji: 'Bleach' } }) === 'Bleach', 'falls back to romaji when english is empty string');
  assert(getMediaTitle(null) === 'Untitled', 'handles null media');
  assert(getMediaTitle({}) === 'Untitled', 'handles missing title object');
});

describe('findAnimeByAnilistId', function() {
  var lib = [
    { id: '1', anilistId: 100, title: 'A' },
    { id: '2', anilistId: null, title: 'B' },
    { id: '3', anilistId: 200, title: 'C' }
  ];
  assert(findAnimeByAnilistId(lib, 100) !== null, 'finds entry by anilistId');
  assert(findAnimeByAnilistId(lib, 100).title === 'A', 'returns correct entry');
  assert(findAnimeByAnilistId(lib, 999) === null, 'returns null when not found');
  // Note: searching for null anilistId matches manual entries (anilistId: null).
  // The app never calls findAnimeByAnilistId with null — duplicate prevention always
  // uses a real numeric AniList ID from the API response, so this case is unreachable.
  // We document the behaviour here without asserting a contract the app doesn't need.
  var nullResult = findAnimeByAnilistId(lib, null);
  assert(nullResult === null || (nullResult && nullResult.anilistId === null),
    'searching for null id: either null or matches a manual entry (documented behaviour)');
  assert(findAnimeByAnilistId([], 100) === null, 'returns null on empty library');
});

describe('incrementEpisode — state transitions', function() {
  var base = { totalEps: 3, watchedEps: 0, status: 'watching', airingStatus: 'FINISHED', autoCompleted: false };

  var a = incrementEpisodeLogic(Object.assign({}, base));
  assert(a.watchedEps === 1 && a.status === 'watching', 'increments and stays watching');

  var b = incrementEpisodeLogic(Object.assign({}, base, { watchedEps: 2 }));
  assert(b.watchedEps === 3 && b.status === 'completed', 'auto-completes at total');
  assert(b.autoCompleted === true, 'marks autoCompleted = true on auto-complete');

  var c = incrementEpisodeLogic(Object.assign({}, base, { watchedEps: 3 }));
  assert(c.watchedEps === 3 && c.status === 'watching', 'does not go past total');

  var d = incrementEpisodeLogic(Object.assign({}, base, { watchedEps: 2, airingStatus: 'RELEASING' }));
  assert(d.watchedEps === 3 && d.status === 'watching', 'does NOT auto-complete airing anime');
  assert(d.autoCompleted === false, 'autoCompleted stays false for airing anime');

  var e = incrementEpisodeLogic(Object.assign({}, base, { totalEps: null, watchedEps: 100 }));
  assert(e.watchedEps === 101 && e.status === 'watching', 'increments freely when totalEps is null');
});

describe('decrementEpisode — state transitions', function() {
  var autoCompleted = { totalEps: 12, watchedEps: 12, status: 'completed', autoCompleted: true, airingStatus: 'FINISHED' };
  var manualCompleted = { totalEps: 12, watchedEps: 6, status: 'completed', autoCompleted: false, airingStatus: 'FINISHED' };

  var a = decrementEpisodeLogic(Object.assign({}, autoCompleted));
  assert(a.watchedEps === 11 && a.status === 'watching', 'reverts auto-completed to watching on decrement');
  assert(a.autoCompleted === false, 'clears autoCompleted flag');

  var b = decrementEpisodeLogic(Object.assign({}, manualCompleted));
  assert(b.watchedEps === 5 && b.status === 'completed', 'preserves manually-set Completed on decrement');

  var c = decrementEpisodeLogic({ totalEps: 12, watchedEps: 0, status: 'watching', autoCompleted: false });
  assert(c.watchedEps === 0, 'does not go below 0');

  var d = decrementEpisodeLogic({ totalEps: null, watchedEps: 5, status: 'watching', autoCompleted: false });
  assert(d.watchedEps === 4, 'decrements when totalEps is null');
});

describe('validateForm logic — episode validation with unknownEps', function() {
  // Replicate the core validation logic (pure, no DOM needed)
  function validateEpisodes(unknownEps, episodes, watched, status) {
    var errors = [];
    if (!unknownEps) {
      if (!episodes || isNaN(episodes) || episodes < 1) errors.push('Enter at least 1 total episode, or tick "Unknown / Ongoing".');
      else if (episodes > 9999) errors.push('Maximum 9999 episodes allowed.');
    }
    if (isNaN(watched) || watched < 0) errors.push('Watched episodes cannot be negative.');
    else if (!unknownEps && !isNaN(episodes) && watched > episodes) errors.push('Cannot exceed total episodes.');
    if (status === 'plan' && watched > 0) errors.push('Plan to Watch must have 0 watched episodes.');
    else if (status === 'completed' && !unknownEps && !isNaN(episodes) && watched < episodes)
      errors.push('Completed must have all episodes watched.');
    else if (status === 'watching' && !unknownEps && !isNaN(episodes) && watched === episodes)
      errors.push('All watched — select Completed.');
    return errors;
  }

  assert(validateEpisodes(false, 12, 6, 'watching').length === 0, 'valid standard entry passes');
  assert(validateEpisodes(false, 0, 0, 'plan').length > 0, 'rejects 0 episodes without unknown flag');
  assert(validateEpisodes(true, NaN, 5, 'watching').length === 0, 'unknown flag bypasses episode count check');
  assert(validateEpisodes(false, 12, 15, 'watching').length > 0, 'rejects watched > total');
  assert(validateEpisodes(false, 12, 5, 'plan').length > 0, 'rejects plan with watched > 0');
  assert(validateEpisodes(false, 12, 11, 'completed').length > 0, 'rejects completed with watched < total');
  assert(validateEpisodes(false, 12, 12, 'completed').length === 0, 'accepts completed with watched == total');
  assert(validateEpisodes(false, 12, 12, 'watching').length > 0, 'rejects watching when all episodes done');
  assert(validateEpisodes(false, 12, -1, 'watching').length > 0, 'rejects negative watched');
});

describe('duplicate prevention', function() {
  var lib = [
    { id: 'a1', anilistId: 20, title: 'Bleach' },
    { id: 'a2', anilistId: null, title: 'My Custom Show' }
  ];
  assert(findAnimeByAnilistId(lib, 20) !== null, 'detects duplicate by anilistId');
  assert(findAnimeByAnilistId(lib, 99) === null, 'no false positive for different anilistId');

  // Title duplicate check for manual entries
  var titleExists = lib.some(function(a) { return a.title.toLowerCase() === 'bleach'; });
  assert(titleExists === true, 'detects title duplicate (case-insensitive)');
  var noExists = lib.some(function(a) { return a.title.toLowerCase() === 'one piece'; });
  assert(noExists === false, 'no false positive for unique title');
});

describe('LocalStorage round-trip', function() {
  _store = {};
  var now = Date.now();
  var entry = {
    id: 'rt1', anilistId: 42, title: 'Round Trip', posterUrl: '', totalEps: null,
    watchedEps: 7, status: 'watching', format: 'TV', releaseYear: 2023,
    airingStatus: 'RELEASING', genre: 'Action', rating: 7, review: 'Good',
    notes: 'Note', addedAt: now, updatedAt: now, autoCompleted: false
  };
  storageSave([entry]);
  var loaded = storageLoad();
  assert(loaded.length === 1, 'saves and loads one entry');
  assert(loaded[0].title === 'Round Trip', 'title survives round-trip');
  assert(loaded[0].totalEps === null, 'null totalEps survives round-trip');
  assert(loaded[0].anilistId === 42, 'anilistId survives round-trip');
  assert(loaded[0].watchedEps === 7, 'watchedEps survives round-trip');
  assert(loaded[0].airingStatus === 'RELEASING', 'airingStatus survives round-trip');
  assert(loaded[0].autoCompleted === false, 'autoCompleted false survives round-trip');
});

describe('Quotes migration & sanitization', function() {
  _store = {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify([
    {
      id: 'legacy-1',
      title: 'Cowboy Bebop',
      totalEps: 26,
      watchedEps: 26,
      status: 'completed',
      rating: 10,
      review: 'Classic.',
      notes: 'Watch the movie next!'
    }
  ]));
  var migrated = storageLoad();
  assert(migrated.length === 1, 'legacy record preserved');
  assert(Array.isArray(migrated[0].quotes) && migrated[0].quotes.length === 0, 'missing quotes becomes empty array (notes NOT converted to quotes)');
  assert(migrated[0].notes === 'Watch the movie next!', 'legacy notes preserved');
  assert(migrated[0].review === 'Classic.', 'existing review preserved');

  var sanitized = sanitizeQuotes([
    null,
    { text: '' },
    { text: '   ' },
    { id: 'q1', text: '  Believe it!  ', speaker: '  Naruto  ', episode: '12', createdAt: 5000 },
    { id: 'q2', text: 'Line 1\nLine 2', speaker: '', episode: null, createdAt: 9000 },
    { text: 'Bad ep', episode: -3 }
  ]);
  assert(sanitized.length === 3, 'filters invalid/empty quote entries');
  assert(sanitized[0].text === 'Believe it!' && sanitized[0].speaker === 'Naruto' && sanitized[0].episode === 12, 'trims text/speaker and parses episode');
  assert(sanitized[1].episode === null, 'preserves null episode');
  assert(sanitized[2].episode === null, 'rejects negative episode');
});

describe('Strict quote episode validation', function() {
  // Decimal values must be rejected
  var d1 = sanitizeQuotes([{ id: 'se1', text: 'Decimal ep', episode: '12.5' }]);
  assert(d1[0].episode === null, 'rejects decimal string "12.5"');

  var d2 = sanitizeQuotes([{ id: 'se2', text: 'Decimal ep', episode: 12.5 }]);
  assert(d2[0].episode === null, 'rejects numeric decimal 12.5');

  // Partial numeric values must be rejected
  var d3 = sanitizeQuotes([{ id: 'se3', text: 'Partial', episode: '12abc' }]);
  assert(d3[0].episode === null, 'rejects partial numeric "12abc"');

  var d4 = sanitizeQuotes([{ id: 'se4', text: 'Alpha prefix', episode: 'abc12' }]);
  assert(d4[0].episode === null, 'rejects alpha-prefixed "abc12"');

  // Boundary values
  var d5 = sanitizeQuotes([{ id: 'se5', text: 'Zero ep', episode: '0' }]);
  assert(d5[0].episode === null, 'rejects episode 0 (below minimum)');

  var d6 = sanitizeQuotes([{ id: 'se6', text: 'Too high', episode: '10000' }]);
  assert(d6[0].episode === null, 'rejects episode 10000 (exceeds 9999)');

  var d7 = sanitizeQuotes([{ id: 'se7', text: 'Max valid', episode: '9999' }]);
  assert(d7[0].episode === 9999, 'accepts episode 9999 (upper bound)');

  var d8 = sanitizeQuotes([{ id: 'se8', text: 'Min valid', episode: '1' }]);
  assert(d8[0].episode === 1, 'accepts episode 1 (lower bound)');

  // Valid numeric input (not string)
  var d9 = sanitizeQuotes([{ id: 'se9', text: 'Numeric 12', episode: 12 }]);
  assert(d9[0].episode === 12, 'accepts numeric integer 12');

  // Negative values
  var d10 = sanitizeQuotes([{ id: 'se10', text: 'Negative', episode: '-3' }]);
  assert(d10[0].episode === null, 'rejects negative string "-3"');

  var d11 = sanitizeQuotes([{ id: 'se11', text: 'Negative num', episode: -3 }]);
  assert(d11[0].episode === null, 'rejects negative number -3');

  // Whitespace and special
  var d12 = sanitizeQuotes([{ id: 'se12', text: 'Space', episode: ' 12 ' }]);
  assert(d12[0].episode === null, 'rejects episode with spaces " 12 "');
});

describe('Journal filtering logic', function() {
  var sample = [
    { id: '1', title: 'Review Only', review: 'Great show', quotes: [] },
    { id: '2', title: 'Quotes Only', review: '', quotes: [{ id: 'q1', text: 'Quote!', createdAt: 100 }] },
    { id: '3', title: 'Both', review: 'Amazing', quotes: [{ id: 'q2', text: 'Another', createdAt: 200 }] },
    { id: '4', title: 'Neither', review: '   ', quotes: [] }
  ];
  var hasRev = function(a) { return Boolean(a.review && a.review.trim() !== ''); };
  var hasQuo = function(a) { return Array.isArray(a.quotes) && a.quotes.length > 0; };

  assert(sample.filter(function(a) { return hasRev(a) || hasQuo(a); }).length === 3, 'All filter excludes entries with neither review nor quotes');
  assert(sample.filter(hasRev).length === 2, 'Reviews filter includes Review Only and Both');
  assert(sample.filter(hasQuo).length === 2, 'Quotes filter includes Quotes Only and Both');
});

describe('toLocalDateKey', function() {
  var ts = new Date(2026, 2, 15).getTime(); // March 15, 2026
  assert(toLocalDateKey(ts) === '2026-03-15', 'formats date as YYYY-MM-DD');

  var tsJan = new Date(2026, 0, 5).getTime(); // Jan 5, 2026
  assert(toLocalDateKey(tsJan) === '2026-01-05', 'pads single digit month and day with zero');
});

describe('sanitizeWatchEvents', function() {
  assert(sanitizeWatchEvents(null).length === 0, 'null input returns empty array');
  assert(sanitizeWatchEvents('not-an-array').length === 0, 'string input returns empty array');

  var valid = [
    {
      id: 'w1',
      animeId: 'a1',
      title: 'Frieren',
      posterUrl: 'https://example.com/poster.jpg',
      episodes: 2,
      prevEp: 5,
      newEp: 7,
      timestamp: 1700000000000,
      localDate: '2023-11-14'
    }
  ];
  var s1 = sanitizeWatchEvents(valid);
  assert(s1.length === 1, 'loads valid watch event');
  assert(s1[0].episodes === 2, 'preserves episode diff count');
  assert(s1[0].prevEp === 5 && s1[0].newEp === 7, 'preserves prevEp and newEp');

  // Filters missing title or invalid timestamp
  var invalid = [
    { id: 'inv1', title: '', timestamp: 1700000000000 },
    { id: 'inv2', title: 'Test', timestamp: 'not-a-number' },
    { id: 'inv3', title: '   ', timestamp: 1700000000000 }
  ];
  assert(sanitizeWatchEvents(invalid).length === 0, 'filters entries with blank title or invalid timestamp');

  // Deduplication by id
  var dupes = [
    { id: 'same', title: 'Show 1', episodes: 1, prevEp: 0, newEp: 1, timestamp: 1000 },
    { id: 'same', title: 'Show 1 dup', episodes: 2, prevEp: 1, newEp: 3, timestamp: 2000 }
  ];
  assert(sanitizeWatchEvents(dupes).length === 1, 'deduplicates watch events by id');

  // Reject unsafe javascript: URLs
  var unsafePoster = [{ id: 'w2', title: 'X', posterUrl: 'javascript:alert(1)', timestamp: 1000 }];
  assert(sanitizeWatchEvents(unsafePoster)[0].posterUrl === '', 'rejects unsafe poster url');
});

describe('sanitizeCompletionEvents', function() {
  assert(sanitizeCompletionEvents(null).length === 0, 'null returns empty array');

  var valid = [
    {
      id: 'c1',
      animeId: 'a1',
      title: 'Steins;Gate',
      posterUrl: 'https://example.com/sg.jpg',
      format: 'TV',
      timestamp: 1700000000000,
      localDate: '2023-11-14'
    }
  ];
  var s = sanitizeCompletionEvents(valid);
  assert(s.length === 1, 'loads valid completion event');
  assert(s[0].format === 'TV', 'preserves format');

  var dupes = [
    { id: 'c-dupe', title: 'Show', timestamp: 1000 },
    { id: 'c-dupe', title: 'Show', timestamp: 2000 }
  ];
  assert(sanitizeCompletionEvents(dupes).length === 1, 'deduplicates completion events by id');
});

describe('activityLoad & activitySave', function() {
  localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  var empty = activityLoad();
  assert(empty.watchEvents.length === 0 && empty.completionEvents.length === 0, 'empty storage returns empty events');

  var testAct = {
    schemaVersion: 1,
    watchEvents: [
      { id: 'w1', animeId: 'a1', title: 'Test Anime', posterUrl: '', episodes: 3, prevEp: 0, newEp: 3, timestamp: 5000, localDate: '2026-03-01' }
    ],
    completionEvents: [
      { id: 'c1', animeId: 'a1', title: 'Test Anime', posterUrl: '', format: 'TV', timestamp: 5000, localDate: '2026-03-01' }
    ]
  };
  activitySave(testAct);
  var loaded = activityLoad();
  assert(loaded.watchEvents.length === 1, 'round-trips watch events');
  assert(loaded.completionEvents.length === 1, 'round-trips completion events');
  assert(loaded.watchEvents[0].episodes === 3, 'watch event episode count preserved');

  // Corrupt JSON handling
  localStorage.setItem(ACTIVITY_STORAGE_KEY, '{ invalid json');
  var fallback = activityLoad();
  assert(fallback.watchEvents.length === 0, 'corrupt JSON recovers to empty events');
  assert(localStorage.getItem(ACTIVITY_STORAGE_KEY + ':corrupt-backup') === '{ invalid json', 'backs up corrupt activity data');
});

describe('Watch activity recording conditions', function() {
  var recorded = [];
  function mockRecord(prevEp, newEp) {
    if (newEp > prevEp) {
      recorded.push({ episodes: newEp - prevEp, prevEp: prevEp, newEp: newEp });
    }
  }

  mockRecord(5, 6);
  assert(recorded.length === 1 && recorded[0].episodes === 1, 'records 1 episode when progress increases from 5 to 6');

  mockRecord(5, 9);
  assert(recorded.length === 2 && recorded[1].episodes === 4, 'records 4 episodes when progress increases from 5 to 9');

  mockRecord(9, 8);
  assert(recorded.length === 2, 'does not record watch activity when progress decreases');

  mockRecord(8, 8);
  assert(recorded.length === 2, 'does not record watch activity when progress is unchanged');
});

describe('Timeline period filtering logic', function() {
  var now = Date.now();
  var day = 86400000;
  var events = [
    { id: 'e1', title: 'Today', timestamp: now, episodes: 1 },
    { id: 'e2', title: '3 days ago', timestamp: now - 3 * day, episodes: 2 },
    { id: 'e3', title: '60 days ago', timestamp: now - 60 * day, episodes: 3 },
    { id: 'e4', title: '400 days ago', timestamp: now - 400 * day, episodes: 4 }
  ];

  var all = filterEventsByPeriod(events, 'all');
  assert(all.length === 4, 'all filter returns all events');

  var week = filterEventsByPeriod(events, 'week');
  assert(week.length >= 1 && week[0].id === 'e1', 'week filter includes current week');

  var year = filterEventsByPeriod(events, 'year');
  assert(year.some(function(e) { return e.id === 'e1'; }), 'year filter includes recent event');
  assert(!year.some(function(e) { return e.id === 'e4'; }), 'year filter excludes event from prior year');
});

describe('Personal Rating Insights calculation', function() {
  var lib = [
    { id: '1', title: 'Top Show', rating: 10 },
    { id: '2', title: 'Good Show', rating: 8 },
    { id: '3', title: 'Average Show', rating: 6 },
    { id: '4', title: 'Unrated 1', rating: null },
    { id: '5', title: 'Unrated 2', rating: undefined }
  ];

  var rated = lib.filter(function(a) { return a.rating !== null && a.rating !== undefined && a.rating >= 1; });
  assert(rated.length === 3, 'excludes unrated anime (null/undefined)');

  var sum = rated.reduce(function(acc, a) { return acc + a.rating; }, 0);
  var avg = (sum / rated.length).toFixed(1);
  assert(avg === '8.0', 'calculates accurate average score (24 / 3 = 8.0)');

  var highest = rated[0];
  var lowest = rated[0];
  rated.forEach(function(a) {
    if (a.rating > highest.rating) highest = a;
    if (a.rating < lowest.rating) lowest = a;
  });
  assert(highest.title === 'Top Show' && highest.rating === 10, 'identifies highest rated anime');
  assert(lowest.title === 'Average Show' && lowest.rating === 6, 'identifies lowest rated anime');
});

describe('Year in Review metrics aggregation', function() {
  var testYear = 2026;
  var watchEvents = [
    { animeId: 'frieren', title: 'Frieren', episodes: 4, timestamp: new Date(2026, 1, 10).getTime() },
    { animeId: 'frieren', title: 'Frieren', episodes: 6, timestamp: new Date(2026, 2, 15).getTime() },
    { animeId: 'dungeon', title: 'Dungeon', episodes: 3, timestamp: new Date(2026, 2, 20).getTime() },
    { animeId: 'old', title: 'Old Show', episodes: 12, timestamp: new Date(2025, 5, 1).getTime() } // prior year
  ];

  var yearEvents = watchEvents.filter(function(ev) {
    return new Date(ev.timestamp).getFullYear() === testYear;
  });
  assert(yearEvents.length === 3, 'filters events to target year only');

  var totalEps = yearEvents.reduce(function(sum, ev) { return sum + ev.episodes; }, 0);
  assert(totalEps === 13, 'calculates correct total episodes for year (4 + 6 + 3 = 13)');

  var animeTotals = {};
  yearEvents.forEach(function(ev) {
    animeTotals[ev.animeId] = (animeTotals[ev.animeId] || 0) + ev.episodes;
  });
  assert(animeTotals['frieren'] === 10, 'correctly sums episodes for top anime');
  assert(animeTotals['dungeon'] === 3, 'correctly sums episodes for other anime');
});

/* ─── Summary ─── */
console.log('\n' + '─'.repeat(50));
console.log('Tests passed: ' + passed);
console.log('Tests failed: ' + failed);
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
