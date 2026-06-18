# Meeting Notes Sync

[![CI](https://github.com/andreagrandi/obsidian-meeting-notes-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/andreagrandi/obsidian-meeting-notes-sync/actions/workflows/ci.yml)

Obsidian plugin that syncs your meeting transcripts, notes, and AI summaries into your vault — from [MacParakeet](https://macparakeet.com) and [Fellow](https://fellow.app), one folder per meeting. A meeting recorded by both sources merges into a single folder instead of duplicating.

> **Status: beta** — releases are published on GitHub (install via [BRAT](#installation)); community-store submission is pending review. Full design in [PLAN.md](PLAN.md). Unofficial; not affiliated with MacParakeet or Fellow.

## What it does

- **One folder per meeting**, with a folder-note index plus the meeting's artifacts. Each artifact is tagged by source (`Summary (MacParakeet).md`, `Summary (Fellow).md`), so a meeting captured by both stays unambiguous.
- **Cross-source merge**: meetings recorded by both sources land in one folder, matched by time-interval overlap (title similarity breaks ties). The index carries both source ids and the meeting interval; uncertain matches are flagged `merge-confidence: low` for review.
- **Incremental & non-destructive**: each sync skips unchanged meetings, and a late Fellow recap merges into the folder MacParakeet already made. The vault is your archive — deleting a meeting in a source never touches your vault, and files you add to a meeting folder are left alone.

```
Meetings/2026/06 - June/2 - Weekly Standup - Jun 11th/
  2 - Weekly Standup - Jun 11th.md     ← index: macparakeet-id + fellow-id + interval
  Summary (MacParakeet).md
  Transcript (MacParakeet).md
  Notes.md
  Summary (Fellow).md
  Action Items (Fellow).md
  Transcript (Fellow).md
```

## Sources

Each source is toggled independently; a disabled source is completely inert — no requests, writes, or notices.

### MacParakeet — local CLI, opt-in

Reads meetings from `macparakeet-cli` (no network, no accounts, no database access). Requires macOS with [MacParakeet](https://macparakeet.com) installed (the CLI ships inside the app) or the standalone CLI (`brew install moona3k/tap/macparakeet-cli`), and Obsidian desktop. The plugin auto-detects the CLI (Homebrew paths, then the app bundle); override the path in settings if needed, and the health check confirms it. Enable it in *Settings → Meeting Notes Sync*.

### Fellow — REST API, opt-in

Polls Fellow's REST Developer API for cloud AI recaps. Setup:

1. A **paid Fellow plan**, with a workspace **admin enabling the API** (*Workspace Settings → Security*).
2. Generate a **personal API key** (*User Settings → Developer Tools*) — scoped to what you can see, revocable, audit-logged.
3. In *Settings → Meeting Notes Sync*: enable Fellow, enter your **subdomain** (the `acme` in `acme.fellow.app`) and **key**, then use **Check connection** to verify.

> ⚠️ The Fellow key is stored in plaintext in `data.json` (standard for API-backed plugins). If your vault is in git or a synced folder, exclude that file and treat the key as a secret; revoke it in Fellow if it leaks.

## Installation

Not yet in the community store — install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (*Add beta plugin* → `andreagrandi/obsidian-meeting-notes-sync`), or manually drop `main.js` + `manifest.json` from a [release](https://github.com/andreagrandi/obsidian-meeting-notes-sync/releases) into `<vault>/.obsidian/plugins/meeting-notes-sync/` and enable the plugin. To build from source:

    git clone https://github.com/andreagrandi/obsidian-meeting-notes-sync
    cd obsidian-meeting-notes-sync && npm install && npm run build
    # copy main.js + manifest.json into <vault>/.obsidian/plugins/meeting-notes-sync/

### Migrating from "MacParakeet Sync"

If you used an earlier build under the `macparakeet-sync` id: quit Obsidian, rename `<vault>/.obsidian/plugins/macparakeet-sync/` → `meeting-notes-sync/`, reopen, and re-enable. This keeps `data.json` (numbering, snapshots, file ownership) so the next sync is a no-op instead of re-importing. Existing folders keep their names; only new artifacts get the source suffix.

## Settings & usage

Sync runs shortly after launch and every 30 minutes (configurable; `0` disables), or on demand via the ribbon icon / **Sync now**. The main settings:

- **Sources** — enable MacParakeet and/or Fellow (see above).
- **Base folder** — where meeting folders go (empty = vault root, so the default template's `Meetings/…` is the root).
- **Path template** — folder path per meeting (see tokens below).
- **Content** — AI results (on), meeting notes (on), full transcript (off; transcripts are long). Applies to every source.
- **Sync since** — only meetings on/after this date import (default: install date). Move it back to backfill history.

### Path template tokens

`{year}` · `{month}` · `{monthName}` (June) · `{monthShort}` (Jun) · `{day}` · `{dayOrdinal}` (2nd) · `{date}` (YYYY-MM-DD) · `{n}` (per-month number) · `{title}`. Unknown tokens are left as-is.

Default: `Meetings/{year}/{month} - {monthName}/{n} - {title} - {monthShort} {dayOrdinal}` → `Meetings/2026/06 - June/4 - Core sync-discovery - Jun 2nd`. The trailing date disambiguates recurring meetings that share a title.

### Merge tuning

**Overlap threshold** (fraction of the shorter meeting, default 0.5) and **minimum overlap (minutes)** govern when two sources' meetings are treated as one. Raise them to merge more conservatively.

### Commands

| Command | What it does |
|---|---|
| `Sync now` | Sync enabled sources; reports `X new, Y updated, Z unchanged` |
| `Check connection` | Verify `macparakeet-cli` is reachable (Fellow's check lives in settings) |
| `Force re-sync` | Re-process all in-scope meetings (picks up in-place regenerated summaries) |

### Good to know

- Numbering (`{n}`) and the folder name are frozen on first import and never change — a later source merges in without renumbering.
- Synced files are **mirrors** and get overwritten when the source changes; keep your own thoughts in separate files. Toggling content types or sources on applies going forward, not retroactively.
- A failing source (e.g. a revoked Fellow key) shows one Notice without blocking the others, and is reported by the settings connection check.

## How it works

Each source sits behind a common adapter and a source-agnostic engine: MacParakeet via `macparakeet-cli` (`meetings list/show/results list --json`), Fellow via its REST API (`/me`, `/recordings`, `/recording/{id}`, `/note/{id}`) with `updated_at` change detection. Meetings are merged across sources by interval overlap, and sync state (numbering, per-file ownership, per-source snapshots) lives in `data.json`. Details in [PLAN.md](PLAN.md).

## Development

    npm install
    npm run dev     # esbuild watch
    npm test        # vitest
    npm run build   # typecheck + production bundle

CI runs build + tests on every push and PR.

**Live Fellow test** — `npx -y tsx scripts/fellow-live-test.mts` runs the real engine (local CLI + live Fellow API) into a temp vault. It reads `FELLOW_SUBDOMAIN` / `FELLOW_API_KEY` from `.env` (see `.env.example`) for the harness only; the plugin itself never reads the environment — end users configure the subdomain and key in the settings UI.

**Releasing** — `npm run release <major.minor.patch>` (e.g. `npm run release 0.2.2`) bumps `package.json`, `manifest.json`, `versions.json`, and the lockfile, then commits and creates the unprefixed `X.Y.Z` tag. Push it (`git push origin master && git push origin <version>`) to trigger `.github/workflows/release.yml`, which attaches `main.js` + `manifest.json` + `versions.json` to a GitHub release. A plain `npm run` script is used (not the `npm version` lifecycle hook) so it works regardless of a global `ignore-scripts=true`. Community-store submission to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) is a one-time manual step after the first release.

## License

[MIT](LICENSE)
