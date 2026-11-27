/**
 * Update logic that does not depend on Electron, so it can be unit tested.
 *
 * How VoxKey updates on each system:
 * - Windows installer (NSIS): electron-updater downloads the new version in the background and
 *   installs it when the user chooses "Restart Now" (or the next time VoxKey quits).
 * - macOS: automatic install needs an Apple Developer ID signature. Our builds are ad-hoc signed, so
 *   VoxKey tells the user and offers the release page and the one-line update command instead.
 * - Running from source (`npm start`): no update checks. Use `git pull`.
 */

const REPO_URL = 'https://github.com/eranra/voxkey';
const RELEASES_URL = `${REPO_URL}/releases`;
const ISSUES_URL = `${REPO_URL}/issues`;
const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/eranra/voxkey/main/install.sh | bash';

/** Hours between automatic update checks. */
const UPDATE_CHECK_HOURS = 6;
/** Seconds after start before the first automatic check, so start-up stays quick. */
const FIRST_CHECK_DELAY_SECONDS = 10;

/**
 * How this copy of the app can be updated:
 * - 'auto': electron-updater downloads and installs it (Windows NSIS).
 * - 'notify-mac': tell the user, offer the release page and the install command (macOS).
 * - 'notify': tell the user, offer the release page (other packaged builds).
 * - 'none': development run (`npm start`), no update checks.
 */
function updateChannel({ platform, packaged }) {
  if (!packaged) return 'none';
  if (platform === 'win32') return 'auto';
  if (platform === 'darwin') return 'notify-mac';
  return 'notify';
}

/** Parses "1.2.3", "v1.2.3" or "1.2.3-beta.1". Returns null for anything else. */
function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** Compares two versions: negative if a < b, 0 if equal, positive if a > b. Invalid versions sort lowest. */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    const d = va.parts[i] - vb.parts[i];
    if (d !== 0) return d;
  }
  // A release (no "-beta") is newer than its pre-release.
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function releaseUrl(version) {
  return `${RELEASES_URL}/tag/v${String(version).replace(/^v/, '')}`;
}

/**
 * Whether to tell the user about `latest`. Automatic checks announce each new version once.
 * A manual "Check for Updates…" always tells the user.
 */
function shouldAnnounce(latest, current, lastAnnounced, manual) {
  if (!isNewer(latest, current)) return false;
  if (manual) return true;
  return lastAnnounced === null || lastAnnounced === undefined || isNewer(latest, lastAnnounced);
}

/** Name of the update metadata file electron-builder publishes for each system. */
function metadataFileName(platform) {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return 'latest-linux.yml';
  return 'latest.yml';
}

/** Always points at the newest published (not draft) release. */
function latestMetadataUrl(platform) {
  return `${RELEASES_URL}/latest/download/${metadataFileName(platform)}`;
}

/** Reads `version:` from an electron-builder `latest*.yml` file. Returns null when it is missing or invalid. */
function versionFromMetadata(yaml) {
  const m = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(String(yaml));
  return m && parseVersion(m[1]) ? m[1] : null;
}

/** Short status text for the About window. */
function updateStatusText(state) {
  switch (state && state.kind) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return "You're up to date.";
    case 'available':
      return `Version ${state.version} is available.`;
    case 'downloading':
      return `Downloading version ${state.version}… ${state.percent}%`;
    case 'ready':
      return `Version ${state.version} is ready. Restart to update.`;
    case 'error':
      return 'Could not check for updates.';
    default:
      return '';
  }
}

/** Short text for the tray menu, or null when nothing should be shown. */
function updateMenuLabel(state) {
  switch (state && state.kind) {
    case 'available':
      return `Update Available: ${state.version}…`;
    case 'downloading':
      return `Downloading Update ${state.version} (${state.percent}%)`;
    case 'ready':
      return `Restart to Update to ${state.version}`;
    default:
      return null;
  }
}

/** How updates work for this channel, in one short sentence. */
function updateModeText(channel) {
  if (channel === 'auto') return 'Updates install automatically';
  if (channel === 'none') return 'Development build';
  return 'You are told about new versions';
}

/** Only our own GitHub pages may be opened from the app. */
function isAllowedLink(url) {
  return typeof url === 'string' && (url === REPO_URL || url.startsWith(`${REPO_URL}/`));
}

module.exports = {
  REPO_URL,
  RELEASES_URL,
  ISSUES_URL,
  INSTALL_COMMAND,
  UPDATE_CHECK_HOURS,
  FIRST_CHECK_DELAY_SECONDS,
  updateChannel,
  parseVersion,
  compareVersions,
  isNewer,
  releaseUrl,
  shouldAnnounce,
  metadataFileName,
  latestMetadataUrl,
  versionFromMetadata,
  updateStatusText,
  updateMenuLabel,
  updateModeText,
  isAllowedLink
};
