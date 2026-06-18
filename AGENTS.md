# Agent guidance

Conventions and gotchas for AI agents working in this repo. Record new learnings
here — not in any agent's private/internal memory.

## Releases

`.github/workflows/release.yml` cuts a GitHub release with:

    gh release create "$TAG" --title "$TAG" --generate-notes main.js manifest.json versions.json

`--generate-notes` builds the "What's Changed" section from the **pull requests
merged within the tag range**. The repo's normal flow is PR-based, and that
produces a proper changelog — e.g. `0.2.0` lists PRs #32–#36 in its body.

**Gotcha — an empty "What's Changed".** If a release's tag range contains no
merged PRs — because the change was committed straight to `master` and tagged
without going through a PR — `--generate-notes` has nothing to list and the body
is just the `**Full Changelog**` compare link. This is what happened to the
0.2.1, 0.2.2, and 0.3.0 point releases. It is **range-dependent, not a repo
convention**: this repo does use PRs, so don't describe it as a "direct-commit
repo".

When cutting a release that should have notes:

- **Land the change via a PR first** (the repo's usual flow), then tag — so
  `--generate-notes` has PR titles to list. Don't commit straight to `master`
  and immediately tag a release.
- Or pass explicit notes instead of relying on `--generate-notes`:
  `--notes "$(git log <prev-tag>..$TAG --pretty='- %s')"`, or `--notes-file`
  from a maintained `CHANGELOG.md`.
