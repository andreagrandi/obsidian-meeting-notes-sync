# MacParakeet Sync — Implementation Plan

> Status: **ACTIVE** — plan approved for later implementation. No code exists yet; coding starts only on explicit go-ahead.
>
> Plugin name: **MacParakeet Sync** · Plugin ID: `macparakeet-sync` · Repo: `obsidian-macparakeet-sync`

## 1. Context & Goal

MacParakeet (macOS local-first voice app) records meetings and stores transcripts, user notes, and AI prompt results ("summaries") in its SQLite database. This plugin syncs that meeting content into an Obsidian vault as markdown, one folder per meeting.

The plugin is fully independent of the MacParakeet codebase: it consumes only `macparakeet-cli`, the semver-versioned public contract (CLI 2.x at time of writing — see `Sources/CLI/CHANGELOG.md` upstream). It never reads `macparakeet.db` directly (internal schema, migration churn).

**Why CLI, not DB:** the CLI is documented for downstream integrations (`integrations/README.md` upstream), emits stable JSON, and is installed on every user's machine — bundled inside the app at `/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli` and also distributed standalone via `brew install moona3k/tap/macparakeet-cli`.

## 2. Decisions (settled during plan interview, 2026-06-12)

| Topic | Decision |
|---|---|
| Vault layout | One **folder per meeting**: `<base folder>/<path template>`, default template `Meetings/{year}/{month}/{n}-{title}` |
| Path config | Two settings: base folder + token template. Tokens: `{year}`, `{month}` (zero-padded), `{monthName}`, `{day}`, `{date}` (YYYY-MM-DD), `{n}`, `{title}` |
| Numbering `n` | Per-`{year}/{month}` counter, assigned at **first sync** in sync order, persisted in plugin state, **never reassigned**. Late-synced older meetings get the next free number in their month |
| Folder contents | Folder note index named like the folder (`{n}-{title}.md` — folder-note plugin compatible) + `Transcript.md` + `Notes.md` + one file per AI result named after its prompt |
| Update semantics | Plugin-owned files are **mirrors**: overwritten whenever source content changes. Files the plugin didn't create (user's own notes in the folder) are **never touched**. User does not hand-edit imported files; formatting changes go through plugin updates |
| New content | Always flows: a new AI result on an already-synced meeting becomes a new file on the next sync |
| Config retroactivity | Content toggles apply to meetings **as they are processed** (new or changed). Unchanged already-synced meetings are never re-touched just because a toggle changed — no proactive backfill |
| Backfill scope | "Sync meetings since" date setting, default = plugin install date. Move it back to import history deliberately |
| Content toggles | AI results **ON**, Meeting notes **ON**, Transcript **OFF** (transcripts are huge; opt-in) |
| Triggers | Manual command + ribbon icon; interval setting in minutes (default **30**, `0` disables); on-launch sync ~15 s after startup; single-flight guard |
| Incremental sync | One `meetings list --json` per sync; skip meetings whose `(updatedAt, promptResultCount)` match stored state — no detail fetches for unchanged meetings |
| Deletions | Never propagate. Vault is the archive; deleting a meeting in MacParakeet (e.g. to free disk) leaves the vault folder untouched. Out-of-scope meetings are ignored |
| Platform | Desktop-only (`isDesktopOnly: true`), macOS in practice (MacParakeet is macOS-only) |

## 3. Architecture

```
┌────────────────────────────── Obsidian (Electron) ───────────────────────────────┐
│  main.ts (Plugin)                                                                │
│   ├─ SettingsTab            settings UI                                          │
│   ├─ SyncScheduler          on-launch delay · interval timer · manual command    │
│   └─ SyncEngine             orchestrates one sync run (single-flight)            │
│        ├─ CliBridge         discovers + spawns macparakeet-cli, parses JSON      │
│        ├─ SyncState         data.json: counters, per-meeting records             │
│        ├─ PathPlanner       template → sanitized vault paths, n assignment       │
│        └─ NoteRenderer      JSON → markdown files (index, transcript, notes,     │
│                             one file per AI result) via Vault API                │
└───────────────────────────────────────────────────────────────────────────────────┘
                       │ child_process.execFile (JSON over stdout)
                       ▼
              macparakeet-cli  ──reads──►  ~/Library/Application Support/MacParakeet/macparakeet.db
```

### CLI surface used (the entire upstream contract we depend on)

