# Meeting Notes Sync

[![CI](https://github.com/andreagrandi/obsidian-meeting-notes-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/andreagrandi/obsidian-meeting-notes-sync/actions/workflows/ci.yml)

Obsidian plugin that syncs meeting transcripts, notes, and AI summaries into your vault — from [MacParakeet](https://macparakeet.com) and [Fellow](https://fellow.app), one folder per meeting. Meetings recorded by both sources merge into a single folder instead of duplicating.

> **Status: in development.** No release has been published yet. Follow the [issues](https://github.com/andreagrandi/obsidian-meeting-notes-sync/issues) for progress; the full design is in [PLAN.md](PLAN.md). This is an unofficial community plugin, not affiliated with MacParakeet or Fellow.

## What it does

The plugin ingests meeting content from one or more sources and writes it into Obsidian:

- **One folder per meeting**, e.g. `Meetings/2026/06 - June/2 - Weekly Standup/`, containing a folder-note index plus the meeting's artifacts.
- **Artifacts attributed by source**: each file is tagged with the source it came from (`Summary (MacParakeet).md`, `Summary (Fellow).md`, …), so a meeting captured by both stays unambiguous. Your MacParakeet-typed notes stay in `Notes.md`.
- **Cross-source merge**: a meeting recorded by both MacParakeet and Fellow lands in **one** folder. Matching is by time-interval overlap (with title similarity as a tiebreaker); the index links every source's artifacts and records both ids and the meeting interval. Uncertain matches are flagged `merge-confidence: low` in frontmatter for manual review.
- **Incremental**: each sync skips meetings that haven't changed. New AI summaries on old meetings show up as new files. A late-arriving Fellow recap merges into the folder MacParakeet already created.
- **Archive semantics**: the vault is your archive. Deleting a meeting in a source never deletes anything in your vault, files you create inside a meeting folder are never touched, and disabling a source never rewrites already-imported content.

A merged meeting folder looks like:

    Meetings/2026/06 - June/2 - Weekly Standup/
      2 - Weekly Standup.md          ← index: macparakeet-id + fellow-id + interval
      Summary (MacParakeet).md
      Transcript (MacParakeet).md
      Notes.md
      Summary (Fellow).md
      Action Items (Fellow).md
      Transcript (Fellow).md

## Sources

Each source is enabled independently in settings. A disabled source is completely inert — no requests, no writes, no notices.

### MacParakeet (local CLI) — on by default

MacParakeet records and transcribes meetings locally on your Mac and generates AI summaries. The plugin reads them through `macparakeet-cli`, the versioned public contract — no network, no accounts, no database access.

- macOS with [MacParakeet](https://macparakeet.com) installed (the CLI ships inside the app), **or** the standalone CLI: `brew install moona3k/tap/macparakeet-cli`
- Obsidian desktop only — the plugin shells out to the CLI, which mobile can't do.

In *Settings → Meeting Notes Sync*, the plugin auto-detects `macparakeet-cli` (Homebrew paths, then the app bundle at `/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli`); set the path manually if needed. A health check confirms the connection.

### Fellow (REST API) — off by default, strictly opt-in

[Fellow](https://fellow.app) records meetings and generates AI recaps in the cloud. The plugin polls Fellow's REST Developer API (no CLI exists), via Obsidian's network layer.

Prerequisites:

1. A **paid Fellow plan**.
2. A workspace **admin enables the API** (*Workspace Settings → Security*).
3. You generate a **personal API key** (*User Settings → Developer Tools*). The key is scoped to what you can see in Fellow, is revocable, and is audit-logged.

Then, in *Settings → Meeting Notes Sync*:

1. Enable the **Fellow source**.
2. Enter your **workspace subdomain** (the `acme` in `acme.fellow.app`) and **API key**.
3. **Check connection** verifies the key against Fellow and shows your workspace.

> ⚠️ **API-key storage.** The Fellow key is stored in plaintext in `<your vault>/.obsidian/plugins/meeting-notes-sync/data.json` — standard for API-backed community plugins, but it means anyone with the file has the key. If your vault is in git or a synced folder, gitignore/exclude that file and treat the key as a secret. Revoke it in Fellow if it leaks.

## Installation

The plugin is not yet in the community store. Once releases exist, you can install it before store approval via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install the "BRAT" community plugin in Obsidian
2. BRAT settings → *Add beta plugin* → `andreagrandi/obsidian-meeting-notes-sync`
3. Enable **Meeting Notes Sync** in *Settings → Community plugins*

Manual install (from a [release](https://github.com/andreagrandi/obsidian-meeting-notes-sync/releases)):

1. Download `main.js` and `manifest.json` from the latest release
2. Copy them into `<your vault>/.obsidian/plugins/meeting-notes-sync/`
3. Reload Obsidian and enable the plugin

Or build from source:

    git clone https://github.com/andreagrandi/obsidian-meeting-notes-sync
    cd obsidian-meeting-notes-sync
    npm install
    npm run build
    # copy main.js + manifest.json into <vault>/.obsidian/plugins/meeting-notes-sync/

### Migrating from "MacParakeet Sync"

If you ran an earlier build under the old `macparakeet-sync` plugin id, carry your sync state over so the next sync is a no-op instead of re-importing every meeting:

1. Quit Obsidian completely.
2. Rename `<your vault>/.obsidian/plugins/macparakeet-sync/` → `meeting-notes-sync/`.
3. Reopen Obsidian and re-enable the plugin.

This preserves `data.json` — folder numbering, change snapshots, and which files the plugin owns. Existing meeting folders keep their original filenames; only newly synced artifacts get the source suffix.

## Usage

1. Open *Settings → Meeting Notes Sync* and enable the sources you want (MacParakeet on by default; Fellow opt-in, see above).
2. Choose a **base folder** (empty by default, so meetings land under `Meetings/…` straight from the path template) and optionally adjust the **path template** (default `Meetings/{year}/{month} - {monthName}/{n} - {title}`).
3. Pick what to sync: **AI results** (on), **meeting notes** (on), **full transcript** (off by default — transcripts are long). These apply to every enabled source.
4. Sync runs automatically on launch and every 30 minutes (configurable, `0` disables), or on demand via the ribbon icon / `Sync now` command.

Only meetings created on or after the **"sync since"** date (default: install date) are imported — move the date back to backfill history deliberately.

### Merge tuning

Two advanced settings control when meetings from different sources are treated as the same meeting: the **overlap threshold** (minimum overlap as a fraction of the shorter meeting, default 0.5) and the **minimum overlap (minutes)** floor. Raise them to merge more conservatively.

### Path template tokens

`{year}` · `{month}` (zero-padded) · `{monthName}` (June) · `{monthShort}` (Jun) · `{day}` (zero-padded) · `{dayOrdinal}` (2nd) · `{date}` (YYYY-MM-DD) · `{n}` (per-month number) · `{title}` (sanitized). Unknown tokens are left as-is.

The default template ends with `- {monthShort} {dayOrdinal}` so each folder carries its date (e.g. `4 - Core sync-discovery - Jun 2nd`), which disambiguates recurring meetings that share a title.

### Commands

| Command | What it does |
|---|---|
| `Sync now` | Run a sync across enabled sources and report `X new, Y updated, Z unchanged` |
| `Check connection` | Verify `macparakeet-cli` is reachable and show the meeting count (Fellow's connection check lives in settings) |
| `Force re-sync` | Re-process all in-scope meetings (picks up in-place regenerated summaries) |

### Good to know

- Synced files are **mirrors** of source content and get overwritten when the source changes — keep your own thoughts in separate notes (any file you add to a meeting folder is left alone).
- Folder numbering (`{n}`) is assigned once per meeting and never changes; the first source to import a meeting freezes its folder and number, and a later source merges in without renumbering.
- Toggling content types or sources on applies to meetings synced from then on; existing folders are not rewritten retroactively, and disabling a source leaves its already-imported content in place.
- Deletions never propagate: removing a meeting in a source leaves its vault folder intact.
- A failing source (e.g. a revoked Fellow key) surfaces one Notice without blocking the other sources, and is reported in settings via the connection check.

## How it works

The plugin keeps each source behind a common adapter and a source-agnostic sync engine. MacParakeet is read via `macparakeet-cli` (`meetings list/show/results list --json`); Fellow is polled via its REST Developer API (`/me`, `/recordings`, `/recording/{id}`, `/note/{id}`) using `updated_at` for change detection. Identity resolution merges meetings across sources by interval overlap, and sync state (numbering, per-file ownership, per-source change snapshots) lives in the plugin's `data.json`. Details in [PLAN.md](PLAN.md).

## Development

    npm install
    npm run dev    # esbuild watch mode
    npm test       # vitest unit tests
    npm run build  # typecheck + production bundle

CI (GitHub Actions) runs build + tests on every push and PR.

### Live Fellow test (optional)

A throwaway harness runs the real sync engine — your local `macparakeet-cli`
plus the live Fellow API — into a temp vault, for verifying the Fellow
integration against real data without touching your real vault:

    cp .env.example .env    # then fill in FELLOW_SUBDOMAIN and FELLOW_API_KEY
    npx -y tsx scripts/fellow-live-test.mts

`FELLOW_SUBDOMAIN` / `FELLOW_API_KEY` are read from `.env` (gitignored) for this
harness only. The plugin itself never reads the environment — end users
configure the subdomain and key in the settings UI, which persists them to
`data.json`.

### Releasing

Releases are cut by pushing a semver tag. `npm version` bumps the version in
`package.json`, mirrors it into `manifest.json`, and records the
`version -> minAppVersion` pair in `versions.json` (via `version-bump.mjs`):

    npm version patch    # or: minor / major
    git push && git push --tags

Pushing the tag (e.g. `0.2.0`) triggers `.github/workflows/release.yml`, which
builds and creates a GitHub release with `main.js`, `manifest.json`, and
`versions.json` attached — the assets BRAT and manual installs need.

Community-store submission (a PR adding the plugin to `community-plugins.json`
in [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases))
is a one-time manual step done by the maintainer after the first release.

## License

[MIT](LICENSE)
