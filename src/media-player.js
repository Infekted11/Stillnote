const paths = {
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  volume: '<path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4zM16 9l6 6M22 9l-6 6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
export function mediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const n = Math.floor(seconds), hours = Math.floor(n/3600), minutes = Math.floor(n/60)%60;
  return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(n%60).padStart(2,'0')}` : `${minutes}:${String(n%60).padStart(2,'0')}`;
}
export function createMediaPlayer(asset, file, { embedded = false, settingsKey = file } = {}) {
  const video = asset.mime.startsWith('video/');
  const shell = document.createElement('span'); shell.className = `stillnote-player ${video ? 'is-video' : 'is-audio'}${embedded ? ' is-embedded' : ''}`;
  shell.setAttribute('role','group'); shell.setAttribute('aria-label', `Media player: ${file}`); shell.tabIndex = 0;
  const media = document.createElement(video ? 'video' : 'audio'); media.className = 'asset-media-player';
  media.controls = false; media.preload = 'metadata'; media.setAttribute('aria-label', file);
  if (video) media.playsInline = true;
  shell.append(media); shell.media = media;
  const title = document.createElement('span'); title.className = 'media-player-title'; title.textContent = file.split('/').pop(); title.title = file;
  shell.append(title);
  const controls = document.createElement('span'); controls.className = 'media-player-controls'; shell.append(controls);
  const button = (label, name) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'media-player-button';
    node.title = label; node.setAttribute('aria-label',label); node.innerHTML = icon(name); controls.append(node); return node;
  };
  const play = button('Play','play');
  const time = document.createElement('span'); time.className = 'media-player-time'; time.textContent = '0:00 / 0:00'; controls.append(time);
  const slider = (label, min, max, step, value) => {
    const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    input.setAttribute('aria-label',label); controls.append(input); return input;
  };
  const seek = slider('Playback position',0,100,.1,0); seek.className = 'media-player-seek'; seek.disabled = true;
  const mute = button('Mute','volume'); mute.setAttribute('aria-pressed','false');
  const volume = slider('Volume',0,1,.05,1); volume.className = 'media-player-volume';
  const rates = [.5,.75,1,1.25,1.5,2], storageKey = `stillnote-media-speed:${settingsKey}`;
  let savedRate = 1;
  try { const stored = Number(globalThis.localStorage?.getItem(storageKey)); if (rates.includes(stored)) savedRate = stored; } catch {}
  let speed;
  if (!embedded) {
    const settings = document.createElement('details'); settings.className = 'media-player-settings';
    const summary = document.createElement('summary'); summary.textContent = 'Playback settings'; settings.append(summary);
    const label = document.createElement('label'); label.textContent = 'Playback speed ';
    speed = document.createElement('select'); speed.className = 'media-player-speed'; speed.setAttribute('aria-label','Playback speed');
    for (const rate of rates) { const option = document.createElement('option'); option.value = String(rate); option.textContent = `${rate}×`; speed.append(option); }
    speed.value = String(savedRate); label.append(speed); settings.append(label); shell.append(settings);
    speed.addEventListener('change', () => {
      media.playbackRate = Number(speed.value);
      try { globalThis.localStorage?.setItem(storageKey, String(media.playbackRate)); } catch {}
      sync();
    });
  }
  const error = document.createElement('span'); error.className = 'media-playback-error'; error.setAttribute('role','alert'); error.hidden = true; shell.append(error);
  const sync = () => {
    const playing = !media.paused && !media.ended;
    play.innerHTML = icon(playing ? 'pause' : 'play'); play.setAttribute('aria-label',playing ? 'Pause' : 'Play'); play.title = playing ? 'Pause' : 'Play';
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    seek.disabled = !duration || !!media.error; seek.max = duration || 100; seek.value = Math.min(media.currentTime || 0, duration);
    seek.setAttribute('aria-valuetext', `${mediaTime(media.currentTime)} of ${mediaTime(duration)}`);
    time.textContent = `${mediaTime(media.currentTime)} / ${mediaTime(duration)}`;
    mute.innerHTML = icon(media.muted || media.volume === 0 ? 'mute' : 'volume');
    mute.setAttribute('aria-label',media.muted ? 'Unmute' : 'Mute'); mute.title = media.muted ? 'Unmute' : 'Mute'; mute.setAttribute('aria-pressed',String(media.muted));
    volume.value = media.muted ? 0 : media.volume; if (speed) speed.value = String(media.playbackRate);
  };
  const showError = message => { error.textContent = message; error.hidden = false; };
  const toggle = async () => {
    if (!media.paused && !media.ended) { media.pause(); return; }
    try { await media.play(); error.hidden = true; }
    catch { showError('Playback could not start. Check that this media format or codec is supported.'); }
    sync();
  };
  play.addEventListener('click',toggle);
  if (video) media.addEventListener('click',toggle);
  seek.addEventListener('input', () => { if (!seek.disabled) { media.currentTime = Number(seek.value); sync(); } });
  mute.addEventListener('click', () => { media.muted = !media.muted; sync(); });
  volume.addEventListener('input', () => { media.volume = Number(volume.value); media.muted = false; sync(); });
  const fullscreen = async () => {
    try { if (document.fullscreenElement === shell) await document.exitFullscreen(); else await shell.requestFullscreen(); }
    catch { showError('Fullscreen is unavailable in this view.'); }
  };
  if (video) button('Toggle fullscreen','fullscreen').addEventListener('click',fullscreen);
  shell.addEventListener('keydown', event => {
    if (event.target.closest('button,input,select,summary') || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === ' ' || key === 'k') { event.preventDefault(); event.stopPropagation(); void toggle(); }
    else if (key === 'm') { event.preventDefault(); media.muted = !media.muted; sync(); }
    else if (video && key === 'f') { event.preventDefault(); void fullscreen(); }
    else if ((key === 'arrowleft' || key === 'arrowright') && Number.isFinite(media.duration)) {
      event.preventDefault(); media.currentTime = Math.max(0,Math.min(media.duration,media.currentTime+(key === 'arrowleft' ? -5 : 5))); sync();
    }
  });
  for (const event of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','volumechange','ratechange','seeked']) media.addEventListener(event,sync);
  media.addEventListener('error', () => { showError('This media format or codec cannot be played.'); play.disabled = true; sync(); });
  media.src = asset.data; media.playbackRate = savedRate;
  return shell;
}
export function disposeMediaPlayers(host) {
  host.querySelectorAll('audio,video').forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); });
}
