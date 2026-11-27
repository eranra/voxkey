// About window. `window.voxkey` comes from preload.js.
const api = window.voxkey;
const $ = (id) => document.getElementById(id);
let links = {};

function render(info) {
  $('version').textContent = `Version ${info.version}`;
  $('details').textContent = `${info.platform} ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`;
  const status = $('status');
  status.textContent = info.updateStatus;
  status.classList.toggle('new', /available|ready|Downloading/i.test(info.updateStatus));
  $('check').disabled = info.updateStatus === 'Checking for updates…';
  $('license').textContent = `© 2026 ${info.author} and contributors · ${info.license} License · ${info.updateMode}`;
  links = { repo: info.repoUrl, releases: info.releasesUrl, issues: info.issuesUrl };
}

$('check').addEventListener('click', () => {
  $('status').textContent = 'Checking for updates…';
  api.checkUpdates();
});

document.querySelectorAll('[data-link]').forEach((a) => {
  a.addEventListener('click', () => {
    const url = links[a.dataset.link];
    if (url) api.openLink(url);
  });
});

api.onAboutUpdate(render);
api.getAbout().then(render);
