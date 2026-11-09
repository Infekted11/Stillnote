import { pipeline } from '@huggingface/transformers';

let transcriberPromise;

self.addEventListener('message', async ({ data }) => {
  if (!['load', 'transcribe'].includes(data?.type)) return;
  const { id, audio } = data;
  try {
    if (!transcriberPromise) {
      transcriberPromise = pipeline('automatic-speech-recognition', 'onnx-community/whisper-medium-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (progress) => self.postMessage({ type: 'progress', id, progress: {
          status: progress.status, file: progress.file, progress: progress.progress,
        } }),
      });
    }
    const transcriber = await transcriberPromise;
    if (data.type === 'load') { self.postMessage({ type: 'ready', id }); return; }
    const result = await transcriber(new Float32Array(audio), {
      chunk_length_s: 30,
      stride_length_s: 5,
      num_beams: 1,
      condition_on_prev_tokens: false,
    });
    self.postMessage({ type: 'result', id, text: String(result?.text || '').trim() });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ type: 'error', id, message: error?.message || 'Local Whisper could not transcribe this audio.' });
  }
});
