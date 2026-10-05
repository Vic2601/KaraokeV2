(() => {
  const button = document.getElementById('tv-mic-btn');
  const status = document.getElementById('tv-mic-status');
  const host = sessionStorage.getItem('karaoke-host-key') || '';
  let enabled = false;
  let events = null;
  let pc = null;
  let micId = null;
  let context = null;
  let source = null;

  function show(message) { status.textContent = message; }
  async function signal(type, id, sdp) {
    const response = await fetch('/api/mic/signal', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Host-Key': host },
      body: JSON.stringify({ role: 'tv', type, id, sdp })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Microphone connection failed.');
  }
  function closePeer() {
    source?.disconnect(); source = null;
    pc?.close(); pc = null;
    micId = null;
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
  async function receiveOffer(message) {
    if (!enabled) return;
    closePeer();
    micId = message.id;
    const peer = new RTCPeerConnection({ iceServers: [] });
    pc = peer;
    show(`Connecting ${message.name || 'singer'}'s microphone…`);
    peer.ontrack = event => {
      if (pc !== peer || !context) return;
      const stream = event.streams[0] || new MediaStream([event.track]);
      source?.disconnect();
      source = context.createMediaStreamSource(stream);
      source.connect(context.destination);
      show(`🎤 ${message.name || 'Singer'} is live. Keep the phone away from TV speakers to avoid feedback.`);
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        closePeer(); show('Microphone connection ended. Singer can try again.');
      }
    };
    try {
      await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIce(peer);
      if (pc !== peer || !enabled) return;
      await signal('answer', message.id, peer.localDescription.sdp);
    } catch (error) {
      if (pc === peer) { closePeer(); show(error.message || 'Could not connect this phone mic.'); }
      signal('stop', message.id).catch(() => {});
    }
  }
  button.onclick = async () => {
    if (enabled) {
      enabled = false;
      events?.close(); events = null;
      if (micId) signal('stop', micId).catch(() => {});
      closePeer();
      button.textContent = '🎤 Enable phone mic';
      show('Enable this before a singer starts the mic on their phone.');
      return;
    }
    if (!host) return show('Open the full TV link printed by the server to enable the phone mic.');
    if (!window.RTCPeerConnection || !(window.AudioContext || window.webkitAudioContext)) return show('This TV browser does not support phone microphone audio. Try another browser or connect speakers to a laptop.');
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      await context.resume();
      if (context.state !== 'running') throw new Error('The TV did not allow sound. Tap again.');
      enabled = true;
      button.textContent = '🎤 Disable phone mic';
      show('Connecting to room…');
      events = new EventSource(`/api/mic/events?role=tv&host=${encodeURIComponent(host)}`);
      events.onopen = () => show('Ready. Singer can tap Use phone as mic on the remote.');
      events.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'offer') receiveOffer(message);
        if (message.type === 'stop' && message.id === micId) { closePeer(); show('Microphone stopped. Ready for another singer.'); }
      };
      events.onerror = () => show('Mic signaling is reconnecting…');
    } catch (error) { show(error.message || 'Could not enable the phone mic.'); }
  };
})();
