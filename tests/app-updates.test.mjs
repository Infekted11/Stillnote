import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import updates from '../electron/app-updates.cjs';

const bytes = 'test installer';
const releaseBase = 'https://github.com/Infekted11/Stillnote/releases/download/v1.10.0/';
const asset = name => ({
  name, size: Buffer.byteLength(bytes), browser_download_url: releaseBase + name,
  digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
});
const release = { tag_name: 'v1.10.0', assets: [
  asset('Stillnote-1.10.0-universal.dmg'), asset('Stillnote.Setup.1.10.0.exe'),
] };

test('checks numeric versions and selects only verified assets for the installed OS', () => {
  assert.equal(updates.selectRelease(release, '1.9.9', 'darwin').asset.name, 'Stillnote-1.10.0-universal.dmg');
  assert.equal(updates.selectRelease(release, '1.9.9', 'win32').asset.name, 'Stillnote.Setup.1.10.0.exe');
  assert.equal(updates.selectRelease(release, '1.10.0', 'win32'), null);
  assert.equal(updates.selectRelease(release, '2.0.0', 'win32'), null);
  assert.throws(() => updates.selectRelease({ ...release, prerelease: true }, '1.9.9', 'win32'), /stable/);
  assert.throws(() => updates.selectRelease({ ...release, assets: [
    { ...release.assets[1], browser_download_url: 'https://example.org/update.exe' },
  ] }, '1.9.9', 'win32'), /no verified installer/);
});

test('downloads and opens the verified installer only after separate user actions', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'stillnote-update-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const opened = [], progress = [];
  const controller = updates.createAppUpdates({
    app: { isPackaged: true, getVersion: () => '1.9.9', getPath: () => temp },
    platform: 'darwin', shell: { openPath: async file => { opened.push(file); return ''; } },
    fetchImpl: async url => url.startsWith('https://api.github.com/') ? Response.json(release) : new Response(bytes),
  });
  assert.equal((await controller.check()).stage, 'available');
  await assert.rejects(controller.install(), /Download/);
  assert.equal((await controller.download(percent => progress.push(percent))).stage, 'ready');
  assert.deepEqual(progress, [100]);
  assert.deepEqual(opened, []);
  await controller.install();
  assert.equal(await readFile(opened[0], 'utf8'), bytes);

  const before = await readdir(temp);
  await assert.rejects(updates.downloadInstaller(release.assets[0], temp,
    async () => new Response('wrong contents'), () => {}), /SHA-256/);
  assert.deepEqual(await readdir(temp), before);
});

test('Windows uses the release feed and waits for explicit installation', async () => {
  const updater = new EventEmitter();
  let downloaded = 0, installed = 0;
  updater.setFeedURL = feed => assert.deepEqual(feed, { provider: 'generic', url: releaseBase });
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '1.10.0' } });
  updater.downloadUpdate = async () => { downloaded++; };
  updater.quitAndInstall = () => { installed++; };
  const controller = updates.createAppUpdates({
    app: { isPackaged: true, getVersion: () => '1.9.9' },
    platform: 'win32', getUpdater: () => updater,
    fetchImpl: async () => Response.json({ ...release, assets: [...release.assets, asset('latest.yml')] }),
  });
  assert.equal((await controller.check()).method, 'automatic');
  assert.equal((await controller.download(() => {})).stage, 'ready');
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(downloaded, 1);
  assert.equal(installed, 0);
  assert.equal((await controller.install()).stage, 'installing');
  assert.equal(installed, 1);
});
