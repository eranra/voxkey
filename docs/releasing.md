# Releasing a new version

Two rules apply to every release, on both Windows and macOS:

- **Always bump the minor version** (`0.2.0` → `0.3.0` → `0.4.0`). Patch-only releases are not used;
  the `bump:patch` script was removed on purpose.
- **Windows and macOS are always released together**, at the same version, from the same `v<version>`
  tag. Never publish a release for one platform only.

Steps:

1. Update `CHANGELOG.md`: fold the `[Unreleased]` section into a section for the new version, with
   the release date.
2. Set the version: `npm run bump:minor` (0.2.0 → 0.3.0).
   This changes `package.json` and `package-lock.json`.
3. Commit, and merge to `main` after CI passes on Windows and macOS.
4. Tag and push:

   ```sh
   git tag v0.3.0
   git push origin v0.3.0
   ```

5. The **Release** workflow creates a draft release for the tag, then (on macOS and Windows at the same time)
   checks that the tag matches `package.json`, builds the Windows helper from source, runs the tests, and builds:
   - `VoxKey-Setup-<version>.exe` and `latest.yml` (Windows),
   - `VoxKey-<version>-arm64.dmg`, `VoxKey-<version>-x64.dmg` and `latest-mac.yml` (macOS).

   It attaches them to one **draft** release, so both systems always carry the same version.
6. Open the draft on the [Releases page](https://github.com/eranra/voxkey/releases), add the changelog text, and
   publish it. This step is part of the release: installed copies of VoxKey find the update only after the
   release is published. A draft release, or a version that was never tagged, updates nobody — this is why
   Windows stayed on 0.1.1 after 0.2.0 was prepared but never tagged.

## Code signing

Builds are not code-signed yet:

- macOS builds are ad-hoc signed (`identity: '-'` in `electron-builder.yml`). The app runs, but macOS cannot
  install updates automatically. To sign and notarize, set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, set `identity: null`, and change the
  macOS update channel in `src/update.js` to `'auto'`.
- Windows installers show a SmartScreen warning. To sign, set `CSC_LINK` and `CSC_KEY_PASSWORD` for a Windows
  code-signing certificate.
