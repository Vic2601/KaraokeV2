(() => {
  const button = document.getElementById('mic-btn');
  const status = document.getElementById('mic-status');
  const room = new URLSearchParams(location.search).get('room') || '';
  const id = crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  let events = null;
  let stream = null;
  let pc = null;
  let active = false;
  let starting = false;

  function show(message) { status.textContent = message; }
  async function signal(type, sdp) {
    const response = await fetch('/api/mic/signal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'remote', room, id, type, sdp, name: document.getElementById('singer-name').value.trim() || 'Singer' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Microphone connection failed.');
  }
  function waitForIce(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (peer.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, 6000);
      peer.addEventListener('icegatheringstatechange', check);
    });
  }
  function closeLocal(sendStop = false) {
    const wasActive = active;
    active = false; starting = false;
    events?.close(); events = null;
    pc?.close(); pc = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    button.textContent = '🎤 Use phone as mic'; button.disabled = false;
    if (sendStop && wasActive) signal('stop').catch(() => {});
  }
  async function start() {
    if (!room) return show('Scan the TV QR code to join the room first.');
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return show('This phone browser does not support live microphone sharing. Use a current browser over HTTPS.');
    starting = true; button.disabled = true;
    try {
      show('Allow microphone access on your phone…');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!starting) { stream.getTracks().forEach(track => track.stop()); return; }
      events = new EventSource(`/api/mic/events?role=remote&room=${encodeURIComponent(room)}&id=${encodeURIComponent(id)}`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Could not connect to the karaoke room.')), 7000);
        events.onopen = () => { clearTimeout(timer); resolve(); };
        events.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to the karaoke room.')); };
      });
      events.onmessage = async event => {
        const message = JSON.parse(event.data);
        if (message.type === 'stop') { closeLocal(); show(message.reason || 'Microphone stopped.'); }
        if (message.type === 'answer' && pc) {
          try { await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }); }
          catch { closeLocal(true); show('The TV could not connect to this microphone.'); }
        }
      };
      events.onerror = () => show('Mic connection to the room is reconnecting…');
      const peer = new RTCPeerConnection({ iceServers: [] });
      pc = peer;
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      peer.onconnectionstatechange = () => {
        if (pc !== peer) return;
        if (peer.connectionState === 'connected') show('🎤 Mic is live on the TV. Keep your phone away from the TV speakers.');
        if (peer.connectionState === 'failed') { closeLocal(true); show('Mic connection failed. Keep phone and TV on the same Wi-Fi, then try again.'); }
      };
      show('Connecting to TV…');
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer);
      if (pc !== peer) return;
      await signal('offer', peer.localDescription.sdp);
      active = true; starting = false;
      button.disabled = false; button.textContent = '■ Stop microphone';
    } catch (error) { closeLocal(); show(error.message || 'Could not start the phone mic.'); }
  }
  button.onclick = () => { if (active) { closeLocal(true); show('Microphone stopped.'); } else if (!starting) start(); };
  addEventListener('pagehide', () => {
    if (active) navigator.sendBeacon('/api/mic/signal', new Blob([JSON.stringify({ role: 'remote', room, id, type: 'stop' })], { type: 'application/json' }));
    closeLocal();
  });
})();
