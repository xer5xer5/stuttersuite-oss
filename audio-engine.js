// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later
// Microphone -> local DSP -> headphones. No recording, storage or upload path.
class AssistanceAudioEngine {
  constructor({onPulse, onFault} = {}) {
    this.onPulse = onPulse || (() => {});
    this.onFault = onFault || (() => {});
    this.context = this.stream = this.source = this.master = null;
    this.modules = new Map(); this.retired = new Set();
    this.running = this.muted = false; this.generation = 0;
    this.starting = null; this.pitchReady = false;
    this.outputSwitch = null; this.outputDeviceId = 'default';
  }

  static supportsPitch() {
    return !!window.isSecureContext && typeof window.AudioWorkletNode === 'function' &&
      !!window.AudioContext && 'audioWorklet' in window.AudioContext.prototype;
  }

  async start({inputDeviceId = 'default', outputDeviceId = 'default', settings}) {
    if (this.starting) return this.starting;
    if (this.running) return {warnings: []};
    const generation = ++this.generation;
    const starting = this.startInternal({inputDeviceId, outputDeviceId, settings}, generation);
    this.starting = starting;
    try { return await starting; }
    finally { if (this.starting === starting) this.starting = null; }
  }

  checkStart(generation) {
    if (generation !== this.generation) {
      const error = new Error('開始を取り消しました。');
      error.name = 'AbortError';
      throw error;
    }
  }

  async startInternal({inputDeviceId, outputDeviceId, settings}, generation) {
    const context = new AudioContext({latencyHint: 'interactive'});
    this.context = context;
    const warnings = [];
    try {
      const needsPitch = settings.branches.some(b => b.enabled && b.pitch !== 0);
      let pitchReady = false;
      if (AssistanceAudioEngine.supportsPitch()) {
        try {
          await context.audioWorklet.addModule('pitch-worklet.js');
          pitchReady = true;
        } catch {
          warnings.push('音程処理を読み込めませんでした。DAFは利用できます。再読み込みするかブラウザ・接続を確認してください。');
        }
      }
      this.checkStart(generation);
      this.pitchReady = pitchReady;
      if (needsPitch && !this.pitchReady) throw Error('FAFを開始できません。HTTPS接続と対応ブラウザを確認してください。DAFは音程を0にして利用できます。');
      if (typeof context.setSinkId === 'function') {
        try { await this.setOutputDevice(outputDeviceId); }
        catch { throw Error('選択した出力先を使えません。ヘッドホンの接続と出力先を確認してください。'); }
      } else if (outputDeviceId !== 'default') {
        warnings.push('このブラウザは出力先切替に対応していません。OS／ブラウザの出力をヘッドホンに設定してください。');
      }
      this.checkStart(generation);
      if (settings.branches.some(b => b.enabled) || settings.direct.enabled) {
        const constraints = {echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1};
        if (inputDeviceId !== 'default') constraints.deviceId = {exact: inputDeviceId};
        const stream = await navigator.mediaDevices.getUserMedia({audio: constraints, video: false});
        if (generation !== this.generation) {
          stream.getTracks().forEach(t => t.stop());
          this.checkStart(generation);
        }
        this.stream = stream;
        this.source = context.createMediaStreamSource(stream);
        stream.getTracks().forEach(t => t.addEventListener('ended', () => {
          if (this.stream === stream) this.onFault('マイクが切断されたため停止しました。');
        }));
      }
      this.checkStart(generation);
      this.master = context.createGain(); this.master.gain.value = 0;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = .003; limiter.release.value = .05;
      const ceiling = context.createWaveShaper(), curve = new Float32Array(8193), limit = 10 ** (-3 / 20);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.max(-limit, Math.min(limit, 2 * i / (curve.length - 1) - 1));
      ceiling.curve = curve;
      this.master.connect(limiter).connect(ceiling).connect(context.destination);
      await context.resume();
      this.checkStart(generation);
      this.running = true; this.muted = false;
      this.configure(settings); this.setMasterGain(settings.masterGain);
      return {warnings};
    } catch (error) {
      // A cancelled attempt owns no current session; stop() already released it.
      this.checkStart(generation);
      await this.stop();
      throw error;
    }
  }

