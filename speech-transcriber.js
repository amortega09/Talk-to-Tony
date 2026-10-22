/* Portable microphone transcription, independent of the browser's speech service. */
(() => {
  const script = document.currentScript?.src || window.location.href;
  const workerURL = new URL('speech-worker.js?v=80', script);
  let worker = null, pending = null;
  const abortError = () => Object.assign(new Error('Transcription cancelled.'), { name: 'AbortError' });
  function supported() {
    return !!(window.Worker && window.WebAssembly && window.OfflineAudioContext && window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
  }
  function cancel() {
    worker?.terminate(); worker = null;
    if (pending) { const old = pending; pending = null; old.reject(abortError()); }
  }
  async function transcribe(blob, onProgress = () => {}) {
    if (!supported()) throw new Error('Built-in voice is unavailable in this browser. You can type your day below.');
    if (pending) throw new Error('Please wait for the current recording to finish.');
    // Set the pending operation before decoding, so closing also cancels this stage.
    const operation = {};
    const result = new Promise((resolve, reject) => Object.assign(operation, { resolve, reject }));
    pending = operation;
    const timer = setTimeout(() => cancel(), 240000);
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
      if (!worker) worker = new window.Worker(workerURL, { type: 'module' });
      onProgress('Preparing built-in voice. The first use downloads a speech model; later uses are faster.');
      worker.onmessage = ({ data }) => {
        if (pending !== operation) return;
        if (data.type === 'progress') onProgress(`Preparing built-in voice · ${data.percent}% of a model file. Downloaded once, then reused.`);
        if (data.type === 'transcribing') onProgress('Writing down your words on this device…');
        if (data.type === 'result') { pending = null; operation.resolve({ text: data.text }); }
        if (data.type === 'error') { console.warn('Day speech runtime failed:', data.reason); pending = null; worker.terminate(); worker = null; operation.reject(new Error(data.message)); }
      };
      worker.onerror = () => {
        if (pending !== operation) return;
        pending = null; worker.terminate(); worker = null;
        operation.reject(new Error('Built-in voice couldn’t start. Check your connection, then try again or type below.'));
      };
      worker.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
    })().catch(error => {
      if (pending === operation) { pending = null; operation.reject(error); }
    });
    try { return await result; } finally { clearTimeout(timer); }
  }
  window.DaySpeech = { supported, transcribe, cancel };
})();
