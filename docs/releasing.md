# Releasing a new version

1. Update `CHANGELOG.md` with a section for the new version.
2. Set the version: `npm run bump:patch` (0.1.0 → 0.1.1) or `npm run bump:minor` (0.1.0 → 0.2.0).
   This changes `package.json` and `package-lock.json`.
3. Commit, and merge to `main` after CI passes on Windows and macOS.
4. Tag and push:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

5. The **Release** workflow checks that the tag matches `package.json`, builds the Windows helper from source,
   runs the tests, and builds:
   - `VoxKey-Setup-<version>.exe` and `latest.yml` (Windows),
   - `VoxKey-<version>-arm64.dmg`, `VoxKey-<version>-x64.dmg` and `latest-mac.yml` (macOS).

   It attaches them to a **draft** release.
6. Open the draft on the [Releases page](https://github.com/eranra/voxkey/releases), add the changelog text, and
   publish it. Installed copies of VoxKey find the update only after the release is published.

## Code signing

Builds are not code-signed yet:

- macOS builds are ad-hoc signed (`identity: '-'` in `electron-builder.yml`). The app runs, but macOS cannot
  install updates automatically. To sign and notarize, set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, set `identity: null`, and change the
  macOS update channel in `src/update.js` to `'auto'`.
- Windows installers show a SmartScreen warning. To sign, set `CSC_LINK` and `CSC_KEY_PASSWORD` for a Windows
  code-signing certificate.
