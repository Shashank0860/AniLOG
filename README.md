# AniLog — Personal Anime Tracker & Journal

> A black-and-white, manga-styled personal anime tracking and journaling web application built with pure HTML5, CSS3, and Vanilla JavaScript.

---

## Project Overview

**AniLog** is a lightweight, zero-dependency, client-side anime tracker designed like a Japanese editorial manga publication. It lets users maintain a personal anime library, track episode progress, rate shows on a 10-point scale, and write personal reviews and notes—all persisted automatically in the browser via `localStorage`.

---

## Features

- **AniList Catalogue Search & Integration**:
  - Live search against the public AniList GraphQL API (`https://graphql.anilist.co`) with a 400ms debounce.
  - Displays cover image, English/Romaji title, release year, format (TV, Movie, OVA, ONA, Special), episode count, and airing status.
  - Step-by-step add workflow: select a title, set initial tracking status, current episode progress, and optional 0–10 rating.
  - Duplicate prevention by AniList ID with link to existing library entry.
  - Support for ongoing series with unknown/null episode totals and specialized handling for movies.
  - Option to fall back to manual anime entry at any time.
- **Dashboard**:
  - Manga-inspired hero section with halftone screentone textures and conic speed lines.
  - Live statistics strip: **Total Anime**, **Episodes Watched**, **Completed**, **Watching**, and **Plan to Watch**.
  - **Currently Watching** quick-progress cards with one-click `+ EP` increment.
  - **Recently Completed** feed with star summaries.
- **My Library**:
  - Responsive comic-panel anime grid with poster support and automatic kanji placeholder fallback.
  - Real-time search by title, status tab/dropdown filtering (`All`, `Watching`, `Completed`, `Plan to Watch`, `Dropped`), and sorting (`Date Added`, `Title A–Z`, `Rating`, `Progress`).
  - Helpful empty states with quick actions.
- **Anime Details**:
  - Full episode progress tracker (`+ Episode` / `− Episode`) with automatic completion when `watched === total`.
  - Interactive 1–10 star rating widget.
  - Lined-paper review and personal notes editors with save confirmation.
  - Edit Entry and Delete Entry (with confirmation modal).
- **My Journal**:
  - Automatically aggregates all anime that have a written review into an editorial journal feed with a sticky Table of Contents sidebar.
- **Validation & Reliability**:
  - Inline form validation preventing empty titles, duplicate entries, invalid episode counts, negative numbers, or malformed URLs.
  - Safe `localStorage` parsing and sanitization.

---

## Technologies Used

- **HTML5** — Semantic single-page structure and accessible modal dialogs.
- **CSS3** — Custom properties, CSS Grid/Flexbox, halftone dot patterns, conic-gradient speed lines, lined-paper gradients, and responsive breakpoints.
- **Vanilla JavaScript (ES5/ES6)** — Modular Storage, State, Helpers, Render, and Events architecture.
- **Web Storage API (`localStorage`)** — Automatic client-side persistence.

---

## Folder Structure

```text
AniLOG/
├── index.html   # App shell: 4 sections, Add/Edit & Delete modals, semantic markup
├── style.css    # Manga editorial design system, layout, modals, responsive rules
├── app.js       # Storage, State, Helpers, Render, and Event handlers
└── README.md    # Project documentation
```

---

## How to Run the Application

No build step or backend is required.

1. **Direct file**: Open `index.html` directly in any modern web browser.
2. **Local server (recommended)**:
   ```bash
   python -m http.server 8080
   ```
   Then open `http://localhost:8080/index.html` in your browser.

---

## How LocalStorage Is Used

All user data is stored under a single key: **`anilog_library`**.

- **Loading (`storageLoad`)**: On startup (`stateInit`), `app.js` reads `localStorage.getItem('anilog_library')`, parses the JSON array, and sanitizes each entry (ensuring valid titles, clamped episode counts, valid statuses, and numeric ratings). Invalid or missing data safely falls back to an empty library `[]`.
- **Saving (`storageSave`)**: Every mutation (add, edit, delete, episode `+`/`−`, rating change, review/notes save) calls `stateCommit()`, which writes `JSON.stringify(state.library)` to `localStorage` and re-renders the UI.

Each anime entry follows this structure:

```json
{
  "id": "m3k9x1a2b",
  "title": "Frieren: Beyond Journey's End",
  "posterUrl": "",
  "totalEps": 28,
  "watchedEps": 10,
  "status": "watching",
  "genre": "Fantasy",
  "rating": 9,
  "review": "A quiet masterpiece about time and memory.",
  "notes": "Currently at episode 10",
  "addedAt": 1795700000000
}
```

---

## Screenshots

- **AniList Catalogue Search & Integration**:
  - Live search against the public AniList GraphQL API (`https://graphql.anilist.co`) with a 400ms debounce.
  - Displays cover image, English/Romaji title, release year, format (TV, Movie, OVA, ONA, Special), episode count, and airing status.
  - Step-by-step add workflow: select a title, set initial tracking status, current episode progress, and optional 0–10 rating.
  - Duplicate prevention by AniList ID with link to existing library entry.
  - Support for ongoing series with unknown/null episode totals and specialized handling for movies.
  - Option to fall back to manual anime entry at any time.
- **Dashboard**: Manga hero, 5-stat black strip, Currently Watching & Recently Completed panels.
- **My Library**: Search bar, status tabs, and responsive 2:3 anime card grid.
- **Anime Details**: Episode progress tracker, 10-star rating widget, and lined-paper review/notes editors.
- **My Journal**: Editorial review feed with sticky Table of Contents sidebar.
