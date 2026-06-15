# v2 cross-source e2e matrix

Verification matrix for issue [#31](https://github.com/andreagrandi/obsidian-meeting-notes-sync/issues/31).
Every scenario below has an automated proxy (a unit/integration test running the
real `SyncEngine` over fake sources and a fake vault). The automated column is
the deterministic regression net; the **real-data** column must still be run by
hand on a tagged build against a real Fellow workspace and local MacParakeet
meetings, including at least one meeting recorded by both, per the issue.

## Automated coverage

| # | Scenario | Automated test | Auto |
|---|---|---|---|
| 1 | Meeting only in Fellow → one folder, Fellow artifacts only | `sources/fellow.test.ts` › "imports a Fellow meeting into the vault layout" | ✅ |
| 2 | Meeting only in MacParakeet → unchanged v1 behavior | `sync/engine.test.ts` › "creates the folder, index, and result files"; "re-renders a changed legacy meeting without renaming its tracked v1 files" | ✅ |
| 3 | Both, MacParakeet first → Fellow merges into the existing folder (suffixed artifacts, combined index, no renumber) | `sync/engine.test.ts` › "writes both sources' artifacts into one folder with a combined index (PLAN §12.4)" | ✅ |
| 4 | Both, Fellow first → reverse order works identically | `sync/engine.test.ts` › "merges identically when Fellow syncs first and MacParakeet arrives later" | ✅ |
| 5 | Back-to-back meetings on the same day → no false merge | `sync/engine.test.ts` › "keeps back-to-back meetings as separate records" | ✅ |
| 6 | v1 vault upgrade → no re-imports, legacy folders untouched | `sync/engine.test.ts` › "first sync after migration is a no-op…"; "re-renders a changed legacy meeting without renaming its tracked v1 files"; `sync/state.test.ts` migration cases | ✅ |
| 7 | Foreign file in a merged meeting folder → never modified | `sync/engine.test.ts` › "never writes a file the plugin did not create" | ✅ |
| 8 | Second sync after each scenario → no-op | `sync/engine.test.ts` › "skips an unchanged meeting with zero fetches and zero writes"; `sources/fellow.test.ts` › "makes the immediate second sync a no-op…" | ✅ |

Run them with `npm test`.

## Real-data run (pending)

A first real-data pass is available without Obsidian via the live harness
(`npx -y tsx scripts/fellow-live-test.mts`), which runs the real engine against
the live Fellow API and local `macparakeet-cli` into a temp vault. A run on the
`supertab` workspace exercised rows 1–5 and 8 against real data — including a
genuine cross-source merge (flagged `merge-confidence: low` on differing titles)
and a correct *non*-merge of two same-titled, non-overlapping sessions.

These rows still need a hands-on pass in Obsidian on a real tagged build — the
harness cannot exercise Obsidian's `requestUrl`, the real ObsidianVaultIO, or a
genuine in-app v1 upgrade. Fill in the outcome (pass / issue link) per row once run.

Prerequisites:

- A tagged v2 build installed via BRAT in a clean test vault (see README → Releasing / Installation).
- A real Fellow workspace with the API enabled and a personal key.
- Local MacParakeet meetings, including **one meeting genuinely recorded by both** MacParakeet and Fellow.

| # | Scenario | Real-data outcome |
|---|---|---|
| 1 | Meeting only in Fellow | _pending_ |
| 2 | Meeting only in MacParakeet | _pending_ |
| 3 | Both, MacParakeet first | _pending_ |
| 4 | Both, Fellow first | _pending_ |
| 5 | Back-to-back, same day | _pending_ |
| 6 | v1 vault upgrade | _pending_ |
| 7 | Foreign file untouched | _pending_ |
| 8 | Second sync no-op | _pending_ |

Steps per scenario:

1. Configure the relevant source(s) in settings and run `Sync now`.
2. Inspect the resulting folder(s): folder count, artifact filenames (source
   suffixes), the index frontmatter (`macparakeet-id` / `fellow-id` / interval /
   `merge-confidence`), and that no foreign or user files were touched.
3. Run `Sync now` again and confirm `0 new, 0 updated` (no writes).
4. File an issue for any divergence; fix or explicitly accept each before the
   final build is considered green.
