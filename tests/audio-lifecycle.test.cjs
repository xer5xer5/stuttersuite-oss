// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../audio-engine.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function stream() {
  const track = {readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {}};
  return {getTracks: () => [track]};
}
function node() {
  const param = () => ({value: 0, setValueAtTime() {}, setTargetAtTime() {}});
  return {gain: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    connect() { return this; }, disconnect() {}};
}
function harness() {
  const hooks = {worklet: async () => {}, sink: async () => {}, resume: async () => {}, capture: async () => stream()};
  const contexts = [], captures = [];
  class Context {
    constructor() {
      this.state = 'running'; this.currentTime = 0;
      this.audioWorklet = {addModule: () => hooks.worklet(this)};
      contexts.push(this);
    }
    setSinkId() { return hooks.sink(this); }
    createMediaStreamSource(input) { return {...node(), stream: input}; }
    createGain() { return node(); }
    createDynamicsCompressor() { return node(); }
    createWaveShaper() { return node(); }
    resume() { return hooks.resume(this); }
    async close() { this.state = 'closed'; }
  }
  const sandbox = vm.createContext({AudioContext: Context, window: {isSecureContext: true, AudioContext: Context, AudioWorkletNode() {}},
    navigator: {mediaDevices: {getUserMedia(options) { captures.push(options); return hooks.capture(); }}}});
  vm.runInContext(source + ';globalThis.Engine=AssistanceAudioEngine;', sandbox);
  const engine = new sandbox.Engine();
  sandbox.Engine.supportsPitch = () => true;
  // Graph processing is covered by the real AudioWorklet browser test.
  engine.configure = () => {};
  return {engine, hooks, contexts, captures};
}
const settings = {branches: [{enabled: true, pitch: 0}], direct: {enabled: false}, masterGain: -40};
const micFree = {...settings, branches: [{enabled: false, pitch: 0}]};
const turn = () => new Promise(resolve => setImmediate(resolve));
const cancelled = promise => assert.rejects(promise, {name: 'AbortError'});

for (const outcome of ['resolve', 'reject']) {
  test(`cancelled capture ${outcome} does not clear or stop a replacement start`, async t => {
    const {engine, hooks, contexts, captures} = harness();
    t.after(() => engine.stop());
    const oldCapture = deferred(), newCapture = deferred();
    hooks.capture = () => captures.length === 1 ? oldCapture.promise : newCapture.promise;
    const oldStart = cancelled(engine.start({settings}));
    await turn(); assert.equal(captures.length, 1);
    await engine.stop(); assert.equal(engine.starting, null);
    const newStart = engine.start({settings}), pending = engine.starting;
    await turn(); assert.equal(captures.length, 2);
    const lateStream = stream();
    if (outcome === 'resolve') oldCapture.resolve(lateStream);
    else oldCapture.reject(Object.assign(Error('permission denied'), {name: 'NotAllowedError'}));
    await oldStart;
    assert.equal(engine.starting, pending, 'old finally must preserve the new pending start');
    assert.equal(engine.context, contexts[1]); assert.equal(contexts[1].state, 'running');
    if (outcome === 'resolve') assert.equal(lateStream.getTracks()[0].readyState, 'ended');
    const currentStream = stream(); newCapture.resolve(currentStream); await newStart;
    assert.equal(engine.running, true); assert.equal(engine.stream, currentStream);
  });
}

test('a microphone-free session can start before a cancelled permission request settles', async t => {
  const {engine, hooks, captures} = harness(); t.after(() => engine.stop());
  const capture = deferred(); hooks.capture = () => capture.promise;
  const oldStart = cancelled(engine.start({settings})); await turn(); await engine.stop();
  await engine.start({settings: micFree}); const context = engine.context;
  assert.equal(engine.running, true); assert.equal(captures.length, 1);
  const lateStream = stream(); capture.resolve(lateStream); await oldStart;
  assert.equal(lateStream.getTracks()[0].readyState, 'ended');
  assert.equal(engine.running, true); assert.equal(engine.context, context);
});

test('stopping during output selection prevents a later microphone request', async () => {
  const {engine, hooks, captures} = harness(), sink = deferred();
  hooks.sink = () => sink.promise;
  const start = cancelled(engine.start({settings})); await turn(); await engine.stop();
  sink.resolve(); await start;
  assert.equal(captures.length, 0); assert.equal(engine.context, null); assert.equal(engine.starting, null);
});

test('a cancelled worklet failure cannot overwrite the replacement session capability', async t => {
  const {engine, hooks} = harness(); t.after(() => engine.stop());
  const worklet = deferred(); hooks.worklet = () => worklet.promise;
  const oldStart = cancelled(engine.start({settings})); await engine.stop();
  hooks.worklet = async () => {};
  await engine.start({settings: micFree}); const context = engine.context;
  worklet.reject(Error('late module failure')); await oldStart;
  assert.equal(engine.pitchReady, true); assert.equal(engine.running, true); assert.equal(engine.context, context);
});

test('a cancelled resume cannot close a replacement session', async t => {
  const {engine, hooks} = harness(); t.after(() => engine.stop());
  const resume = deferred(); hooks.resume = () => resume.promise;
  const oldStart = cancelled(engine.start({settings: micFree})); await turn(); await engine.stop();
  hooks.resume = async () => {};
  await engine.start({settings: micFree}); const context = engine.context;
  resume.resolve(); await oldStart;
  assert.equal(engine.running, true); assert.equal(engine.context, context); assert.equal(context.state, 'running');
});
