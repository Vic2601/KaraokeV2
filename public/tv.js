const $ = id => document.getElementById(id);
const hostKey = new URLSearchParams(location.search).get('host') || sessionStorage.getItem('karaoke-host-key') || '';
if (hostKey) sessionStorage.setItem('karaoke-host-key', hostKey);
if (location.search) history.replaceState(null, '', '/tv');
let state = null;
let player = null;
let playerReady = false;
let youtubeReady = false;
let shownItemId = null;
let advancing = false;
let fallback = null;
let lastCommandSeq = 0;
let lastReactionSeq = 0;
let audioContext = null;
let autoplayBlocked = false;
let countdownTimer = null;

function text(id, value) { $(id).textContent = value; }
function note(message) { $('player-note').textContent = message; $('player-note').hidden = !message; }
function thumb(id) { return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`; }
async function hostPost(route, data = {}) {
  const res = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Host-Key': hostKey }, body: JSON.stringify(data) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Action failed');
  return body;
}
function renderQueue(items) {
  const list = $('queue-list');
  list.replaceChildren();
  text('queue-count', items.length);
  $('skip-btn').disabled = !state.current || !hostKey;
  if (!items.length) { const p = document.createElement('p'); p.className = 'queue-empty'; p.textContent = 'More songs will appear here as friends add them.'; list.append(p); return; }
  items.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'queue-item';
    const num = document.createElement('span'); num.className = 'queue-num'; num.textContent = String(index + 1).padStart(2, '0');
    const img = document.createElement('img'); img.className = 'queue-thumb'; img.src = thumb(item.videoId); img.alt = '';
    const details = document.createElement('div'); details.className = 'queue-details';
    const title = document.createElement('strong'); title.textContent = item.title;
    const by = document.createElement('span'); by.textContent = `Queued by ${item.by}`;
    details.append(title, by); row.append(num, img, details);
    if (hostKey) { const remove = document.createElement('button'); remove.className = 'remove-btn'; remove.title = 'Remove from queue'; remove.textContent = '×'; remove.onclick = async () => { try { await hostPost('/api/remove', { id: item.id }); } catch (e) { note(e.message); } }; row.append(remove); }
    list.append(row);
  });
}
function render(next) {
  const prior = state?.current?.id;
  const priorPlayback = state?.playback;
  if (fallback && next.current?.id !== prior && next.current?.videoId !== fallback.expectedId) fallback = null;
  else if (fallback && next.current?.videoId === fallback.expectedId) fallback.expectedId = null;
  state = next;
  text('room-code', next.room); text('join-code', next.room);
  text('join-url', next.remoteUrl);
  const qrNode = $('qr');
  if (!qrNode.dataset.url || qrNode.dataset.url !== next.remoteUrl) {
    qrNode.dataset.url = next.remoteUrl;
    const qr = qrcode(0, 'M'); qr.addData(next.remoteUrl); qr.make(); qrNode.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
  }
  text('current-title', next.current?.title || 'Waiting for the first song');
  text('current-by', next.current ? `Singing: ${next.current.by}` : 'Your next performance starts here.');
  $('stage-empty').hidden = !!next.current;
  $('start-btn').hidden = !next.current || (next.playback === 'playing' && !autoplayBlocked);
  renderQueue(next.queue);
  if (next.current?.id !== prior) {
    advancing = false;
    autoplayBlocked = false;
    note('');
    syncPlayer();
  } else if (priorPlayback !== next.playback) applyPlayback();
  if (next.command?.seq && next.command.seq !== lastCommandSeq) { lastCommandSeq = next.command.seq; applyCommand(next.command.action); }
  if (next.reaction?.seq && next.reaction.seq !== lastReactionSeq) { lastReactionSeq = next.reaction.seq; showReaction(next.reaction.type); }
}
function applyPlayback() {
  if (!playerReady || !state?.current) return;
  try {
    if (state.playback === 'playing') { if (!countdownTimer) player.playVideo(); }
    else { clearInterval(countdownTimer); countdownTimer = null; $('countdown').hidden = true; player.pauseVideo(); }
  } catch {}
}
function startCountdown() {
  clearInterval(countdownTimer);
  let seconds = 3;
  $('countdown-number').textContent = String(seconds);
  $('countdown').hidden = false;
  countdownTimer = setInterval(() => {
    seconds--;
    if (seconds > 0) $('countdown-number').textContent = String(seconds);
    else {
      clearInterval(countdownTimer); countdownTimer = null; $('countdown').hidden = true;
      if (state?.playback === 'playing' && state?.current) player.playVideo();
    }
  }, 1000);
}
function applyCommand(action) {
  if (!playerReady || !state?.current) return;
  try {
    const time = player.getCurrentTime() || 0;
    if (action === 'restart') player.seekTo(0, true);
    if (action === 'rewind') player.seekTo(Math.max(0, time - 10), true);
    if (action === 'forward') player.seekTo(time + 10, true);
  } catch {}
}
function playCheer(type) {
  if (!audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const notes = type === 'airhorn' ? [392, 494, 392] : type === 'clap' ? [720, 630, 780] : [523, 659, 784];
  notes.forEach((hz, i) => {
    const osc = audioContext.createOscillator(); const gain = audioContext.createGain();
    osc.type = type === 'airhorn' ? 'sawtooth' : 'sine'; osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, now + i * .11);
    gain.gain.exponentialRampToValueAtTime(type === 'airhorn' ? .055 : .035, now + i * .11 + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, now + i * .11 + .18);
    osc.connect(gain).connect(audioContext.destination); osc.start(now + i * .11); osc.stop(now + i * .11 + .19);
  });
}
function showReaction(type) {
  const symbols = { clap: '👏', cheer: '🎉', party: '🥳', airhorn: '🎺', fire: '🔥' };
  const el = document.createElement('div'); el.className = 'reaction-burst'; el.textContent = symbols[type] || '🎉';
  el.style.left = `${25 + Math.random() * 50}%`;
  $('reaction-overlay').append(el); setTimeout(() => el.remove(), 2200);
  playCheer(type);
}
function plainTitle(value) {
  return String(value).replace(/&#(x[0-9a-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi, (entity, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[named.toLowerCase()] || entity;
  });
}
function titleWords(value) {
  return plainTitle(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word.length > 2 && !['the', 'and', 'feat', 'karaoke', 'version', 'lyrics', 'instrumental'].includes(word));
}
async function tryAnotherVersion(errorCode) {
  const current = state?.current;
  if (!current || fallback?.busy || (fallback?.expectedId && current.videoId !== fallback.expectedId)) return;
  if (!fallback) fallback = { title: current.title, failed: new Set(), candidates: null, expectedId: null, busy: false };
  const attempt = fallback;
  attempt.failed.add(current.videoId);
  if (attempt.failed.size > 6) { note('Several versions could not play here. Search for another version on the phone.'); fallback = null; return; }
  attempt.busy = true;
  try {
    if (!attempt.candidates) {
      const query = plainTitle(attempt.title).replace(/\([^)]*karaoke[^)]*\)/gi, '').replace(/\b(karaoke|instrumental|lyrics?|version|HD|4K)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed');
      const words = [...new Set(titleWords(query))];
      attempt.candidates = (data.items || []).filter(item => {
        const title = plainTitle(item.title);
        const matches = titleWords(title).filter(word => words.includes(word)).length;
        return /karaoke|instrumental|minus.one/i.test(title) && matches >= Math.min(2, words.length);
      });
    }
    if (fallback !== attempt || state?.current?.id !== current.id) return;
    const candidate = attempt.candidates.find(item => !attempt.failed.has(item.videoId));
    if (!candidate) { note('No other karaoke version was found. Search for another version on the phone.'); fallback = null; return; }
    attempt.expectedId = candidate.videoId;
    note(`This video is unavailable. Trying another version (${attempt.failed.size}/6)…`);
    const queued = await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: state.room, url: `https://www.youtube.com/watch?v=${candidate.videoId}`, title: plainTitle(candidate.title), by: current.by, position: 'next' }) });
    if (!queued.ok) throw new Error((await queued.json()).error || 'Could not queue an alternative');
    if (fallback !== attempt || state?.current?.id !== current.id) return;
    const advanced = await fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: state.room, action: 'next' }) });
    if (!advanced.ok) throw new Error((await advanced.json()).error || 'Could not play the alternative');
  } catch {
    note(errorCode === 153 ? 'YouTube could not play this video in the TV browser. Try another browser or choose a different version on the phone.' : 'This video cannot play here. Choose another karaoke version on the phone.');
    fallback = null;
  } finally { attempt.busy = false; }
}
function syncPlayer() {
  if (!youtubeReady || !state?.current) return;
  const id = state.current.videoId;
  if (!player) {
    player = new YT.Player('player', { videoId: id, playerVars: { playsinline: 1, rel: 0, origin: location.origin }, events: {
      onReady: () => { playerReady = true; shownItemId = state.current?.id; player.cueVideoById(state.current?.videoId || id); if (state.playback === 'playing') player.playVideo(); },
      onStateChange: async e => {
        if (e.data === YT.PlayerState.PLAYING) { fallback = null; autoplayBlocked = false; $('start-btn').hidden = true; note(''); }
        if (e.data === YT.PlayerState.ENDED && !advancing) { advancing = true; try { await hostPost('/api/next'); } catch (err) { note(err.message); advancing = false; } }
      },
      onError: e => { if ([5, 100, 101, 150, 153].includes(e.data)) tryAnotherVersion(e.data); else note('This video cannot play here. Choose another karaoke version on the phone.'); },
      onAutoplayBlocked: () => { autoplayBlocked = true; $('start-btn').hidden = false; note('Your TV browser needs a tap to allow playback.'); }
    }});
    shownItemId = state.current.id;
  } else if (playerReady && shownItemId !== state.current.id) {
    shownItemId = state.current.id;
    player.cueVideoById(id);
    if (state.playback === 'playing') startCountdown();
  }
}
window.onYouTubeIframeAPIReady = () => { youtubeReady = true; syncPlayer(); };
if (window.YT?.Player) window.onYouTubeIframeAPIReady();
$('start-btn').onclick = async () => {
  if (!playerReady) return note('The YouTube player is still loading. Try again in a moment.');
  try {
    try {
      if (!audioContext && (window.AudioContext || window.webkitAudioContext)) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext?.state === 'suspended') audioContext.resume();
    } catch {}
    player.playVideo(); await hostPost('/api/playback', { playback: 'playing' }); note('');
  } catch { note('Playback could not start. Try again.'); }
};
$('skip-btn').onclick = async () => { try { await hostPost('/api/next'); } catch (e) { note(e.message); } };
$('fullscreen-btn').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { note('This TV browser does not allow fullscreen mode.'); }
};
fetch('/api/state').then(r => r.json()).then(render).catch(() => note('Cannot connect to the karaoke server.'));
// Active TV sessions send an HTTP request so free hosts do not sleep mid-party.
setInterval(() => { fetch('/api/state').catch(() => {}); }, 3 * 60 * 1000);
const events = new EventSource('/api/events');
events.onmessage = e => render(JSON.parse(e.data));
events.onerror = () => note('Connection lost. Reconnecting…');
