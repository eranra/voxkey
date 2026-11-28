# Agent workflow

This repository is developed with several AI coding sessions running in
parallel (Claude Code and OpenCode). Follow these rules so sessions do not
collide.

## Always work in a worktree

- Never edit, commit, or push in the main checkout on `main`. Other sessions
  may have uncommitted work there.
- Start every task by creating a worktree from the latest `origin/main`:

  ```bash
  git fetch origin
  git worktree add .claude/worktrees/<short-name> -b <type>/<short-name> origin/main
  ```

- Work inside the worktree directory. Run `npm install` there before running
  tests or builds.
- Claude Code sessions: prefer starting with `claude --worktree <name>`, or the
  EnterWorktree tool. It creates the worktree under `.claude/worktrees/`
  automatically.
- After the pull request is merged, remove the worktree and its branch:

  ```bash
  git worktree remove .claude/worktrees/<short-name>
  git branch -d <type>/<short-name>
  ```

## Changes land through pull requests

- Never push directly to `main`. Every change goes through a pull request.
- Branch names: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`,
  `test/<name>`.
- Push the branch and open a pull request:

  ```bash
  git push -u origin <branch>
  gh pr create --base main --fill
  ```

- Check CI with `gh pr checks` before handing the pull request over.
- Commit only the files you changed. Stage files by name, not with
  `git add -A`.

## Releases

These rules apply to every new release. Follow them in every session, on
Windows and on macOS alike.

- Every new release bumps the **minor** version: `npm run bump:minor`
  (0.2.0 → 0.3.0 → 0.4.0). Never release with a patch-only bump. There is no
  `bump:patch` script on purpose; do not add one back.
- Windows and macOS are always released **together, at the same version,
  from the same `v<version>` tag**. Never build or publish a release for one
  platform only.
- Release steps (details in `docs/releasing.md`): fold the `[Unreleased]`
  section of `CHANGELOG.md` into a dated section for the new version, run
  `npm run bump:minor`, merge to `main`, then tag `v<version>` and push the
  tag. The Release workflow builds both platforms into one draft release.
- Publishing the draft release is part of releasing. Installed copies find
  the update only after the draft is published; a draft or a missing tag
  updates nobody. After pushing the tag, check that the release was built
  and publish it.

## Commits

- Subject line: short and imperative. Optional body with the reason for the
  change.
- No `Co-Authored-By`, `Generated with`, or any other AI attribution in
  commits, pull requests, or docs. All work is authored by Eran Raichstein.
