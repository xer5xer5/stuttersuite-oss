// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8').split('let audio =')[0];
function load(saved) {
  const context = vm.createContext({document: {}, crypto, TextEncoder, localStorage: {getItem: () => JSON.stringify(saved)}});
  vm.runInContext(source + ';globalThis.result={data,normalizeCondition,withoutAssistance,prepareData,recoveryRaw,storageBlocked};', context);
  return context.result;
}
const copy = x => JSON.parse(JSON.stringify(x));
test('existing public profiles, drafts and reflection snapshots survive migration', () => {
  const seed = {schema_version: 4, profiles: [{id: 'old', name: '会議', condition: {mode: 'daf', branches: [{enabled: true, delay: 77, pitch: 0, gain: -8, pan: 'left'}]}}], script: '原稿', phrases: [{text: '句', reading: 'く'}], reflections: [{note: 'メモ', conditionSnapshot: {mode: 'daf', branches: [{enabled: true, delay: 99}]}}]};
  const {data} = load(seed);
  assert.equal(data.profiles[0].condition.branches[0].delay, 77);
  assert.equal(data.profiles[0].condition.branches[0].pan, 'left');
  assert.equal(data.script, seed.script); assert.deepEqual(copy(data.phrases), seed.phrases);
  assert.equal(data.reflections[0].note,seed.reflections[0].note);
  assert.equal(data.reflections[0].conditionSnapshot.branches[0].delay,99); assert.equal(data.schema_version, 5);
});
test('invalid nested data and future schemas are preserved for recovery without crashing boot',()=>{
  for(const invalid of [{...{},schema_version:999}, {profiles:[null]}, {profiles:[],phrases:[null]}, {profiles:[],reflections:[null]}]){
    const result=load(invalid);assert.equal(result.storageBlocked,true);assert.equal(result.recoveryRaw,JSON.stringify(invalid));assert.ok(result.data.profiles.length>0);
  }
});
test('backup validation rejects hostile field types, duplicates, oversized content and invalid conditions',()=>{
  const {prepareData}=load(null),valid={schema_version:5,profiles:[{id:'safe',condition:{}}],phrases:[],reflections:[]};
  const bad=[{...valid,phrases:[null]}, {...valid,profiles:[null]}, {...valid,reflections:[{effort:'<a>bad</a>'}]}, {...valid,reflections:[{wouldUse:'<img>'}]}, {...valid,profiles:[{id:'safe'},{id:'safe'}]}, {...valid,script:'x'.repeat(50001)}, {...valid,profiles:[{condition:{masterGain:1}}]}, {...valid,profiles:[{condition:{branches:[{pitch:13}]}}]}, {...valid,profiles:[{condition:{masking:null}}]}, {...valid,schema_version:'5'}, {...valid,schema_version:6}, {...valid,phrases:Array(2001).fill({text:'a'})}];
  for(const value of bad)assert.throws(()=>prepareData(value,{backup:true}));
  const sanitized=prepareData({...valid,secret:'DROP',profiles:[{id:'x"<a>',name:'<b>literal</b>',condition:{},extra:'DROP'}]},{backup:true});
  assert.equal(sanitized.profiles[0].id,'x"<a>');assert.equal(sanitized.profiles[0].name,'<b>literal</b>');assert.equal(sanitized.secret,undefined);assert.equal(sanitized.profiles[0].extra,undefined);
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
