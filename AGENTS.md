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

## Commits

- Subject line: short and imperative. Optional body with the reason for the
  change.
- No `Co-Authored-By`, `Generated with`, or any other AI attribution in
  commits, pull requests, or docs. All work is authored by Eran Raichstein.

## Cross-Platform Parity & Regression Prevention (Windows & macOS)

- **Strict cross-platform parity**: VoxKey is cross-platform and must function identically on both Windows and macOS. Never implement or alter a feature on one platform that causes regressions or breaks functionality on the other.
- **Window focus constraints (`focusable: false`)**: The primary on-screen keyboard window operates with `focusable: false` so that clicks on keys and controls never steal keyboard focus from the user's active application.
  - Native OS popup menus (such as standard HTML `<select>` popups on Windows) do not open in non-focusable windows.
  - Controls that show dropdown menus, dialogs, or pickers must use custom in-DOM components (e.g., the custom language combobox) so clicks and menu interactions register cleanly within the DOM without requiring OS window focus.
- **Robust test suite**: Always write comprehensive automated unit and integration tests for every new UI interaction or platform bridge. Before committing or opening a PR, always run `npm run check` (all syntax checks, unit tests, and integration tests) to ensure zero regressions across platforms.
