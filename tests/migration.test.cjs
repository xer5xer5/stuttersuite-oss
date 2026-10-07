// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8').split('let audio =')[0];
function load(saved) {
  const context = vm.createContext({document: {}, crypto, localStorage: {getItem: () => JSON.stringify(saved)}});
  vm.runInContext(source + ';globalThis.result={data,normalizeCondition,withoutAssistance};', context);
  return context.result;
}
const copy = x => JSON.parse(JSON.stringify(x));
test('existing public profiles, drafts and reflection snapshots survive migration', () => {
  const seed = {schema_version: 4, profiles: [{id: 'old', name: '会議', condition: {mode: 'daf', branches: [{enabled: true, delay: 77, pitch: 0, gain: -8, pan: 'left'}]}}], script: '原稿', phrases: [{text: '句', reading: 'く'}], reflections: [{note: 'メモ', conditionSnapshot: {mode: 'daf', branches: [{enabled: true, delay: 99}]}}]};
  const {data} = load(seed);
  assert.equal(data.profiles[0].condition.branches[0].delay, 77);
  assert.equal(data.profiles[0].condition.branches[0].pan, 'left');
  assert.equal(data.script, seed.script); assert.deepEqual(copy(data.phrases), seed.phrases);
  assert.deepEqual(copy(data.reflections), seed.reflections); assert.equal(data.schema_version, 5);
});
test('FAF and combo settings round trip including independent branches', () => {
  const seed = {profiles: [{id: 'new', condition: {mode: 'combo', branches: [{enabled: true, delay: 50, pitch: -3, gain: -9, pan: 'left'}, {enabled: true, delay: 140, pitch: 6, gain: -12, pan: 'right'}]}}], phrases: [], reflections: []};
  const first = load(seed), second = load(copy(first.data));
  assert.deepEqual(copy(second.data), copy(first.data));
  assert.equal(second.data.profiles[0].condition.branches[1].pitch, 6);
  const faf = first.normalizeCondition({mode: 'faf', branches: [{pitch: -3, delay: 200}]});
  assert.equal(faf.branches[0].delay, 0); assert.equal(faf.branches[0].pitch, -3);
  const daf = first.normalizeCondition({mode: 'daf', branches: [{pitch: 8, delay: 50}]});
  assert.equal(daf.branches[0].pitch, 0);
});
test('lost legacy FAF values remain disabled and never get invented', () => {
  for (const profile of [{id: 'legacy', mode: 'faf'}, {id: 'disabled', migrationNote: 'FAF未対応', condition: {mode: 'custom', branches: [{enabled: false, pitch: 0}]}}]) {
    const {data} = load({profiles: [profile]});
    assert.ok(data.profiles[0].condition.branches.every(b => !b.enabled));
    assert.ok(data.profiles[0].condition.branches.every(b => b.pitch === 0));
    assert.ok(data.profiles[0].migrationNote);
  }
});
