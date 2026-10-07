// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict');

function peak(samples, rate, expected) {
  let best = 0, frequency = 0;
  for (let f = Math.floor(expected) - 12; f <= Math.ceil(expected) + 12; f++) {
    let real = 0, imag = 0;
    for (let n = rate; n < samples.length; n++) {
      const angle = 2 * Math.PI * f * n / rate;
      real += samples[n] * Math.cos(angle); imag += samples[n] * Math.sin(angle);
    }
    const energy = real * real + imag * imag;
    if (energy > best) { best = energy; frequency = f; }
  }
  return {frequency, energy: best};
}

test('FAF shifts frequency at both common sample rates without changing duration', async () => {
  const {PitchShiftDSP} = await import('../pitch-core.mjs');
  for (const rate of [44100, 48000]) for (const pitch of [-12, -6, -3, -.5, 0, .5, 3, 6, 12]) {
    const input = Float32Array.from({length: rate * 2}, (_, n) => .2 * Math.sin(2 * Math.PI * 440 * n / rate));
    const dsp = new PitchShiftDSP(rate, pitch), out = Float32Array.from(input, x => dsp.process(x));
    const expected = 440 * 2 ** (pitch / 12), result = peak(out, rate, expected);
    assert.ok(Math.abs(result.frequency - expected) < 6, `${rate} Hz, ${pitch} st: ${result.frequency}, expected ${expected}`);
    assert.ok(result.energy > 1000, 'shifted signal must remain audible');
    assert.equal(out.length, input.length); assert.ok(out.every(Number.isFinite));
    if (pitch === 0) assert.deepEqual(out, input);
  }
});

test('silence and invalid samples stay finite; dispose clears buffered voice', async () => {
  const {PitchShiftDSP} = await import('../pitch-core.mjs');
  const dsp = new PitchShiftDSP(48000, 3);
  for (let n = 0; n < 10000; n++) assert.equal(dsp.process(n % 3 ? NaN : Infinity), 0);
  for (let n = 0; n < 6000; n++) dsp.process(.2 * Math.sin(n / 17));
  dsp.clear();
  for (const value of Object.values(dsp)) if (ArrayBuffer.isView(value)) assert.ok(value.every(x => x === 0));
});
