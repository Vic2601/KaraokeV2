const $ = id => document.getElementById(id);
const room = new URLSearchParams(location.search).get('room') || '';
let state = null;
let view = 'search';
let searchItems = [];
let favorites = JSON.parse(localStorage.getItem('vicci-favorites') || '[]');
let recent = JSON.parse(localStorage.getItem('vicci-recent') || '[]');
let mySongsView = 'favorites';
$('singer-name').value = localStorage.getItem('karaoke-name') || '';

function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error', error); }
function thumb(id) { return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`; }
function saveFavorites() { localStorage.setItem('vicci-favorites', JSON.stringify(favorites)); }
function favoriteIndex(id) { return favorites.findIndex(x => x.videoId === id); }

function render(next) {
  state = next;
  $('room-code').textContent = next.room;
  if (room !== next.room) { feedback('This party has ended. Scan the new QR code on the TV.', true); $('add-btn').disabled = true; return; }
  $('search-input').disabled = !next.searchEnabled;
  $('search-btn').disabled = !next.searchEnabled;
  $('search-setup').hidden = !!next.searchEnabled;
  if (!next.searchEnabled) $('search-tip').textContent = 'Live song search needs setup on the laptop. Use Paste a link for now.';
  $('current-title').textContent = next.current?.title || 'Waiting for a song';
  $('current-by').textContent = next.current ? `Singing: ${next.current.by}` : 'Be the first to add one';
  $('queue-count').textContent = `${next.queue.length} queued`;
  for (const id of ['restart-btn','rewind-btn','pause-btn','forward-btn','next-btn']) $(id).disabled = !next.current;
  $('pause-btn').textContent = next.playback === 'playing' ? '⏸ Pause' : '▶ Play';
  const list = $('queue-list'); list.replaceChildren();
  next.queue.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'queue-item';
    const num = document.createElement('span'); num.className = 'queue-num'; num.textContent = String(index + 1).padStart(2, '0');
    const img = document.createElement('img'); img.className = 'queue-thumb'; img.src = thumb(item.videoId); img.alt = '';
    const details = document.createElement('div'); details.className = 'queue-details';
    const title = document.createElement('strong'); title.textContent = item.title;
    const by = document.createElement('span'); by.textContent = `Singing: ${item.by}`;
    details.append(title, by); row.append(num, img, details); list.append(row);
  });
}

function showView(next) {
  view = next;
  for (const name of ['search','favorites','link']) {
    $(`tab-${name}`).classList.toggle('active', name === next);
    $(`${name}-panel`).hidden = name !== next;
  }
  feedback('');
  if (next === 'favorites') showMySongs();
}
function showMySongs() {
  $('my-favorites').classList.toggle('active', mySongsView === 'favorites');
  $('my-history').classList.toggle('active', mySongsView === 'history');
  renderResults(mySongsView === 'favorites' ? favorites : recent, $('favorites-results'), mySongsView === 'favorites' ? 'No saved songs yet. Tap ☆ beside a song to save it.' : 'No songs queued from this phone yet.');
}
$('my-favorites').onclick = () => { mySongsView = 'favorites'; showMySongs(); };
$('my-history').onclick = () => { mySongsView = 'history'; showMySongs(); };
$('tab-search').onclick = () => showView('search');
$('tab-favorites').onclick = () => showView('favorites');
$('tab-link').onclick = () => showView('link');

async function queueSong(item, position = 'end') {
  if (!state || room !== state.room) return feedback('Scan the current TV QR code to join.', true);
  const by = $('singer-name').value.trim();
  if (!by) { $('singer-name').focus(); return feedback('Enter your name first.', true); }
  localStorage.setItem('karaoke-name', by);
  feedback('Adding your song…');
  try {
    const url = item.url || `https://www.youtube.com/watch?v=${item.videoId}`;
    const res = await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, url, by, title: item.title || '', position }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not add the song.');
    if (item.videoId) {
      recent = [item, ...recent.filter(x => x.videoId !== item.videoId)].slice(0, 30);
      localStorage.setItem('vicci-recent', JSON.stringify(recent));
    }
    feedback(position === 'next' ? 'Added as the next singer!' : 'Added to the queue!');
    if (view === 'link') $('song-link').value = '';
  } catch (e) { feedback(e.message, true); }
}

function renderResults(items, target, emptyText) {
  target.replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'field-tip'; p.textContent = emptyText; target.append(p); return; }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'song-result';
    const img = document.createElement('img'); img.src = item.thumbnail || thumb(item.videoId); img.alt = '';
    const content = document.createElement('div'); content.className = 'song-result-main';
    const title = document.createElement('strong'); title.textContent = item.title;
    const artist = document.createElement('small'); artist.textContent = item.artist || item.channel || 'YouTube karaoke';
    const actions = document.createElement('div'); actions.className = 'song-actions';
    const star = document.createElement('button'); star.className = 'mini-btn star-btn'; star.textContent = favoriteIndex(item.videoId) >= 0 ? '★ Saved' : '☆ Save';
    star.onclick = () => {
      const at = favoriteIndex(item.videoId);
      if (at >= 0) favorites.splice(at, 1); else favorites.unshift(item);
      saveFavorites(); renderResults(searchItems, $('search-results'), 'No matches. Try another song or artist.');
      if (view === 'favorites') showMySongs();
    };
    const add = document.createElement('button'); add.className = 'mini-btn add-mini'; add.textContent = '+ Queue'; add.onclick = () => queueSong(item);
    const next = document.createElement('button'); next.className = 'mini-btn'; next.textContent = 'Sing next'; next.onclick = () => queueSong(item, 'next');
    actions.append(star, add, next); content.append(title, artist, actions); row.append(img, content); target.append(row);
  });
}

async function searchSongs() {
  if (!state?.searchEnabled) return;
  const q = $('search-input').value.trim();
  if (q.length < 2) { $('search-tip').textContent = 'Enter at least two characters.'; return; }
  $('search-tip').textContent = 'Searching karaoke songs…';
  $('search-btn').disabled = true;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`); const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    searchItems = data.items || [];
    renderResults(searchItems, $('search-results'), 'No matching karaoke videos. Try another title or artist.');
    $('search-tip').textContent = 'Showing YouTube karaoke videos that allow embedding.';
  } catch (e) { $('search-tip').textContent = e.message; }
  finally { $('search-btn').disabled = false; }
}
$('search-btn').onclick = searchSongs;
$('search-input').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); searchSongs(); } };
$('add-btn').onclick = () => queueSong({ url: $('song-link').value.trim() });

async function control(action) {
  if (!state?.current) return;
  try {
    const res = await fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, action }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Control failed.');
  } catch (e) { feedback(e.message, true); }
}
$('restart-btn').onclick = () => control('restart');
$('rewind-btn').onclick = () => control('rewind');
$('pause-btn').onclick = () => control(state?.playback === 'playing' ? 'pause' : 'play');
$('forward-btn').onclick = () => control('forward');
$('next-btn').onclick = () => control('next');
for (const button of document.querySelectorAll('.reaction-btn')) button.onclick = async () => {
  try { await fetch('/api/react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, type: button.dataset.reaction }) }); } catch {}
};

fetch('/api/state').then(r => r.json()).then(render).catch(() => feedback('Cannot connect to the karaoke server.', true));
const events = new EventSource('/api/events'); events.onmessage = e => render(JSON.parse(e.data));
events.onerror = () => { if (!state) feedback('Connection lost. Reconnecting…', true); };
