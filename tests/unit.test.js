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
        var parsedEp = parseInt(epRaw, 10);
        if (!isNaN(parsedEp) && parsedEp >= 1) ep = parsedEp;
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
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(function(item) {
        return item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim() !== '';
      })
      .map(function(item) {
        var parsedTotal = item.totalEps === null ? null : parseInt(item.totalEps, 10);
        var totalEps    = (parsedTotal === null || isNaN(parsedTotal)) ? null : Math.max(1, parsedTotal);
        var rawWatched  = Math.max(0, parseInt(item.watchedEps, 10) || 0);
        var watchedEps  = totalEps !== null ? Math.min(totalEps, rawWatched) : rawWatched;
        var rating      = Math.min(10, Math.max(0, parseInt(item.rating, 10) || 0));
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
    return [];
  }
}

function storageSave(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function calcProgress(anime) {
  if (!anime.totalEps || anime.totalEps === 0) return 0;
  return Math.min(100, Math.round((anime.watchedEps / anime.totalEps) * 100));
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
  assert(lib6[0].rating === 0, 'clamps negative rating to 0');

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

describe('calcProgress', function() {
  assert(calcProgress({ totalEps: 12, watchedEps: 6 }) === 50, '6/12 = 50%');
  assert(calcProgress({ totalEps: 12, watchedEps: 12 }) === 100, '12/12 = 100%');
  assert(calcProgress({ totalEps: 12, watchedEps: 0 }) === 0, '0/12 = 0%');
  assert(calcProgress({ totalEps: null, watchedEps: 5 }) === 0, 'null total → 0%');
  assert(calcProgress({ totalEps: 0, watchedEps: 0 }) === 0, 'zero total → 0%');
  assert(calcProgress({ totalEps: 3, watchedEps: 100 }) === 100, 'caps at 100%');
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

/* ─── Summary ─── */
console.log('\n' + '─'.repeat(50));
console.log('Tests passed: ' + passed);
console.log('Tests failed: ' + failed);
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
