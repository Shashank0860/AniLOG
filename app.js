/**
 * AniLog — app.js
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

/**
 * Loads the anime array from LocalStorage.
 * Returns an empty array if nothing is stored or data is invalid.
 * @returns {Array}
 */
function storageLoad() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sanitize each entry so malformed objects never break rendering
    return parsed
      .filter(function(item) {
        return item && typeof item === 'object' && typeof item.title === 'string' && item.title.trim() !== '';
      })
      .map(function(item) {
        var totalEps   = Math.max(1, parseInt(item.totalEps, 10) || 1);
        var watchedEps = Math.min(totalEps, Math.max(0, parseInt(item.watchedEps, 10) || 0));
        var rating     = Math.min(10, Math.max(0, parseInt(item.rating, 10) || 0));
        return {
          id:         String(item.id || generateId()),
          title:      item.title.trim(),
          posterUrl:  typeof item.posterUrl === 'string' ? item.posterUrl.trim() : '',
          totalEps:   totalEps,
          watchedEps: watchedEps,
          status:     ['watching', 'completed', 'plan', 'dropped'].indexOf(item.status) !== -1 ? item.status : 'plan',
          genre:      typeof item.genre === 'string' ? item.genre.trim() : '',
          rating:     rating,
          review:     typeof item.review === 'string' ? item.review : '',
          notes:      typeof item.notes === 'string' ? item.notes : '',
          addedAt:    typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
          updatedAt:  typeof item.updatedAt === 'number' ? item.updatedAt : (typeof item.addedAt === 'number' ? item.addedAt : Date.now())
        };
      });
  } catch (e) {
    console.warn('[AniLog] Could not parse stored data. Starting fresh.', e);
    return [];
  }
}

/**
 * Saves the current anime array to LocalStorage.
 * @param {Array} library
 */
function storageSave(library) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch (e) {
    console.error('[AniLog] Could not save to LocalStorage.', e);
  }
}


/* ═══════════════════════════════════════════════════════════
   2. STATE — single runtime object
   All reads and writes go through these functions so there
   is never more than one copy of the data in memory.
═══════════════════════════════════════════════════════════ */

var state = {
  library:        [],   // full anime array
  activeTab:      'all',
  searchQuery:    '',
  sortBy:         'added',
  statusFilter:   'all',
  currentAnimeId: null  // id of the anime shown in Details
};

