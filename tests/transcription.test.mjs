import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
function setup() {
  let text = 'My note\nExisting content', saves = 0;
  const view = { state: { doc: { get length() { return text.length; }, toString: () => text } }, dispatch: ({changes}) => { text = text.slice(0, changes.from) + changes.insert + text.slice(changes.from); } };
  const button = { classList: { toggle() {}, remove() {} }, setAttribute() {}, disabled: false };
  const context = vm.createContext({ state: {view,active:'My note.md'}, $: () => button, clearInterval, setInterval, Float32Array,
    saveActive: async () => { saves++; }, showToast() {} });
  const start = source.indexOf('let meetingRecording = false;');
  const end = source.indexOf("$('#meeting-notes-trigger').addEventListener('click'", start);
  vm.runInContext(source.slice(start,end).replaceAll('import.meta.url', '"file:///test/main.js"'), context);
  vm.runInContext(`meetingTargetView = state.view; meetingRecording = true;
    meetingAudioContext = { sampleRate: 16000, close: async () => {}, state: 'running' };
    transcribeMeetingAudio = async () => 'Recognized speech.';`, context);
  return {context, text: () => text, saves: () => saves};
}
test('recognized chunks append immediately without replacing note content', async () => {
  const {context,text} = setup();
  await vm.runInContext('queueMeetingAudio(new Float32Array(64000).fill(.1), meetingCaptureGeneration); meetingTranscriptionQueue',context);
  assert.equal(text(),'My note\nExisting content\nRecognized speech.\n');
});
test('stop flushes audio shorter than the live chunk and saves the original note', async () => {
  const {context,text,saves} = setup();
  await vm.runInContext('meetingAudioChunks = [new Float32Array(16000).fill(.1)]; meetingAudioSampleCount = 16000; stopMeetingRecording()',context);
  assert.match(text(), /Existing content\nRecognized speech\.\n$/);
  assert.equal(saves(),1);
  assert.equal(vm.runInContext('meetingRecording',context),false);
});
test('silence and stale recording sessions do not append', async () => {
  const {context,text} = setup();
  await vm.runInContext('queueMeetingAudio(new Float32Array(64000), meetingCaptureGeneration); queueMeetingAudio(new Float32Array(64000).fill(.1), meetingCaptureGeneration - 1); meetingTranscriptionQueue',context);
  assert.equal(text(),'My note\nExisting content');
});
test('late output cannot append into a different open note', () => {
  const {context,text} = setup();
  vm.runInContext("state.view = {}; appendMeetingText('Wrong note');",context);
  assert.equal(text(),'My note\nExisting content');
});


test('live capture waits for fifteen seconds before queueing audio', async () => {
  const {context,text} = setup();
  await vm.runInContext('meetingAudioChunks = [new Float32Array(16000 * 14).fill(.1)]; meetingAudioSampleCount = 16000 * 14; drainMeetingAudio(); meetingTranscriptionQueue', context);
  assert.equal(text(), 'My note\nExisting content');
  assert.equal(vm.runInContext('meetingAudioSampleCount', context), 16000 * 14);
  await vm.runInContext('meetingAudioChunks.push(new Float32Array(16000).fill(.1)); meetingAudioSampleCount += 16000; drainMeetingAudio(); meetingTranscriptionQueue', context);
  assert.match(text(), /Recognized speech/);
  assert.equal(vm.runInContext('meetingAudioSampleCount', context), 0);
});
