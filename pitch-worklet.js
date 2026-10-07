// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later
import {PitchShiftDSP} from './pitch-core.mjs';
class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dsp = new PitchShiftDSP(sampleRate, options.processorOptions?.pitch || 0);
    this.port.onmessage = ({data}) => {
      if (data.type === 'dispose') { this.dsp?.clear(); this.dsp = null; }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!this.dsp) { output?.fill(0); return false; }
    const input = inputs[0]?.[0];
    if (output) for (let i = 0; i < output.length; i++) output[i] = this.dsp.process(input?.[i] ?? 0);
    return true;
  }
}
registerProcessor('stuttersuite-pitch', PitchProcessor);
