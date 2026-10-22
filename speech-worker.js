/* Pinned browser inference. This worker sends no audio or text to external services. */
let transcriber;
async function load() {
  if (!transcriber) transcriber = (async () => {
    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      device: 'wasm', dtype: 'q8', revision: '79fb389fc764e7c395bd330e9531d9d32ada7049',
      progress_callback: progress => {
        if (progress.status === 'progress') self.postMessage({ type: 'progress', percent: Math.round(progress.progress || 0) });
      }
    });
  })().catch(error => { transcriber = null; throw error; });
  return transcriber;
}
self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;
  try {
    const pipeline = await load();
    self.postMessage({ type: 'transcribing' });
    const result = await pipeline(data.audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
    self.postMessage({ type: 'result', text: result.text?.trim() || '' });
  } catch (error) {
    console.warn('Day speech runtime failed:', error.message);
    self.postMessage({ type: 'error', reason: error.message, message: 'The built-in transcriber couldn’t load. Check your connection and try again, or type below.' });
  }
};