  setOutputDevice(outputDeviceId = 'default') {
    const context = this.context, generation = this.generation;
    if (typeof context?.setSinkId !== 'function') return Promise.reject(Error('出力先切替に対応していません。'));
    const sinkId = outputDeviceId === 'default' ? '' : outputDeviceId;
    // Serialize native calls: request numbers alone cannot undo a late native switch.
    const switching = (this.outputSwitch || Promise.resolve()).catch(() => {}).then(async () => {
      this.checkStart(generation);
      try { await context.setSinkId(sinkId); }
      catch (error) {
        this.checkStart(generation);
        if (typeof context.sinkId === 'string') this.outputDeviceId = context.sinkId || 'default';
        throw error;
      }
      this.checkStart(generation);
      this.outputDeviceId = typeof context.sinkId === 'string' ? context.sinkId || 'default' : outputDeviceId;
      if (typeof context.sinkId === 'string' && context.sinkId !== sinkId) throw Error('出力先の切替を確認できませんでした。');
      return outputDeviceId;
    });
    this.outputSwitch = switching;
    return switching;
  }

  configure(settings) {
    if (!this.running || this.muted) return;
    if (settings.branches.some(b => b.enabled && b.pitch !== 0) && !this.pitchReady) {
      throw Error('音程処理が利用できません。音程を0に戻すか、対応環境で再読み込みしてください。');
    }
    const previous = this.modules, next = new Map(), created = [];
    const previousNormalization = this.normalization;
    const branches = settings.branches.filter(b => b.enabled);
    const weight = branches.reduce((sum, b) => sum + dbToGain(b.gain), 0) +
      (settings.direct.enabled ? dbToGain(settings.direct.gain) : 0) +
      (settings.masking.enabled ? dbToGain(settings.masking.gain) : 0) +
      (settings.metronome.enabled ? .018 : 0);
    this.normalization = Math.max(1, weight);
    try {
      const desired = [];
      settings.branches.forEach((b,i) => {if(b.enabled)desired.push({key:`branch-${i}`,signature:`branch:${!!b.pitch}`,settings:b,create:()=>this.createBranch(b)});});
      if (settings.direct.enabled) {const direct={...settings.direct,delay:0,pitch:0};desired.push({key:'direct',signature:'branch:false',settings:direct,create:()=>this.createBranch(direct)});}
      if (settings.masking.enabled) desired.push({key:'masking',signature:`masking:${settings.masking.type}`,settings:settings.masking,create:()=>this.createMasking(settings.masking)});
      if (settings.metronome.enabled) desired.push({key:'metronome',signature:'metronome',settings:settings.metronome,create:()=>this.createMetronome(settings.metronome)});
      for (const item of desired) {
        let module = previous.get(item.key);
        if (module?.signature !== item.signature) {module=item.create();module.signature=item.signature;created.push(module);}
        next.set(item.key,module);
      }
      for (const item of desired) next.get(item.key).update(item.settings);
    } catch (error) {
      created.forEach(m => m.stop()); this.normalization=previousNormalization;
      throw error;
    }
    this.modules=next;
    previous.forEach((module,key) => {
      if(next.get(key)===module)return;
      module.gate.gain.setTargetAtTime(0, this.context.currentTime, .008);
      this.retired.add(module);
      setTimeout(() => { module.stop(); this.retired.delete(module); }, 60);
    });
  }

  gate() {
    const gate = this.context.createGain(); gate.gain.value = 0;
    gate.connect(this.master); gate.gain.setTargetAtTime(1, this.context.currentTime, .015);
    return gate;
  }

