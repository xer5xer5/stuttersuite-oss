// SPDX-License-Identifier: AGPL-3.0-or-later
// Run with Electron. All microphone inputs below are synthetic; no real voice is captured.
const {app, BrowserWindow, session} = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createServer} = require('../server.js');
app.setPath('userData', path.join(__dirname, '..', '.test-output', `profile-${Date.now()}`));
let server, window;
async function run() {
  server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const timeout=setTimeout(()=>{console.error('Browser test timeout');app.exit(1);},90000);
  const origin = `http://127.0.0.1:${server.address().port}`, requests = [], errors = [];
  const isolated = session.fromPartition(`oss-test-${Date.now()}`);
  isolated.webRequest.onBeforeRequest((details, callback) => { requests.push({url: details.url, method: details.method}); callback({cancel: !details.url.startsWith(origin + '/')}); });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({width: 1280, height: 1000, show: false, webPreferences: {session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false}});
  window.webContents.on('console-message', event => { if (event.level >= 3) errors.push(event.message); });
  await window.loadURL(origin + '/');
  const execute = async script => { try { return await window.webContents.executeJavaScript(script, true); } catch(e) { throw Error(script.slice(0,150)+'\n'+e.message); } };
  await execute(`globalThis.check=(value,message)=>{if(!value)throw Error(message);};globalThis.waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('wait timed out');};void 0;`);
  assert.equal(await execute(`AssistanceAudioEngine.supportsPitch()`), true);
  await execute(`document.querySelector('[data-help="guide-start"]').click();check(document.querySelector('#page-guide').classList.contains('active'),'guide navigation');check(!audio.stream,'guide must not capture microphone');`);
  await execute(`go('assist');document.querySelector('[data-mode="faf"]').click();`);
  await execute(`waitFor(()=>document.querySelector('[data-mode="faf"]').classList.contains('selected'))`);
  const faf = await execute(`currentCondition()`); assert.equal(faf.branches[0].pitch, -3); assert.equal(faf.branches[0].delay, 0);
  await execute(`document.querySelector('#pitchA').value=4.5;document.querySelector('#pitchA').dispatchEvent(new Event('input'));check(document.querySelector('#pitchAValue').textContent==='4.5 半音','fractional pitch label');document.querySelector('#settingLock').click();check(document.querySelector('#pitchA').disabled,'lock');document.querySelector('#settingLock').click();check(!document.querySelector('#pitchA').disabled,'unlock');`);
  await execute(`data.profiles.push({id:'test',name:'FAF test',scene:'test',condition:currentCondition()});persist();`);
  await window.reload(); await execute(`globalThis.check=(v,m)=>{if(!v)throw Error(m);};globalThis.waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('wait timed out');};void 0;`);
  assert.equal(await execute(`data.profiles.find(p=>p.id==='test').condition.branches[0].pitch`), 4.5);

  // Real Chromium AudioWorklet and stereo graph. Capture output in memory only.
  const spectrum = await execute(`(async()=>{
    const context=new OfflineAudioContext(2,96000,48000);await context.audioWorklet.addModule('pitch-worklet.js');
    const engine=new AssistanceAudioEngine();engine.context=context;engine.pitchReady=true;engine.running=true;
    const source=context.createBufferSource(),buffer=context.createBuffer(1,96000,48000);const samples=buffer.getChannelData(0);
    for(let n=0;n<samples.length;n++)samples[n]=.2*Math.sin(2*Math.PI*440*n/48000);
    source.buffer=buffer;engine.source=source;engine.master=context.createGain();engine.master.connect(context.destination);
    const settings=defaultCondition();settings.branches=[{enabled:true,pitch:6,delay:0,gain:0,pan:'left'},{enabled:true,pitch:-6,delay:0,gain:0,pan:'right'}];engine.configure(settings);source.start();
    const result=await context.startRendering();const frequencies=[];
    for(let channel=0;channel<2;channel++){const out=result.getChannelData(channel),target=440*2**((channel===0?6:-6)/12);let best=0,frequency=0;for(let f=Math.floor(target)-12;f<=Math.ceil(target)+12;f++){let re=0,im=0;for(let n=48000;n<96000;n++){const angle=2*Math.PI*f*n/48000;re+=out[n]*Math.cos(angle);im+=out[n]*Math.sin(angle);}if(re*re+im*im>best){best=re*re+im*im;frequency=f;}}check(out.every(Number.isFinite),'finite output');check(best>1000,'audible output');frequencies.push(frequency);}
    engine.modules.forEach(m=>m.stop());return {length:result.length,frequencies};
  })()`);
  assert.equal(spectrum.length, 96000); assert.ok(Math.abs(spectrum.frequencies[0] - 622.25) < 6); assert.ok(Math.abs(spectrum.frequencies[1] - 311.13) < 6);

  // Synthetic live input through the actual engine, followed by stop and restart.
  await execute(`globalThis.syntheticContext=new AudioContext();globalThis.syntheticOsc=syntheticContext.createOscillator();const level=syntheticContext.createGain();level.gain.value=.01;globalThis.syntheticDestination=syntheticContext.createMediaStreamDestination();syntheticOsc.connect(level).connect(syntheticDestination);syntheticOsc.start();globalThis.captureCount=0;navigator.mediaDevices.getUserMedia=async()=>{captureCount++;return syntheticDestination.stream.clone();};void 0;`);
  await execute(`applyCondition({mode:'combo',branches:[{enabled:true,pitch:3,delay:50,gain:-6,pan:'left'},{enabled:true,pitch:-3,delay:100,gain:-9,pan:'right'}],masterGain:-40});startAssist();`);
  assert.equal(await execute(`audio.running`), true);
  await execute(`globalThis.lastStream=audio.stream;document.querySelector('#delayA').value=75;document.querySelector('#delayA').dispatchEvent(new Event('input'));`);
  await execute(`muteAssist()`);
  assert.equal(await execute(`lastStream.getTracks().every(t=>t.readyState==='ended') && audio.context===null && audio.modules.size===0 && audio.retired.size===0`), true);
  await execute(`startAssist()`); assert.equal(await execute(`audio.running`), true);
  await execute(`emergencyStop();`); await execute(`emergencyStop();`);
  assert.equal(await execute(`audio.context===null && !audio.stream && !document.querySelector('#startAssist').disabled`), true);

  // Stop while getUserMedia is awaiting its result must discard the late stream.
  await execute(`navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>globalThis.finishCapture=resolve);globalThis.pendingStart=startAssist();void 0;`);
  await execute(`waitFor(()=>typeof finishCapture==='function')`);
  await execute(`emergencyStop();`);
  await execute(`globalThis.lateStream=syntheticDestination.stream.clone();finishCapture(lateStream);pendingStart;`);
  assert.equal(await execute(`lateStream.getTracks().every(t=>t.readyState==='ended')&&!audio.running&&audio.context===null`), true);

  // Changing mode during preparation must not start the old mode behind the UI.
  await execute(`delete globalThis.finishCapture;globalThis.pendingStart=startAssist();void 0;`);
  await execute(`waitFor(()=>typeof finishCapture==='function')`);
  await execute(`document.querySelector('[data-mode="none"]').click();`);
  await execute(`waitFor(()=>document.querySelector('[data-mode="none"]').classList.contains('selected'))`);
  await execute(`globalThis.modeLateStream=syntheticDestination.stream.clone();finishCapture(modeLateStream);pendingStart;`);
  assert.equal(await execute(`!audio.running&&modeLateStream.getTracks().every(t=>t.readyState==='ended')&&currentCondition().mode==='none'`), true);

  // Restart before an ignored permission request settles. Old success/failure
  // must release only its own stream and leave the new session and UI intact.
  for (const outcome of ['resolve', 'reject']) {
    await execute(`delete globalThis.finishCapture;applyCondition(defaultCondition());navigator.mediaDevices.getUserMedia=()=>new Promise((resolve,reject)=>{globalThis.finishCapture=resolve;globalThis.failCapture=reject;});globalThis.pendingStart=startAssist();void 0;`);
    await execute(`waitFor(()=>typeof finishCapture==='function')`);
    await execute(`emergencyStop()`);
    assert.equal(await execute(`audio.starting===null&&!document.querySelector('#startAssist').disabled`), true);
    await execute(`document.querySelector('[data-mode="none"]').click();`);
    await execute(`waitFor(()=>currentCondition().mode==='none')`);
    await execute(`document.querySelector('#startAssist').click();`);
    await execute(`waitFor(()=>audio.running&&!audio.starting)`);
    await execute(`globalThis.replacementContext=audio.context;globalThis.replacementMessage=document.querySelector('#audioMessage').textContent;void 0;`);
    if (outcome === 'resolve') await execute(`globalThis.restartLateStream=syntheticDestination.stream.clone();finishCapture(restartLateStream);pendingStart;`);
    else await execute(`failCapture(Object.assign(Error('late permission denial'),{name:'NotAllowedError'}));pendingStart;`);
    assert.equal(await execute(`audio.running&&audio.context===replacementContext&&!audio.stream&&document.querySelector('#assistStatus').classList.contains('running')&&document.querySelector('#startAssist').disabled&&!document.querySelector('#muteAssist').disabled&&document.querySelector('#audioMessage').textContent===replacementMessage&&sessionConditionSnapshot.mode==='none'`), true, `late ${outcome} must not change the new session UI`);
    if (outcome === 'resolve') assert.equal(await execute(`restartLateStream.getTracks().every(t=>t.readyState==='ended')`), true);
    await execute(`emergencyStop()`);
  }

  // Output selection is also asynchronous: stopping here must not request input.
  await execute(`globalThis.originalSetSink=AudioContext.prototype.setSinkId;AudioContext.prototype.setSinkId=()=>new Promise(resolve=>globalThis.finishSink=resolve);navigator.mediaDevices.getUserMedia=async()=>{captureCount++;return syntheticDestination.stream.clone();};globalThis.beforeSinkCaptureCount=captureCount;applyCondition(defaultCondition());globalThis.pendingSinkStart=startAssist();void 0;`);
  await execute(`waitFor(()=>typeof finishSink==='function')`);
  await execute(`emergencyStop()`);
  await execute(`AudioContext.prototype.setSinkId=originalSetSink;finishSink();pendingSinkStart;`);
  assert.equal(await execute(`captureCount===beforeSinkCaptureCount&&!audio.running&&!audio.stream&&audio.context===null&&audio.starting===null&&document.querySelector('#audioMessage').textContent.includes('マイクを解放しました')`), true);

  // Missing worklet remains an explicit failure for FAF, while DAF still starts.
  await execute(`navigator.mediaDevices.getUserMedia=async()=>syntheticDestination.stream.clone();globalThis.originalAddModule=AudioWorklet.prototype.addModule;AudioWorklet.prototype.addModule=async()=>{throw Error('test missing worklet');};applyCondition({mode:'faf',branches:[{enabled:true,pitch:-3,delay:0}]});startAssist();`);
  assert.equal(await execute(`!audio.running && document.querySelector('#audioMessage').textContent.includes('FAFを開始できません')`), true);
  await execute(`applyCondition({mode:'daf',branches:[{enabled:true,pitch:0,delay:50}]});startAssist();`);
  assert.equal(await execute(`audio.running`), true); await execute(`AudioWorklet.prototype.addModule=originalAddModule;emergencyStop();`);

  // Comparison preparation and baseline never automatically acquire a microphone.
  await execute(`go('home');document.querySelector('#startTrial').click();document.querySelector('#trialProfileA').value='baseline';document.querySelector('#trialProfileB').value='test';document.querySelector('#trialRandomize').checked=false;document.querySelector('#trialStartButton').click();`);
  await execute(`waitFor(()=>trial.active && currentCondition().mode==='none')`);
  assert.equal(await execute(`!audio.running && !audio.stream && currentCondition().branches.every(b=>!b.enabled)`), true);

  // TTS never picks a remote voice, even if it is the only voice available.
  await execute(`globalThis.originalVoices=speechSynthesis.getVoices;globalThis.originalSpeak=speechSynthesis.speak;globalThis.originalUtterance=window.SpeechSynthesisUtterance;window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};globalThis.utterances=[];speechSynthesis.speak=utterance=>utterances.push(utterance);speechSynthesis.getVoices=()=>[{name:'remote-test',lang:'ja-JP',localService:false}];data.phrases=[{reading:'合成テスト'}];phraseIndex=0;loadVoices();playPhrase({skipCountdown:true});check(utterances.length===0,'remote TTS forbidden');speechSynthesis.getVoices=()=>[{name:'remote-test',lang:'ja-JP',localService:false},{name:'local-test',lang:'ja-JP',localService:true}];loadVoices();playPhrase({skipCountdown:true});check(utterances.length===1&&utterances[0].voice.localService,'local TTS allowed');pausePhrase();speechSynthesis.getVoices=originalVoices;speechSynthesis.speak=originalSpeak;window.SpeechSynthesisUtterance=originalUtterance;void 0;`);
  await execute(`document.querySelector('#saveReflection').click();`);
  assert.equal(await execute(`data.reflections.at(-1).effort===null&&data.reflections.at(-1).naturalness===null`), true, 'untouched ratings remain optional');

  // JSON backup restoration follows the real file input path.
  await execute(`globalThis.imported={schema_version:4,profiles:[{id:'restored',name:'old DAF',condition:{mode:'daf',branches:[{enabled:true,delay:88,pitch:0,gain:-8,pan:'right'}]}}],script:'旧原稿。',phrases:[{id:'p',text:'旧原稿。',reading:'きゅうげんこう。'}],reflections:[{note:'旧メモ',at:'2026-09-22',profile:'old DAF'}]};const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(imported)],'backup.json',{type:'application/json'}));document.querySelector('#restoreData').files=transfer.files;document.querySelector('#restoreData').dispatchEvent(new Event('change'));`);
  await execute(`waitFor(()=>data.profiles[0].id==='restored')`);
  assert.equal(await execute(`data.profiles[0].condition.branches[0].delay===88&&data.script==='旧原稿。'&&!audio.running`), true);

  // No capability must stay disabled even after toggling the settings lock.
  await execute(`globalThis.oldSupport=AssistanceAudioEngine.supportsPitch;AssistanceAudioEngine.supportsPitch=()=>false;updatePitchSupport();document.querySelector('#settingLock').click();document.querySelector('#settingLock').click();check(document.querySelector('#pitchA').disabled,'unsupported pitch lock');check(document.querySelector('[data-mode="faf"]').disabled,'unsupported FAF');AssistanceAudioEngine.supportsPitch=oldSupport;updatePitchSupport();`);
  const persisted = await execute(`JSON.parse(localStorage.getItem(STORE))`);
  assert.deepEqual(Object.keys(persisted).sort(), ['schema_version','profiles','script','phrases','reflections','ttsRate'].sort());
  assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith(origin + '/')), 'no audio uploads or external requests');
  assert.ok(requests.some(r => r.url.endsWith('/pitch-core.mjs')), 'DSP module requested');
  assert.equal(errors.length, 0, errors.join('\n'));

  await execute(`syntheticOsc.stop();syntheticDestination.stream.getTracks().forEach(t=>t.stop());syntheticContext.close();data.profiles=JSON.parse(JSON.stringify(defaultProfiles));activeProfile=data.profiles[0].id;renderProfiles();applyCondition(defaultCondition());go('home');`);
  await execute(`new Promise(resolve=>setTimeout(resolve,3700))`);
  const output = path.join(__dirname, '..', '.test-output');fs.mkdirSync(output, {recursive:true});
  const save = async name => {await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(output,name), (await window.webContents.capturePage()).toPNG());};
  await save('home.png');await execute(`go('assist');document.querySelector('[data-mode="faf"]').click();`);await save('assist.png');await execute(`go('guide')`);await save('guide.png');
  window.setSize(390,844);await execute(`go('home')`);await save('home-mobile.png');
  assert.equal(await execute(`document.documentElement.scrollWidth<=innerWidth`), true, 'mobile horizontal overflow');
  await execute(`go('guide')`);assert.equal(await execute(`document.documentElement.scrollWidth<=innerWidth`), true, 'guide horizontal overflow');await save('guide-mobile.png');
  clearTimeout(timeout);console.log('BROWSER TESTS PASSED', JSON.stringify({spectrum,requests:requests.length,privacy:'GET-only same-origin assets; no audio saved; synthetic inputs only'}));
}
app.whenReady().then(run).then(()=>{window.destroy();server.close();app.exit(0);}).catch(error=>{console.error(error);window?.destroy();server?.close();app.exit(1);});