| Call | Purpose | Key JSON fields |
|---|---|---|
| `health --json` | Validate CLI path at startup/settings change | db accessibility |
| `meetings list --limit 500 --json` | One per sync; change detection | `id`, `shortID`, `title`, `status`, `createdAt`, `updatedAt`, `durationMs`, `hasNotes`, `promptResultCount` |
| `meetings show <id> --json` | Fetch details for new/changed meetings | transcript (clean/raw), `userNotes`, speakers, engine, metadata |
| `meetings results list <id> --json` | Fetch AI results | per result: `id`, `name`, `content`, `promptContent`, `createdAt`, `updatedAt` |

Notes:
- `--limit 500` then client-side filter `status == "completed" && createdAt >= syncSince`. 500 is an internal cap, revisit if ever insufficient.
- Spawn with `execFile` (no shell), explicit binary path, reasonable timeout (e.g. 30 s), parse stdout as JSON, treat non-zero exit / `{"ok":false,...}` envelope as a sync failure for that step.

### CLI discovery (in order)

1. Manual override path from settings, if set.
2. `macparakeet-cli` resolved from common locations: `/opt/homebrew/bin`, `/usr/local/bin` (Electron does not inherit the user's shell `$PATH` — check these explicitly).
3. App bundle fallback: `/Applications/MacParakeet.app/Contents/MacOS/macparakeet-cli`.

Whichever resolves first is validated with `health --json`; result and resolved path shown in settings.

## 4. Settings

| Setting | Type | Default |
|---|---|---|
| CLI path override | text (path) | empty (auto-discover) |
| Base folder | text (vault path) | `MacParakeet` |
| Path template | text | `Meetings/{year}/{month}/{n}-{title}` |
| Sync meetings since | date | plugin install date |
| Sync AI results | toggle | on |
| Sync meeting notes | toggle | on |
| Sync transcript | toggle | **off** |
| Sync interval (minutes, 0 = off) | number | 30 |
| Sync on launch | toggle | on |

Settings live in `data.json` alongside sync state (standard `loadData`/`saveData`).

## 5. Plugin state (`data.json`)

```jsonc
{
  "settings": { /* §4 */ },
  "state": {
    "counters": { "2026/06": 3 },          // next n per {year}/{month} bucket
    "meetings": {
      "<meeting-uuid>": {
        "folderPath": "MacParakeet/Meetings/2026/06/2-Weekly Standup",
        "n": 2,
        "bucket": "2026/06",
        "snapshot": { "updatedAt": "...", "promptResultCount": 3 },   // skip check
        "files": {
          "index":      { "path": ".../2-Weekly Standup.md", "sourceUpdatedAt": "..." },
          "transcript": { "path": ".../Transcript.md", "sourceUpdatedAt": "..." },
          "notes":      { "path": ".../Notes.md", "sourceUpdatedAt": "..." },
          "result:<result-id>": { "path": ".../Summary.md", "sourceUpdatedAt": "..." }
        }
      }
    }
  }
}
```

- `files` is the authoritative list of plugin-owned paths — **only** these are ever written/overwritten. Anything else in the folder belongs to the user.
- `counters` + per-meeting `n` make numbering immutable across re-syncs and backfills.

## 6. Sync algorithm (one run)

1. **Guard**: if a sync is already running, return (single-flight).
2. **Resolve CLI** (cached after first success); on failure → Notice (manual sync) / quiet console + one non-spammy Notice (background), abort.
3. `meetings list --limit 500 --json` → filter `status == completed` and `createdAt >= syncSince`.
4. For each meeting, diff against `state.meetings[id].snapshot`:
   - **Unknown id** → NEW. **Known but `updatedAt` or `promptResultCount` differ** → CHANGED. **Else** → skip (no further I/O).
5. For each NEW meeting:
   - Fetch `show` + (if results toggle on) `results list`.
   - Assign `n` from the meeting's `{year}/{month}` bucket counter (from `createdAt`), increment counter.
   - Build folder path from template; sanitize `{title}`; create folder.
   - Render and write: index note, plus `Transcript.md` / `Notes.md` / one file per result, **per current toggles**.
   - Record snapshot + files in state.
6. For each CHANGED meeting:
   - Fetch details; for every artifact enabled by **current** toggles:
     - Artifact tracked in `files` and source newer → overwrite file.
     - Artifact not yet tracked (new result, or toggle newly on and content is new/changed) → create file, track it.
   - Files in `files` are never deleted, user files never touched. Update snapshot.
7. **Persist state**, then report: manual sync → Notice `"MacParakeet Sync: 2 new, 1 updated, 14 unchanged"`; background → console log, Notice only on errors (once per failure streak, not every 30 min).

**Known limitation (documented, accepted):** a result *regenerated in place* (same `promptResultCount`, and transcription `updatedAt` not bumped) may not be detected by the cheap diff. Escape hatch: a `Force re-sync MacParakeet meetings` command that treats all in-scope meetings as CHANGED.

## 7. Vault output

### Folder

`MacParakeet/Meetings/2026/06/2-Weekly Standup/`

### Index note — `2-Weekly Standup.md` (folder note)

```markdown
---
macparakeet-id: 550e8400-e29b-41d4-a716-446655440000
type: macparakeet-meeting
date: 2026-06-12T10:00:00Z
duration: 47m
engine: parakeet
---

# Weekly Standup

- [[Summary]] · [[Action items]]
- [[Notes]]
- [[Transcript]]
```

(Links rendered only for files that exist.)

### Artifact files

- `Transcript.md` — clean transcript; small frontmatter (`macparakeet-id`, `type: transcript`).
- `Notes.md` — the user's typed meeting notes from MacParakeet.
- One file per AI result, named from sanitized prompt name (`Summary.md`, `Action items.md`); frontmatter carries `macparakeet-id`, `result-id`, prompt name, generated date. Two results with the same prompt name → second gets ` (shortID)` suffix.

### Sanitization rules

- Strip/replace characters invalid in Obsidian filenames or links: `* " \ / < > : | ? # ^ [ ]` → `-`; collapse whitespace; trim dots/spaces at ends; cap `{title}` at 60 chars; empty → `Untitled Meeting`.
- Collisions are impossible at the folder level (`n` disambiguates); artifact collisions handled per above.

Formatting (frontmatter fields, index layout, heading styles) is expected to iterate via feedback after the first working version — owner reviews output and requests changes; no hand-editing of generated files.

## 8. Tech stack & scaffolding

- **TypeScript + esbuild**, structured after the official `obsidianmd/obsidian-sample-plugin` (manifest.json, `main.ts`, `versions.json`, esbuild config, `npm run dev` watch build).
- `manifest.json`: `id: macparakeet-sync`, `name: MacParakeet Sync`, `isDesktopOnly: true`, description noting it's an unofficial community integration.
- `.gitignore` (Node) extended with `main.js`, `*.js.map` — built artifacts ship only as GitHub release assets.
- **Tests: vitest** for pure logic, no Obsidian runtime needed: path templating, title sanitization, counter assignment, list-diff/skip logic, renderer output. CLI/Vault interactions isolated behind thin interfaces so the engine is testable with fakes.
- Dev loop: symlink/copy build output into a throwaway test vault's `.obsidian/plugins/macparakeet-sync/`, reload Obsidian, run against real local MacParakeet data.

## 9. Milestones

1. **M1 — Scaffold**: sample-plugin structure adapted, manifest, esbuild, vitest wired, plugin loads in a test vault (no behavior).
2. **M2 — CLI bridge + settings**: discovery chain, `health --json` validation, full settings tab, status surfaced in settings.
3. **M3 — Sync engine**: state model, list/diff/skip, fetch, path planning, rendering, manual sync command end-to-end against real data.
4. **M4 — Triggers + UX**: ribbon icon, interval timer, on-launch sync, single-flight, notices, force re-sync command.
5. **M5 — Release**: README (install incl. BRAT, setup, screenshots), GitHub release workflow (zip `main.js`+`manifest.json`), community-store submission PR to `obsidianmd/obsidian-releases`. Courtesy heads-up to the MacParakeet maintainer (moona3k).

### Verification (per milestone and overall)

- `npm test` green (pure-logic coverage as in §8).
- Manual end-to-end in test vault: first sync creates expected folders; second sync is a no-op (all skipped); generate a new AI result in MacParakeet → next sync adds exactly one file; toggle transcript on → old unchanged meetings untouched, next new meeting gets `Transcript.md`; add a personal note inside a meeting folder → never modified; delete a meeting in MacParakeet → vault unchanged.

## 10. Out of scope (v1) / future ideas

- Per-prompt allowlist for AI results; orphaned-meeting frontmatter marking; Dataview-friendly extra properties; syncing dictation history or file transcriptions; triggering `prompts run` from Obsidian; Templater-style custom note templates.