  createBranch(branch) {
    if (!this.source) throw Error('マイクが未使用です。補助を停止してから改めて開始してください。');
    const context = this.context, delay = context.createDelay(.31), level = context.createGain(),
      pan = context.createStereoPanner();
    const shifter = branch.pitch ? new AudioWorkletNode(context, 'stuttersuite-pitch', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: {pitch: branch.pitch}
    }) : null;
    const gate = this.gate(), first = shifter || delay, input = this.source;
    input.connect(first); if (shifter) shifter.connect(delay);
    delay.delayTime.value = branch.delay / 1000;
    level.gain.value = dbToGain(branch.gain) / this.normalization;
    pan.pan.value = panValue(branch.pan);
    delay.connect(level).connect(pan).connect(gate);
    if (shifter) shifter.onprocessorerror = () => this.onFault('音程処理でエラーが発生したため停止しました。');
    let stopped = false;
    const normalization=()=>this.normalization;
    let currentPitch=branch.pitch;
    return {gate, update(settings) {
      delay.delayTime.setTargetAtTime(settings.delay/1000,context.currentTime,.015);
      level.gain.setTargetAtTime(dbToGain(settings.gain)/normalization(),context.currentTime,.015);
      pan.pan.setTargetAtTime(panValue(settings.pan),context.currentTime,.015);
      if(shifter&&settings.pitch!==currentPitch){shifter.port.postMessage({type:'pitch',value:settings.pitch});currentPitch=settings.pitch;}
    }, stop() {
      if (stopped) return; stopped = true;
      try { input.disconnect(first); } catch {}
      if (shifter) { shifter.onprocessorerror = null; shifter.port.postMessage({type: 'dispose'}); shifter.port.close(); }
      [shifter, delay, level, pan, gate].filter(Boolean).forEach(n => { try { n.disconnect(); } catch {} });
    }};
  }

  createMasking(settings) {
    const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(),
      level = this.context.createGain(), gate = this.gate();
    source.buffer = makeNoiseBuffer(this.context, settings.type); source.loop = true;
    filter.type = settings.filter === 'none' ? 'allpass' : settings.filter;
    filter.frequency.value = settings.filter === 'highpass' ? 180 : settings.filter === 'lowpass' ? 6000 : 1000;
    level.gain.value = dbToGain(settings.gain) / this.normalization;
    source.connect(filter).connect(level).connect(gate); source.start();
    const context=this.context,normalization=()=>this.normalization;
    return {gate, update(value) {
      filter.type=value.filter==='none'?'allpass':value.filter;
      filter.frequency.setTargetAtTime(value.filter==='highpass'?180:value.filter==='lowpass'?6000:1000,context.currentTime,.015);
      level.gain.setTargetAtTime(dbToGain(value.gain)/normalization(),context.currentTime,.015);
    }, stop() { try { source.stop(); } catch {} [source, filter, level, gate].forEach(n => { try { n.disconnect(); } catch {} }); }};
  }

  createMetronome(settings) {
    const context = this.context, gate = this.gate(), nodes = new Set();
    let current={...settings};
    const tick = () => {
      if (current.type !== 'sound') this.onPulse();
      if (current.type === 'visual' || this.muted) return;
      const osc = context.createOscillator(), level = context.createGain();
      osc.frequency.value = 880; level.gain.value = .018 / this.normalization;
      osc.connect(level).connect(gate); nodes.add(osc);
      osc.onended = () => { nodes.delete(osc); osc.disconnect(); level.disconnect(); };
      osc.start(); osc.stop(context.currentTime + .035);
    };
    tick(); let timer = setInterval(tick, 60000 / current.bpm);
    return {gate, update(value) {const changed=value.bpm!==current.bpm;current={...value};if(changed){clearInterval(timer);timer=setInterval(tick,60000/current.bpm);}},stop() { clearInterval(timer); nodes.forEach(n => { try { n.stop(); } catch {} }); gate.disconnect(); }};
  }

  setMasterGain(value) {
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(dbToGain(value), this.context.currentTime, .035);
  }

  // Stop releases the microphone, closes the DSP context and drops all buffer owners.
  mute() { return this.stop(); }
  async stop() {
    const generation = ++this.generation;
    this.starting = null; this.running = false; this.muted = true;
    this.outputSwitch = null; this.outputDeviceId = 'default';
    const context = this.context, stream = this.stream;
    if (this.master && context?.state !== 'closed') this.master.gain.setValueAtTime(0, context.currentTime);
    this.stream = null; stream?.getTracks().forEach(t => t.stop());
    this.modules.forEach(m => m.stop()); this.retired.forEach(m => m.stop());
    this.modules.clear(); this.retired.clear();
    this.context = this.source = this.master = null; this.pitchReady = false;
    if (context && context.state !== 'closed') await context.close();
    if (generation === this.generation) this.muted = false;
  }
}
function dbToGain(value) { return Math.pow(10, Number(value) / 20); }
function panValue(value) { return value === 'left' ? -1 : value === 'right' ? 1 : 0; }
function makeNoiseBuffer(context, type) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), out = buffer.getChannelData(0);
  let pink = 0, brown = 0;
  for (let i = 0; i < out.length; i++) {
    const white = Math.random() * 2 - 1;
    pink = .98 * pink + .02 * white; brown = Math.max(-1, Math.min(1, (brown + .02 * white) / 1.02));
    out[i] = type === 'pink' ? pink * 3.5 : type === 'brown' ? brown * 3.5 : white;
  }
  return buffer;
}
