# AniLOG — Personal Anime Tracker & Journal

A monochrome, manga-inspired personal anime tracker and memory journal that runs 100% in your browser with zero backend.

**Live Demo:** https://shashank0860.github.io/AniLOG/

---

## Features

- **AniList Catalogue Search & Manual Entry**: Search anime via AniList's public GraphQL API (350 ms debounce, request cancellation via `AbortController`, adult-content filtering, duplicate detection, ongoing/movie support) or add entries manually.
- **Dashboard**: Overview stats, **Currently Watching** quick `+ EP` increment cards, **Recently Completed** list, and one-click **Load Demo Data** / **Remove Demo Data** when exploring.
- **My Library**: Search by title, filter by status (`All`, `Watching`, `Completed`, `Plan to Watch`, `Dropped`), and sort by Date Added, Title A–Z, Rating (unrated last), or Progress (ongoing/unknown last).
- **Anime Details (`#details/<id>`)**: Episode progress tracker (`+ Episode` / `− Episode`), 1–10 star rating widget, personal review editor, and multi-quote **Favourite Quotes** collection with speaker & episode metadata.
- **My Journal**: Editorial archive with `All`, `Reviews`, and `Quotes` filter tabs, manga-panel quote compositions, and a Table of Contents sidebar.
- **Data Protection & Backups**: Schema-versioned `localStorage` persistence (`schemaVersion: 2`) with corrupt-data backup recovery and **Export Data** / **Import Data** (Merge by ID or Replace All) JSON backups.

---

## Tech Stack

- **HTML5**, **CSS3**, and **Vanilla JavaScript** (no framework, no bundler, no build step)
- **No backend**: all data stays locally in your browser's `localStorage`
- **AniList Public GraphQL API** (`https://graphql.anilist.co`) for catalogue lookup

---

## How Data Is Stored & Backed Up

- All library, review, and quote data is stored in `localStorage` under the key `anilog_library` as `{ schemaVersion: 2, library: [...] }`.
- Legacy v1 array records are migrated automatically and non-destructively on load.
- If `localStorage` contains corrupted JSON, the raw string is preserved under `anilog_library:corrupt-backup` and a warning toast is shown.
- Use **Export Data** in the footer to download `anilog-backup-YYYY-MM-DD.json`, and **Import Data** to restore or merge backups.

---

## Running Locally

No build step or dependencies are needed:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080/` in your browser.

---

## Project Structure

```text
AniLOG/
├── index.html          # Semantic SPA shell, modals, and metadata
├── style.css           # Monochrome manga editorial styles & responsive layout
├── app.js              # Storage, state, helpers, renderers, routing, and events
├── favicon.svg         # Monochrome kanji favicon
├── tests/
│   └── unit.test.js    # Node unit tests for storage, progress, validation, and sorting
├── LICENSE             # MIT License
└── README.md
```

---

## Screenshots

> **TODO:** Add desktop and mobile screenshots of the Dashboard, Library, and Journal Quotes view (plus a `1200x630` `og-image.png` if desired).

---

## Credits

- Anime metadata and cover images are fetched from [AniList's public GraphQL API](https://anilist.co). AniLOG is an independent personal project and is **not affiliated with or endorsed by AniList**.

---

## Known Limitations & Roadmap

- **Browser-only storage**: Clearing browser site data deletes your library unless you export a JSON backup first.
- **Offline search**: AniList search requires an internet connection; manual entry works offline.
- **Roadmap**: Optional `og:image` preview banner, keyboard shortcut cheat-sheet, and additional journal export formats (Markdown).