/** Load persisted data into state at startup. */
function stateInit() {
  state.library = storageLoad();
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
 * Returns the percentage of episodes watched, clamped 0–100.
 * @param {Object} anime
 * @returns {number}
 */
function calcProgress(anime) {
  if (!anime.totalEps || anime.totalEps === 0) return 0;
  return Math.min(100, Math.round((anime.watchedEps / anime.totalEps) * 100));
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
    .replace(/"/g, '&quot;');
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

  // Sort
  list.sort(function(a, b) {
    if (state.sortBy === 'title') {
      return a.title.localeCompare(b.title);
    }
    if (state.sortBy === 'rating') {
      return b.rating - a.rating; // highest first
    }
    if (state.sortBy === 'progress') {
      return calcProgress(b) - calcProgress(a); // highest first
    }
    // Default: 'added' — newest first
    return b.addedAt - a.addedAt;
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
  if (anime.posterUrl) {
    return '<img class="poster-img ' + sizeClass + '" src="' + escapeHtml(anime.posterUrl) +
           '" alt="Poster for ' + escapeHtml(anime.title) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
           '<div class="poster-placeholder ' + sizeClass + '" style="display:none"><span class="poster-kanji">無</span></div>';
  }
  // No URL — show placeholder with first character of title
  var kanji = anime.title.charAt(0).toUpperCase();
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
  // If a details panel is open, refresh it too
  if (state.currentAnimeId) {
    var anime = findAnimeById(state.currentAnimeId);
    if (anime) renderDetails(anime);
    else {
      // Anime was deleted — go back to library
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
    container.innerHTML = '<p class="empty-state">Nothing currently watching.<br><em>Add an anime to get started.</em></p>';
    return;
  }

  container.innerHTML = watching.slice(0, 5).map(function(anime) {
    var pct = calcProgress(anime);
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
            '<span class="ep-current">' + anime.watchedEps + '</span>' +
            '<span class="ep-sep">/</span>' +
            '<span class="ep-total">' + anime.totalEps + '</span>' +
          '</div>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="watching-actions">' +
          '<button class="btn-secondary btn-sm dash-ep-btn" data-id="' + anime.id + '">+ EP</button>' +
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
      '<div class="completed-item" data-id="' + anime.id + '" style="cursor:pointer">' +
        '<div class="completed-poster-mini">' +
          '<span class="poster-kanji-sm">' + escapeHtml(anime.title.charAt(0)) + '</span>' +
        '</div>' +
        '<div class="completed-info">' +
          '<p class="completed-title">' + escapeHtml(anime.title) + '</p>' +
          '<div class="star-rating">' + stars + '</div>' +
        '</div>' +
      '</div>'
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
          '<p>Your library is empty.<br><em>Add your first anime to begin your log.</em></p>' +
          '<button class="btn-primary btn-sm empty-add-btn">+ Add Anime</button>' +
        '</div>';
    } else {
      grid.innerHTML =
        '<div class="empty-state empty-state--grid">' +
          '<p>No anime match your current filter.<br><em>Try another keyword or reset filters.</em></p>' +
          '<button class="btn-secondary btn-sm empty-reset-btn">Clear Filters</button>' +
        '</div>';
    }
    return;
  }

  grid.innerHTML = list.map(function(anime) {
    var pct   = calcProgress(anime);
    var stars = buildStarSummary(anime.rating);
    return (
      '<article class="anime-card" data-id="' + anime.id + '" data-status="' + anime.status + '">' +
        '<div class="anime-card-poster">' +
          buildPosterHtml(anime, 'poster-lg') +
          '<div class="status-badge status-' + anime.status + '">' + statusLabel(anime.status) + '</div>' +
        '</div>' +
        '<div class="anime-card-info">' +
          '<h3 class="anime-card-title">' + escapeHtml(anime.title) + '</h3>' +
          '<p class="anime-card-meta">' + escapeHtml(anime.genre || '') + ' · ' + anime.totalEps + ' eps</p>' +
          '<div class="anime-card-progress">' +
            '<div class="progress-bar progress-bar--sm"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="ep-fraction">' + anime.watchedEps + '/' + anime.totalEps + '</span>' +
          '</div>' +
          '<div class="star-rating-sm">' + stars + '</div>' +
        '</div>' +
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
  var pct    = calcProgress(anime);
  var rating = anime.rating || 0;

  // Build 10 clickable & keyboard-accessible star spans
  var starsHtml = '';
  for (var i = 1; i <= 10; i++) {
    var filled = i <= rating ? '★' : '☆';
    var isCurrent = i === rating ? 'true' : 'false';
    starsHtml += '<span class="rating-star" data-star="' + i + '" role="button" tabindex="0" aria-pressed="' + isCurrent + '" aria-label="Rate ' + i + ' out of 10">' + filled + '</span>';
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
          '<div class="qs-row"><span class="qs-label">Episodes</span><span class="qs-value">' + anime.totalEps + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Status</span><span class="qs-value">' + statusLabel(anime.status) + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Genre</span><span class="qs-value">' + escapeHtml(anime.genre || '—') + '</span></div>' +
          '<div class="qs-row"><span class="qs-label">Rating</span><span class="qs-value">' + (rating > 0 ? rating + '/10' : 'Unrated') + '</span></div>' +
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

        /* Episode Progress */
        '<div class="details-block">' +
          '<h3 class="details-block-title">Episode Progress</h3>' +
          '<div class="ep-tracker">' +
            '<div class="ep-display">' +
              '<span class="ep-big" id="detail-ep-current">' + anime.watchedEps + '</span>' +
              '<span class="ep-sep-big">/</span>' +
              '<span class="ep-total-big">' + anime.totalEps + '</span>' +
            '</div>' +
            '<div class="progress-bar progress-bar--lg">' +
              '<div class="progress-fill" id="detail-ep-bar" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<div class="ep-controls">' +
              '<button class="btn-secondary btn-sm" id="detail-ep-minus" data-id="' + anime.id + '">− Episode</button>' +
              '<span class="ep-pct" id="detail-ep-pct">' + pct + '% complete</span>' +
              '<button class="btn-primary btn-sm" id="detail-ep-plus" data-id="' + anime.id + '">+ Episode</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* My Rating */
        '<div class="details-block">' +
          '<h3 class="details-block-title">My Rating</h3>' +
          '<div class="rating-widget">' +
            '<div class="rating-stars" id="detail-rating-stars" data-id="' + anime.id + '" data-selected="' + rating + '" role="group" aria-label="Rate this anime">' +
              starsHtml +
            '</div>' +
            '<span class="rating-label" id="detail-rating-label">' + (rating > 0 ? rating + ' / 10' : 'Not yet rated') + '</span>' +
          '</div>' +
        '</div>' +

        /* My Review */
        '<div class="details-block">' +
          '<h3 class="details-block-title">My Review</h3>' +
          '<textarea class="review-textarea" id="detail-review" placeholder="Write your thoughts about this anime..." rows="5">' + escapeHtml(anime.review || '') + '</textarea>' +
          '<button class="btn-primary" id="detail-save-review" data-id="' + anime.id + '">Save Review</button>' +
        '</div>' +

        /* Personal Notes */
        '<div class="details-block">' +
          '<h3 class="details-block-title">Personal Notes</h3>' +
          '<textarea class="review-textarea review-textarea--notes" id="detail-notes" placeholder="Quick notes, reminders, memorable moments..." rows="3">' + escapeHtml(anime.notes || '') + '</textarea>' +
          '<button class="btn-secondary" id="detail-save-notes" data-id="' + anime.id + '">Save Notes</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );

  document.getElementById('details-content').innerHTML = html;

  // Wire up the detail-panel buttons (they are freshly created each render)
  wireDetailsEvents(anime.id);
}

/* ── 4.7 Journal ── */
function renderJournal() {
  var feed    = document.getElementById('journal-feed');
  var tocList = document.getElementById('journal-toc-list');

  // Only anime with a non-empty review appear in the journal
  var entries = state.library.filter(function(a) { return a.review && a.review.trim() !== ''; });

  if (entries.length === 0) {
    feed.innerHTML    = '<p class="empty-state">No journal entries yet.<br><em>Write a review on any anime\'s detail page to create an entry.</em></p>';
    tocList.innerHTML = '';
    return;
  }

  // Sort by latest review modification date (fallback to addedAt for older entries)
  entries.sort(function(a, b) {
    return (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt);
  });

  tocList.innerHTML = entries.map(function(anime, idx) {
    var num = String(idx + 1).padStart(2, '0');
    return (
      '<li class="toc-item" data-journal-id="' + anime.id + '">' +
        '<span class="toc-num">' + num + '</span> ' + escapeHtml(anime.title) +
      '</li>'
    );
  }).join('');

  feed.innerHTML = entries.map(function(anime, idx) {
    var num   = String(idx + 1).padStart(2, '0');
    var stars = buildStarSummary(anime.rating);
    var statusText = anime.status === 'completed' ? '✓ Completed' : '📺 Still Watching';
    var entryDate  = anime.updatedAt || anime.addedAt;

    return (
      '<article class="journal-entry" id="journal-entry-' + anime.id + '">' +
        '<div class="journal-entry-header">' +
          '<div class="journal-meta">' +
            '<span class="journal-num">[ ' + num + ' ]</span>' +
            '<div>' +
              '<h3 class="journal-entry-title">' + escapeHtml(anime.title) + '</h3>' +
              '<span class="journal-date">' + formatDate(entryDate) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="journal-rating">' + stars + '</div>' +
        '</div>' +
        '<div class="journal-tags">' +
          (anime.genre ? '<span class="tag">' + escapeHtml(anime.genre) + '</span>' : '') +
          '<span class="tag">' + statusLabel(anime.status) + '</span>' +
          '<span class="tag">EP ' + anime.watchedEps + '/' + anime.totalEps + '</span>' +
        '</div>' +
        '<div class="journal-body">' +
          '<p>' + escapeHtml(anime.review).replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
        '<div class="journal-footer">' +
          '<span class="journal-status">' + statusText + '</span>' +
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

var VALID_SECTIONS = ['dashboard', 'library', 'details', 'journal'];

/**
 * Shows the requested section and hides all others.
 * Updates the active nav link and synchronizes the URL hash.
 * @param {string} sectionId
 * @param {boolean} [updateHash=true]
 */
function navigateTo(sectionId, updateHash) {
  if (VALID_SECTIONS.indexOf(sectionId) === -1) {
    sectionId = 'dashboard';
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

  if (updateHash !== false && window.location.hash !== '#' + sectionId) {
    window.location.hash = '#' + sectionId;
  }

  document.getElementById('main-nav').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Reads the current URL hash and activates the matching section.
 * On initial load with no hash, sets #dashboard.
 */
function syncFromHash() {
  var hash = window.location.hash.replace('#', '').trim();
  if (!hash) {
    navigateTo('dashboard', true);
    return;
  }
  var targetSection = VALID_SECTIONS.indexOf(hash) !== -1 ? hash : 'dashboard';
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
  document.getElementById('main-nav').classList.toggle('open');
});


/* ── 5.2 Add / Edit Modal ── */

/** Opens the modal in "Add" mode (blank form). */
function openAddModal() {
  document.getElementById('modal-title').textContent   = 'Add Anime';
  document.getElementById('form-submit').textContent   = 'Save Anime';
  document.getElementById('anime-form').reset();
  document.getElementById('form-id').value = '';
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

  document.getElementById('modal-title').textContent = 'Edit Anime';
  document.getElementById('form-submit').textContent = 'Save Changes';
  document.getElementById('form-id').value           = anime.id;
  document.getElementById('form-title').value        = anime.title;
  document.getElementById('form-poster').value       = anime.posterUrl || '';
  document.getElementById('form-episodes').value     = anime.totalEps;
  document.getElementById('form-watched').value      = anime.watchedEps;
  document.getElementById('form-status').value       = anime.status;
  document.getElementById('form-genre').value        = anime.genre || '';
  clearFormErrors();
  showModal('modal-overlay');
}

function showModal(id) {
  document.getElementById(id).classList.add('modal-visible');
  document.body.classList.add('modal-open');
}

function hideModal(id) {
  document.getElementById(id).classList.remove('modal-visible');
  document.body.classList.remove('modal-open');
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

  if (!episodes || isNaN(episodes) || episodes < 1) {
    showFieldError('form-episodes', 'error-episodes', 'Enter at least 1 total episode.');
    valid = false;
  } else if (episodes > 9999) {
    showFieldError('form-episodes', 'error-episodes', 'Maximum 9999 episodes allowed.');
    valid = false;
  }

  if (isNaN(watched) || watched < 0) {
    showFieldError('form-watched', 'error-watched', 'Watched episodes cannot be negative.');
    valid = false;
  } else if (!isNaN(episodes) && watched > episodes) {
    showFieldError('form-watched', 'error-watched', 'Cannot exceed total episodes (' + episodes + ').');
    valid = false;
  }

  // Enforce consistency between episode progress and manually selected status
  if (status === 'plan' && !isNaN(watched) && watched > 0) {
    showFieldError('form-watched', 'error-watched', 'Plan to Watch entries must have 0 watched episodes.');
    valid = false;
  } else if (status === 'completed' && !isNaN(episodes) && !isNaN(watched) && watched < episodes) {
    showFieldError('form-watched', 'error-watched', 'Completed anime must have all ' + episodes + ' episodes watched.');
    valid = false;
  } else if (status === 'watching' && !isNaN(episodes) && !isNaN(watched) && watched === episodes) {
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

// Hero "+ Add Anime" button
document.getElementById('hero-add-btn').addEventListener('click', openAddModal);

// Library "+ Add Anime" button
document.getElementById('library-add-btn').addEventListener('click', openAddModal);

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
  var totalEps = parseInt(document.getElementById('form-episodes').value, 10);
  var watched  = parseInt(document.getElementById('form-watched').value, 10) || 0;
  var status   = document.getElementById('form-status').value;
  var genre    = document.getElementById('form-genre').value.trim();

  // Clamp watched to totalEps (status consistency is already validated by validateForm)
  watched = Math.min(watched, totalEps);

  if (id) {
    // EDIT — update existing entry
    var anime = findAnimeById(id);
    if (anime) {
      anime.title      = title;
      anime.posterUrl  = poster;
      anime.totalEps   = totalEps;
      anime.watchedEps = watched;
      anime.status     = status;
      anime.genre      = genre;
    }
  } else {
    // ADD — create new entry
    var now = Date.now();
    state.library.push({
      id:         generateId(),
      title:      title,
      posterUrl:  poster,
      totalEps:   totalEps,
      watchedEps: watched,
      status:     status,
      genre:      genre,
      rating:     0,
      review:     '',
      notes:      '',
      addedAt:    now,
      updatedAt:  now
    });
  }

  hideModal('modal-overlay');
  stateCommit();
});


/* ── 5.3 Delete Modal ── */

var pendingDeleteId = null; // holds id of anime awaiting deletion

function openDeleteConfirm(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;
  pendingDeleteId = animeId;
  document.getElementById('confirm-anime-name').textContent = anime.title;
  showModal('confirm-overlay');
}

document.getElementById('confirm-close').addEventListener('click', function() { hideModal('confirm-overlay'); });
document.getElementById('confirm-cancel').addEventListener('click', function() { hideModal('confirm-overlay'); });

document.getElementById('confirm-overlay').addEventListener('click', function(e) {
  if (e.target === this) hideModal('confirm-overlay');
});

document.getElementById('confirm-delete').addEventListener('click', function() {
  if (!pendingDeleteId) return;
  // Remove the anime from the array
  state.library = state.library.filter(function(a) { return a.id !== pendingDeleteId; });
  if (state.currentAnimeId === pendingDeleteId) state.currentAnimeId = null;
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
    openAddModal();
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
  navigateTo('details');
});

// Close open modals with Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    hideModal('modal-overlay');
    hideModal('confirm-overlay');
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
  navigateTo('details');
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

  // Save notes (query freshly rendered button after stateCommit)
  document.getElementById('detail-save-notes').addEventListener('click', function() {
    var anime = findAnimeById(animeId);
    if (!anime) return;
    anime.notes = document.getElementById('detail-notes').value;
    stateCommit();
    var freshBtn = document.getElementById('detail-save-notes');
    if (freshBtn) flashSaved(freshBtn, 'Saved!');
  });

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
 * Automatically sets status to 'completed' when total is reached.
 * @param {string} animeId
 */
function incrementEpisode(animeId) {
  var anime = findAnimeById(animeId);
  if (!anime) return;
  if (anime.watchedEps >= anime.totalEps) return; // already at max

  anime.watchedEps += 1;

  // Auto-complete
  if (anime.watchedEps === anime.totalEps) {
    anime.status = 'completed';
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

  // If status was auto-completed and we go below total, revert to watching
  if (anime.status === 'completed' && anime.watchedEps < anime.totalEps) {
    anime.status = 'watching';
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


/* ── 5.8 Journal — TOC click & View Details button ── */

// Delegated on the TOC list
document.getElementById('journal-toc-list').addEventListener('click', function(e) {
  var item = e.target.closest('.toc-item');
  if (!item) return;
  document.querySelectorAll('.toc-item').forEach(function(i) { i.classList.remove('active'); });
  item.classList.add('active');
  var entry = document.getElementById('journal-entry-' + item.dataset.journalId);
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
  navigateTo('details');
});


/* ═══════════════════════════════════════════════════════════
   BOOT — initialise on page load
═══════════════════════════════════════════════════════════ */
stateInit();
renderAll();
syncFromHash();
console.log('[AniLog] Ready. Library:', state.library.length, 'entries.');
