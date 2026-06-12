# MacParakeet Sync

[![CI](https://github.com/andreagrandi/obsidian-macparakeet-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/andreagrandi/obsidian-macparakeet-sync/actions/workflows/ci.yml)

Obsidian plugin that syncs meeting transcripts, notes, and AI summaries from [MacParakeet](https://macparakeet.com) into your vault — one folder per meeting, fully local.

> **Status: in development.** No release has been published yet. Follow the [issues](https://github.com/andreagrandi/obsidian-macparakeet-sync/issues) for progress; the full design is in [PLAN.md](PLAN.md). This is an unofficial community plugin, not affiliated with the MacParakeet project.

## What it does

MacParakeet records and transcribes meetings locally on your Mac and generates AI summaries. This plugin pulls that content into Obsidian:

- **One folder per meeting**, e.g. `MacParakeet/Meetings/2026/06/2-Weekly Standup/`, containing a folder-note index, one file per AI result (`Summary.md`, `Action Items.md`, …), your typed meeting notes, and optionally the full transcript.
- **Incremental**: each sync makes one cheap CLI call and skips meetings that haven't changed. New AI summaries on old meetings show up as new files.
- **Archive semantics**: the vault is your archive. Deleting a meeting in MacParakeet (e.g. to free disk space) never deletes anything in your vault, and files you create inside a meeting folder are never touched.
- **Local-first**: everything happens on your machine via `macparakeet-cli`. No network, no accounts.

## Requirements

- macOS with [MacParakeet](https://macparakeet.com) installed (the CLI ships inside the app), **or** the standalone CLI: `brew install moona3k/tap/macparakeet-cli`
- Obsidian (desktop only — the plugin shells out to the CLI, which mobile can't do)

## Installation

The plugin is not yet in the community store. Once releases exist, you can install it before store approval via [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install the "BRAT" community plugin in Obsidian
2. BRAT settings → *Add beta plugin* → `andreagrandi/obsidian-macparakeet-sync`
3. Enable **MacParakeet Sync** in *Settings → Community plugins*

Manual install (from a [release](https://github.com/andreagrandi/obsidian-macparakeet-sync/releases)):

1. Download `main.js` and `manifest.json` from the latest release
2. Copy them into `<your vault>/.obsidian/plugins/macparakeet-sync/`
3. Reload Obsidian and enable the plugin

Or build from source:

    git clone https://github.com/andreagrandi/obsidian-macparakeet-sync
    cd obsidian-macparakeet-sync
    npm install
    npm run build
    # copy main.js + manifest.json into <vault>/.obsidian/plugins/macparakeet-sync/

## Usage

1. Open *Settings → MacParakeet Sync*. The plugin auto-detects `macparakeet-cli` (Homebrew paths, then the app bundle at `/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli`); set the path manually if needed. A health check confirms the connection.
2. Choose a **base folder** (default `MacParakeet`) and optionally adjust the **path template** (default `Meetings/{year}/{month}/{n}-{title}`).
3. Pick what to sync: **AI results** (on), **meeting notes** (on), **full transcript** (off by default — transcripts are long).
4. Sync runs automatically on launch and every 30 minutes (configurable, `0` disables), or on demand via the ribbon icon / `Sync now` command.

Only meetings created on or after the **"sync since"** date (default: install date) are imported — move the date back to backfill history deliberately.

### Path template tokens

`{year}` · `{month}` (zero-padded) · `{monthName}` · `{day}` · `{date}` (YYYY-MM-DD) · `{n}` (per-month number) · `{title}` (sanitized). Unknown tokens are left as-is.

### Commands

| Command | What it does |
|---|---|
| `Sync now` | Run a sync and report `X new, Y updated, Z unchanged` |
| `Check connection` | Verify the CLI is reachable and show the meeting count |
| `Force re-sync` | Re-process all in-scope meetings (picks up in-place regenerated summaries) |

### Good to know

- Synced files are **mirrors** of MacParakeet content and get overwritten when the source changes — keep your own thoughts in separate notes (any file you add to a meeting folder is left alone).
- Folder numbering (`{n}`) is assigned once per meeting and never changes, so links to meeting folders never break.
- Toggling content types on applies to meetings synced from then on; existing folders are not rewritten retroactively.
- Deletions never propagate: removing a meeting in MacParakeet leaves its vault folder intact.

## How it works

The plugin never reads MacParakeet's database. It only talks to `macparakeet-cli` — the versioned public contract — using `meetings list/show/results list --json`, and tracks sync state (numbering, per-file ownership, change snapshots) in the plugin's `data.json`. Details in [PLAN.md](PLAN.md).

## Development

    npm install
    npm run dev    # esbuild watch mode
    npm test       # vitest unit tests
    npm run build  # typecheck + production bundle

CI (GitHub Actions) runs build + tests on every push and PR.

## License

[MIT](LICENSE)
