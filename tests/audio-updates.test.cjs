// SPDX-License-Identifier: AGPL-3.0-or-later
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
  const nodes=[],timeouts=[],intervals=new Set();
  const param=()=>({value:0,setTargetAtTime(value){this.value=value;},setValueAtTime(value){this.value=value;}});
  const node=()=>{const n={gain:param(),pan:param(),delayTime:param(),frequency:param(),connect(){return this;},disconnect(){},start(){},stop(){this.stopped=true;},port:{messages:[],postMessage(value){this.messages.push(value);},close(){this.closed=true;}}};nodes.push(n);return n;};
  const context={currentTime:0,sampleRate:48000,state:'running',createGain:node,createDelay:node,createStereoPanner:node,createBufferSource:node,createBiquadFilter:node,createOscillator:node,createBuffer(_channels,length){return {getChannelData(){return new Float32Array(length);}};},async close(){this.state='closed';}};
  const sandbox=vm.createContext({window:{},AudioWorkletNode:function(){return node();},setTimeout(fn){timeouts.push(fn);},setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}});
  vm.runInContext(fs.readFileSync(require.resolve('../audio-engine.js'),'utf8')+';globalThis.Engine=AssistanceAudioEngine;',sandbox);
  const engine=new sandbox.Engine();engine.context=context;engine.source=node();engine.master=node();engine.running=true;engine.pitchReady=true;
  return {engine,nodes,timeouts,intervals};
}
const settings=()=>({branches:[{enabled:true,pitch:3,delay:50,gain:-6,pan:'left'},{enabled:true,pitch:-3,delay:100,gain:-9,pan:'right'}],direct:{enabled:false},masking:{enabled:true,type:'white',gain:-42,filter:'none'},metronome:{enabled:false},masterGain:-40});
test('1000 live numeric changes preserve AudioNodes and send pitch updates to the existing worklet',async()=>{
  const {engine,nodes}=harness(),value=settings();engine.configure(value);const original=[...engine.modules.values()],count=nodes.length;
  for(let i=0;i<1000;i++){value.branches[0]={...value.branches[0],pitch:3+i%4,delay:i%300,gain:-6-i%12,pan:i%2?'both':'left'};value.masking={...value.masking,gain:-42+i%12,filter:i%2?'highpass':'none'};engine.configure(value);}
  assert.equal(nodes.length,count);assert.equal(engine.retired.size,0);assert.deepEqual([...engine.modules.values()],original);assert.ok(nodes.some(node=>node.port.messages.some(message=>message.type==='pitch')));
  await engine.stop();assert.equal(engine.modules.size,0);assert.equal(engine.retired.size,0);assert.ok(nodes.some(node=>node.port.closed));
});
test('only topology changes rebuild modules, and metronome updates keep one timer',async()=>{
  const {engine,timeouts,intervals}=harness(),value=settings();value.metronome={enabled:true,bpm:60,type:'visual'};engine.configure(value);
  const original=new Map(engine.modules);value.branches[0].pitch=0;value.masking.type='pink';value.metronome={enabled:true,bpm:90,type:'both'};engine.configure(value);
  assert.notEqual(engine.modules.get('branch-0'),original.get('branch-0'));assert.equal(engine.modules.get('branch-1'),original.get('branch-1'));assert.notEqual(engine.modules.get('masking'),original.get('masking'));assert.equal(engine.modules.get('metronome'),original.get('metronome'));assert.equal(intervals.size,1);
  for(let i=0;i<1200;i++){value.metronome.bpm=30+i%150;engine.configure(value);assert.equal(intervals.size,1);}
  await engine.stop();timeouts.forEach(fn=>fn());assert.equal(intervals.size,0);assert.equal(engine.retired.size,0);
});
