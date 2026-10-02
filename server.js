const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const API_KEY_FILE = path.join(__dirname, 'youtube-api-key.txt');
const ROOT = path.join(__dirname, 'public');
const room = crypto.randomBytes(3).toString('hex').toUpperCase();
const hostKey = crypto.randomBytes(16).toString('hex');
const state = { room, current: null, queue: [], playback: 'paused', command: null, reaction: null, revision: 0 };
const listeners = new Set();
let lastReactionAt = 0;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function localAddress() {
  const all = Object.values(os.networkInterfaces()).flat();
  return all.find(x => x && x.family === 'IPv4' && !x.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address))?.address
    || all.find(x => x && x.family === 'IPv4' && !x.internal)?.address
    || 'localhost';
}
const publicOrigin = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://${localAddress()}:${PORT}`).replace(/\/$/, '');

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(data));
}
function apiKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY.trim();
  try { return fs.readFileSync(API_KEY_FILE, 'utf8').trim(); } catch { return ''; }
}
function snapshot() { return { ...state, remoteUrl: `${publicOrigin}/remote?room=${room}`, searchEnabled: !!apiKey() }; }
function advance() {
  state.current = state.queue.shift() || null;
  state.playback = state.current ? 'playing' : 'paused';
  state.command = null;
  publish();
}
function publish() {
  state.revision++;
  const message = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of listeners) { try { res.write(message); } catch { listeners.delete(res); } }
}
function videoId(input) {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('Request is too large');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
}
async function titleFor(id) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (response.ok) return String((await response.json()).title || '').slice(0, 140);
  } catch {}
  return '';
}
function serveFile(req, res, pathname) {
  let file = pathname === '/' || pathname === '/tv' ? '/tv.html' : pathname === '/remote' ? '/remote.html' : pathname;
  file = path.normalize(path.join(ROOT, decodeURIComponent(file)));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, snapshot());
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      listeners.add(res);
      req.on('close', () => listeners.delete(res));
      return;
    }
    if (p === '/api/search' && req.method === 'GET') {
      const key = apiKey();
      if (!key) return send(res, 503, { error: 'Song search needs a YouTube Data API key on the server. Use Paste a link until it is set up.' });
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (q.length < 2) return send(res, 400, { error: 'Enter at least two characters.' });
      const api = new URL('https://www.googleapis.com/youtube/v3/search');
      for (const [k, v] of Object.entries({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '12', q: `${q} karaoke`, key })) api.searchParams.set(k, v);
      try {
        const response = await fetch(api, { signal: AbortSignal.timeout(7000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || 'YouTube search failed');
        const online = (result.items || []).map(x => ({ videoId: x.id.videoId, title: x.snippet.title, artist: x.snippet.channelTitle, channel: x.snippet.channelTitle, thumbnail: x.snippet.thumbnails?.medium?.url, source: 'youtube' }));
        return send(res, 200, { items: online, catalogOnly: false });
      } catch (error) { return send(res, 502, { error: error.message || 'YouTube search failed.' }); }
    }
    if (p === '/api/queue' && req.method === 'POST') {
      const data = await body(req);
      if (data.room !== room) return send(res, 403, { error: 'This party code is no longer active. Scan the TV again.' });
      const id = videoId(String(data.url || ''));
      if (!id) return send(res, 400, { error: 'Paste a valid YouTube video link.' });
      if (state.queue.length >= 50) return send(res, 429, { error: 'The queue is full.' });
      const fallback = `YouTube video · ${id}`;
      const item = { id: crypto.randomUUID(), videoId: id, title: String(data.title || '').trim().slice(0, 140) || await titleFor(id) || fallback, by: String(data.by || '').trim().slice(0, 32) || 'Guest' };
      if (!state.current) { state.current = item; state.playback = 'paused'; }
      else if (data.position === 'next') state.queue.unshift(item);
      else state.queue.push(item);
      publish();
      return send(res, 201, { item, state: snapshot() });
    }
    if (p === '/api/next' && req.method === 'POST') {
      if (req.headers['x-host-key'] !== hostKey) return send(res, 403, { error: 'TV controls only.' });
      advance();
      return send(res, 200, snapshot());
    }
    if (p === '/api/control' && req.method === 'POST') {
      const data = await body(req);
      if (data.room !== room) return send(res, 403, { error: 'This party code is no longer active. Scan the TV again.' });
      if (!['next', 'pause', 'play', 'restart', 'rewind', 'forward'].includes(data.action)) return send(res, 400, { error: 'Unknown control.' });
      if (!state.current) return send(res, 409, { error: 'There is no song playing yet.' });
      if (data.action === 'next') advance();
      else if (data.action === 'play' || data.action === 'pause') { state.playback = data.action === 'play' ? 'playing' : 'paused'; publish(); }
      else { state.command = { seq: (state.command?.seq || 0) + 1, action: data.action }; publish(); }
      return send(res, 200, snapshot());
    }
    if (p === '/api/react' && req.method === 'POST') {
      const data = await body(req);
      if (data.room !== room) return send(res, 403, { error: 'This party code is no longer active.' });
      if (!['clap', 'cheer', 'party', 'airhorn', 'fire'].includes(data.type)) return send(res, 400, { error: 'Unknown reaction.' });
      if (Date.now() - lastReactionAt < 350) return send(res, 429, { error: 'Wait a moment before cheering again.' });
      lastReactionAt = Date.now();
      state.reaction = { seq: (state.reaction?.seq || 0) + 1, type: data.type };
      publish();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/playback' && req.method === 'POST') {
      if (req.headers['x-host-key'] !== hostKey) return send(res, 403, { error: 'TV controls only.' });
      const data = await body(req);
      if (!state.current || !['playing', 'paused'].includes(data.playback)) return send(res, 400, { error: 'Invalid playback state.' });
      state.playback = data.playback;
      publish();
      return send(res, 200, snapshot());
    }
    if (p === '/api/remove' && req.method === 'POST') {
      if (req.headers['x-host-key'] !== hostKey) return send(res, 403, { error: 'TV controls only.' });
      const data = await body(req);
      state.queue = state.queue.filter(x => x.id !== data.id);
      publish();
      return send(res, 200, snapshot());
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    serveFile(req, res, p);
  } catch (error) { send(res, 400, { error: error.message || 'Something went wrong.' }); }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nVicci & Lexi Karaoke is ready\nTV:     ${publicOrigin}/tv?host=${hostKey}\nPhones: ${publicOrigin}/remote?room=${room}\nParty code: ${room}\n`);
});
