/* Local Web Audio modules.  No audio leaves the browser. */
class AssistanceAudioEngine {
  constructor({ onPulse } = {}) {
    this.onPulse = onPulse || (() => {});
    this.context = null;
    this.stream = null;
    this.source = null;
    this.master = null;
    this.limiter = null;
    this.modules = new Map();
    this.running = false;
    this.muted = false;
  }

  async start({ inputDeviceId = 'default', outputDeviceId = 'default', settings }) {
    if (this.running) return { warnings: [] };
    try {
      const audio = inputDeviceId === 'default'
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        : { deviceId: { exact: inputDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      const warnings = [];
      if (typeof this.context.setSinkId === 'function') {
        try { await this.context.setSinkId(outputDeviceId === 'default' ? '' : outputDeviceId); }
        catch { warnings.push('選択した出力先へ切り替えられませんでした。ブラウザまたはOSの既定出力を確認してください。'); }
      } else if (outputDeviceId !== 'default') {
        warnings.push('このブラウザは補助音の出力先切替に対応していません。OSまたはブラウザの既定出力を使います。');
      }
      this.source = this.context.createMediaStreamSource(this.stream);
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.limiter = this.context.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = .003;
      this.limiter.release.value = .05;
      this.master.connect(this.limiter).connect(this.context.destination);
      this.running = true;
      this.configure(settings);
      this.setMasterGain(settings.masterGain);
      return { warnings };
    } catch (error) {
      try { await this.stop(); } catch {}
      throw error;
    }
  }

  configure(settings) {
    if (!this.running) return;
    this.stopModules();
    const branches = settings.branches.filter(branch => branch.enabled);
    const normalization = Math.max(1, branches.reduce((sum, branch) => sum + Math.abs(dbToGain(branch.gain)), 0));
    branches.forEach((branch, index) => this.addModule(`branch-${index}`, this.createSelfVoiceBranch(branch, normalization)));
    if (settings.direct.enabled) this.addModule('direct', this.createDirectFeedback(settings.direct));
    if (settings.masking.enabled) this.addModule('masking', this.createMasking(settings.masking));
    if (settings.metronome.enabled) this.addModule('metronome', this.createMetronome(settings.metronome));
  }

  setMasterGain(value) {
    if (!this.master || this.muted) return;
    this.master.gain.setTargetAtTime(dbToGain(value), this.context.currentTime, .035);
  }

  createSelfVoiceBranch(branch, normalization) {
    const delay = this.context.createDelay(.31);
    const level = this.context.createGain();
    const pan = this.context.createStereoPanner();
    delay.delayTime.value = Math.max(0, Number(branch.delay) || 0) / 1000;
    level.gain.value = 0;
    pan.pan.value = panValue(branch.pan);
    this.source.connect(delay).connect(level).connect(pan).connect(this.master);
    level.gain.setTargetAtTime(dbToGain(branch.gain) / normalization, this.context.currentTime, .02);
    return nodeModule([delay, level, pan]);
  }

  createDirectFeedback(settings) {
    const level = this.context.createGain();
    const pan = this.context.createStereoPanner();
    level.gain.value = 0;
    pan.pan.value = panValue(settings.pan);
    this.source.connect(level).connect(pan).connect(this.master);
    level.gain.setTargetAtTime(dbToGain(settings.gain), this.context.currentTime, .02);
    return nodeModule([level, pan]);
  }

  createMasking(settings) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const level = this.context.createGain();
    source.buffer = makeNoiseBuffer(this.context, settings.type);
    source.loop = true;
    filter.type = settings.filter === 'none' ? 'allpass' : settings.filter;
    filter.frequency.value = settings.filter === 'highpass' ? 180 : settings.filter === 'lowpass' ? 6000 : 1000;
    level.gain.value = 0;
    source.connect(filter).connect(level).connect(this.master);
    source.start();
    level.gain.setTargetAtTime(dbToGain(settings.gain), this.context.currentTime, .08);
    return nodeModule([source, filter, level], () => { try { source.stop(); } catch {} });
  }

  createMetronome(settings) {
    let timer = null;
    const tick = () => {
      if (settings.type !== 'sound') this.onPulse();
      if (settings.type === 'visual') return;
      const oscillator = this.context.createOscillator();
      const level = this.context.createGain();
      oscillator.frequency.value = 880;
      level.gain.value = .018;
      oscillator.connect(level).connect(this.master);
      oscillator.start();
      oscillator.stop(this.context.currentTime + .035);
    };
    tick();
    timer = setInterval(tick, 60000 / Math.max(30, Math.min(180, Number(settings.bpm) || 60)));
    return { stop: () => clearInterval(timer) };
  }

  addModule(name, module) { this.modules.set(name, module); }
  stopModules() {
    // Disconnecting downstream nodes alone leaves source -> old module links intact.
    // The microphone source has no other routes in this engine, so clear its fan-out first.
    if (this.source) { try { this.source.disconnect(); } catch {} }
    this.modules.forEach(module => module.stop());
    this.modules.clear();
  }

  mute() {
    if (!this.running || this.muted) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(0, this.context.currentTime, .004);
    this.muted = true;
  }

  async stop() {
    this.stopModules();
    if (this.stream) this.stream.getTracks().forEach(track => track.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = this.stream = this.source = this.master = this.limiter = null;
    this.running = this.muted = false;
  }
}

function dbToGain(value) { return Math.pow(10, Number(value) / 20); }
function panValue(value) { return value === 'left' ? -1 : value === 'right' ? 1 : 0; }
function nodeModule(nodes, beforeStop = () => {}) {
  return { stop() { beforeStop(); nodes.forEach(node => { try { node.disconnect(); } catch {} }); } };
}
function makeNoiseBuffer(context, type) {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const output = buffer.getChannelData(0);
  let pink = 0, brown = 0;
  for (let i = 0; i < output.length; i++) {
    const white = Math.random() * 2 - 1;
    pink = .98 * pink + .02 * white;
    brown = Math.max(-1, Math.min(1, (brown + .02 * white) / 1.02));
    output[i] = type === 'pink' ? pink * 3.5 : type === 'brown' ? brown * 3.5 : white;
  }
  return buffer;
}
