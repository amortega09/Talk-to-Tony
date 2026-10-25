/* Portable microphone transcription, independent of the browser's speech service. */
(() => {
  const script = document.currentScript?.src || window.location.href;
  const workerURL = new URL('speech-worker.js?v=83', script);
  let worker = null, pending = null, warming = null, ready = false, idleTimer = null;
  const abortError = () => Object.assign(new Error('Transcription cancelled.'), { name: 'AbortError' });
  function supported() {
    return !!(window.Worker && window.WebAssembly && window.OfflineAudioContext && window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
  }
  function cancel(reason = abortError()) {
    clearTimeout(idleTimer);idleTimer=null;
    worker?.terminate(); worker = null; ready = false;
    if (warming) { const old = warming; warming = null; clearTimeout(old.timer); old.reject(reason); }
    if (pending) { const old = pending; pending = null; old.reject(reason); }
  }
  function release() {
    if(pending || warming){cancel();return;}
    clearTimeout(idleTimer);idleTimer=setTimeout(()=>cancel(),60000);
  }
  function prepare() {
    clearTimeout(idleTimer);idleTimer=null;
    if (!supported()) return Promise.reject(new Error('Built-in voice is unavailable in this browser.'));
    if (ready) return Promise.resolve();
    if (warming) return warming.promise;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Preparation is speculative; closing the dialog must not produce an unhandled rejection.
    promise.catch(() => {});
    warming = { promise, resolve, reject, timer: setTimeout(() => cancel(new Error('Voice preparation took too long. Check your connection and try again.')), 240000) };
    try {
      const active = worker = new window.Worker(workerURL, { type: 'module' });
      active.onmessage = ({ data }) => {
        if (worker !== active) return;
        if (data.type === 'ready') {
          ready = true;
          if (warming) { const old = warming; warming = null; clearTimeout(old.timer); old.resolve(); }
        }
        if (data.type === 'progress') pending?.onProgress(`Preparing built-in voice · ${data.percent}% of a model file. Downloaded once, then reused.`);
        if (data.type === 'transcribing') pending?.onProgress('Writing down your words on this device…');
        if (data.type === 'result' && pending) { const old = pending; pending = null; old.resolve({ text: data.text }); }
        if (data.type === 'error') { console.warn('Day speech runtime failed:', data.reason); cancel(new Error(data.message)); }
      };
      active.onerror = () => { if (worker === active) cancel(new Error('Built-in voice couldn’t start. Check your connection, then try again or type below.')); };
      active.postMessage({ type: 'prepare' });
    } catch (error) { cancel(error); }
    return promise;
  }
  async function transcribe(blob, onProgress = () => {}) {
    if (!supported()) throw new Error('Built-in voice is unavailable in this browser. You can type your day below.');
    if (pending) throw new Error('Please wait for the current recording to finish.');
    // Set the pending operation before decoding, so closing also cancels this stage.
    const operation = { onProgress };
    const result = new Promise((resolve, reject) => Object.assign(operation, { resolve, reject }));
    pending = operation;
    const timer = setTimeout(() => {
      cancel(new Error('Transcription took too long. Try a shorter recording or type below.'));
    }, 240000);
    (async () => {
      const context = new window.OfflineAudioContext(1, 1, 16000);
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (pending !== operation) return;
      if (decoded.duration > 121) throw new Error('Please keep each recording under two minutes.');
      const audio = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const values = decoded.getChannelData(channel);
        for (let i = 0; i < values.length; i++) audio[i] += values[i] / decoded.numberOfChannels;
      }
      let power = 0, peak = 0;
      for (const sample of audio) { power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      if (!audio.length || Math.sqrt(power / audio.length) < 0.0003 || peak < 0.003) throw new Error('No microphone audio was detected. Check your input device and try again.');
      onProgress(ready ? 'Writing down your words on this device…' : 'Preparing accurate voice. The first use downloads a speech model; later uses are faster.');
      await prepare();
      if (pending !== operation) return;
      worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
    })().catch(error => {
      if (pending === operation) { pending = null; operation.reject(error); }
    });
    try { return await result; } finally { clearTimeout(timer); }
  }
  window.DaySpeech = { supported, prepare, transcribe, cancel, release };
})();
