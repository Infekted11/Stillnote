const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const repo = 'Infekted11/Stillnote';
const releases = 'https://github.com/' + repo + '/releases/download/';
const latest = 'https://api.github.com/repos/' + repo + '/releases/latest';
const versionParts = version => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ? version.split('.').map(Number) : null;

function selectRelease(release, currentVersion, platform) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(release?.tag_name)?.[1];
  const parts = versionParts(version), current = versionParts(currentVersion);
  if (release?.draft || release?.prerelease || !parts || !current || ![...parts, ...current].every(Number.isSafeInteger)) {
    throw new Error('GitHub did not return a supported stable Stillnote release.');
  }
  const difference = parts.map((part, i) => part - current[i]).find(delta => delta !== 0) ?? 0;
  if (difference <= 0) return null;
  const base = releases + release.tag_name + '/';
  const names = platform === 'darwin' ? ['Stillnote-' + version + '-universal.dmg']
    : ['Stillnote.Setup.' + version + '.exe', 'Stillnote Setup ' + version + '.exe'];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find(item => names.includes(item.name)
    && item.browser_download_url === base + encodeURIComponent(item.name)
    && /^sha256:[a-f0-9]{64}$/i.test(item.digest) && Number.isSafeInteger(item.size) && item.size > 0);
  if (!asset) throw new Error('The latest release has no verified installer for this platform.');
  const metadata = platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
  return { version, base, asset, hasMetadata: assets.some(item => item.name === metadata && item.browser_download_url === base + metadata) };
}

async function downloadInstaller(asset, temp, fetchImpl, notify) {
  const folder = await fs.mkdtemp(path.join(temp, 'stillnote-update-'));
  const file = path.join(folder, asset.name);
  try {
    const response = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(20 * 60_000) });
    if (!response.ok || !response.body) throw new Error('GitHub could not provide the installer.');
    if (response.url && !/^https:\/\/(?:github\.com|release-assets\.githubusercontent\.com|objects\.githubusercontent\.com)\//.test(response.url)) {
      throw new Error('GitHub redirected the installer to an unexpected host.');
    }
    const hash = createHash('sha256');
    let size = 0, percent = -1;
    const verify = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        if (size > asset.size) return done(new Error('The installer exceeded its published size.'));
        hash.update(chunk);
        const next = Math.floor(size * 100 / asset.size);
        if (next !== percent) { percent = next; notify(percent); }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(file, { flags: 'wx', mode: 0o700 }));
    if (size !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest.toLowerCase()) {
      throw new Error('The installer did not match the SHA-256 published by GitHub.');
    }
    return file;
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function createAppUpdates({ app, shell, platform = process.platform, fetchImpl = fetch,
  getUpdater = () => require('electron-updater').autoUpdater, onInstallError = () => {} }) {
  const version = app.getVersion();
  const supported = app.isPackaged && ['darwin', 'win32'].includes(platform);
  let stage = 'idle', candidate, installer, updater, installError;

  const info = () => ({ version, supported, stage, availableVersion: candidate?.version,
    method: candidate?.method, platform });

  async function check() {
    if (!supported || ['checking', 'downloading', 'ready', 'installing'].includes(stage)) return info();
    stage = 'checking';
    try {
      const response = await fetchImpl(latest, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('GitHub could not check for updates. Try again shortly.');
      candidate = selectRelease(await response.json(), version, platform);
      if (candidate) {
        let signed = false;
        if (platform === 'darwin' && candidate.hasMetadata) {
          const executable = app.getPath('exe');
          const { stderr } = await promisify(execFile)('/usr/bin/codesign', ['-dv', path.resolve(executable, '../../..')])
            .catch(() => ({ stderr: '' }));
          signed = /^TeamIdentifier=[A-Z0-9]{10}$/m.test(stderr);
        }
        candidate.method = candidate.hasMetadata && (platform === 'win32' || signed) ? 'automatic' : 'installer';
      }
      stage = candidate ? 'available' : 'current';
      return info();
    } catch (error) {
      candidate = null;
      stage = 'idle';
      throw error;
    }
  }

  async function download(notify) {
    if (stage !== 'available') return info();
    stage = 'downloading';
    try {
      if (candidate.method === 'automatic') {
        if (!updater) {
          updater = getUpdater();
          updater.on('error', error => {
            if (stage !== 'installing') return;
            installError = error;
            stage = 'ready';
            onInstallError(error.message);
          });
        }
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.allowPrerelease = false;
        updater.setFeedURL({ provider: 'generic', url: candidate.base });
        const progress = event => notify(Math.floor(event.percent));
        updater.on('download-progress', progress);
        try {
          const result = await updater.checkForUpdates();
          if (!result?.isUpdateAvailable || result.updateInfo.version !== candidate.version) {
            throw new Error('The release update metadata did not match the GitHub release.');
          }
          await updater.downloadUpdate();
        } finally { updater.off('download-progress', progress); }
      } else {
        installer = await downloadInstaller(candidate.asset, app.getPath('temp'), fetchImpl, notify);
      }
      stage = 'ready';
      return info();
    } catch (error) {
      stage = 'available';
      throw error;
    }
  }

  async function install() {
    if (stage !== 'ready') throw new Error('Download the update first.');
    installError = null;
    stage = 'installing';
    try {
      if (candidate.method === 'automatic') {
        updater.quitAndInstall(false, true);
        if (installError) throw installError;
      }
      else {
        const error = await shell.openPath(installer);
        if (error) throw new Error(error);
        stage = 'ready';
      }
      return info();
    } catch (error) {
      stage = 'ready';
      throw error;
    }
  }

  return { info, check, download, install };
}

module.exports = { createAppUpdates, selectRelease, downloadInstaller };
