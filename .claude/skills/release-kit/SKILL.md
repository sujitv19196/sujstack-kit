---
name: release-kit
description: Cut a sujstack-kit release (vX.Y.Z tag) and bump an app's kit/ submodule to it. Use after committing a kit change, or when an app needs a newer kit.
---

Follow *Releases, and moving to npm* in `README.md` and the release rules in `CLAUDE.md`.

1. Verify in `kit/`: `bun run typecheck && bun test && bun run check`. If dependencies changed,
   refresh `kit/bun.lock` from a standalone copy, never by installing inside the mounted `kit/`,
   which leaves a `kit/node_modules` that shadows the app's.
2. Commit the change on `main` with a one-line conventional message.
3. Release: `bun pm version patch|minor` (`0.x`: anything breaking bumps the minor), then
   `git push --follow-tags`. Inside the mounted submodule, `.git` is a file and `bun pm version`
   only edits `package.json` without committing or tagging. Either release from a standalone clone,
   or finish the step exactly as it would: `git commit -am vX.Y.Z` and `git tag -a vX.Y.Z -m vX.Y.Z`.
4. In the app: `git -C kit checkout vX.Y.Z`, run the app's full check, and commit the pointer alone
   as `chore: bump kit to vX.Y.Z`.
