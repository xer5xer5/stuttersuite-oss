// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later
// StutterSuite local P0 prototype — no network requests, no automatic recording.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const STORE = 'stuttersuite.public.v1';
const SCHEMA_VERSION = 5;
const defaultProfiles = [
  {id:'meeting', name:'会議用', scene:'通話・会議', condition:{mode:'custom',branches:[{enabled:true,delay:50,pitch:0,gain:0,pan:'both'},{enabled:false,delay:200,pitch:0,gain:-6,pan:'both'}],masterGain:-24,masking:{enabled:false,type:'white',gain:-42,filter:'none'},direct:{enabled:false,gain:-18,pan:'both'},metronome:{enabled:false,bpm:60,type:'visual'},choral:{continuous:false,countdown:0,rate:1.2,pause:0}}},
  {id:'presentation', name:'発表前', scene:'発表', condition:{mode:'custom',branches:[{enabled:false,delay:50,pitch:0,gain:0,pan:'both'},{enabled:false,delay:200,pitch:0,gain:-6,pan:'both'}],masterGain:-27,masking:{enabled:false,type:'white',gain:-42,filter:'none'},direct:{enabled:false,gain:-18,pan:'both'},metronome:{enabled:false,bpm:60,type:'visual'},choral:{continuous:true,countdown:1,rate:1.2,pause:.5}}}
];
const LIMITS = Object.freeze({fileBytes: 2 * 1024 * 1024, script: 50000, profiles: 100, phrases: 2000, reflections: 2000, note: 10000});
let data, recoveryRaw = null, storageBlocked = false, storageMessage = '', unsavedCandidate = null;
function emptyData(){return {schema_version:SCHEMA_VERSION,profiles:JSON.parse(JSON.stringify(defaultProfiles)),script:'',phrases:[],reflections:[],ttsRate:1.2};}
try {
  recoveryRaw = localStorage.getItem(STORE);
  if (recoveryRaw?.length > LIMITS.fileBytes) throw Error('保存データが大きすぎます。');
  data = recoveryRaw ? JSON.parse(recoveryRaw) : emptyData();
} catch { storageBlocked = true; storageMessage = '保存データを読み込めませんでした。元データは上書きせずに残しています。元データを書き出してから、正常なバックアップの復元またはデータの削除を行ってください。'; data = emptyData(); }
function defaultCondition(){return JSON.parse(JSON.stringify(defaultProfiles[0].condition));}
function numberInRange(value,fallback,min,max){const number=Number(value);return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;}
function normalizeCondition(value={}){
  const mode=['daf','faf','combo','none','custom'].includes(value.mode)?value.mode:'custom';
  const branches=Array.isArray(value.branches)?value.branches:[];
  const condition={
    mode,
    branches:[0,1].map(i=>{
      const branch=branches[i]||{};
      return {enabled:typeof branch.enabled==='boolean'?branch.enabled:i===0,delay:mode==='faf'?0:numberInRange(branch.delay,i?200:50,0,300),pitch:mode==='daf'?0:Math.round(numberInRange(branch.pitch,0,-12,12)*2)/2,gain:numberInRange(branch.gain,i?-6:0,-60,0),pan:['left','right','both'].includes(branch.pan)?branch.pan:'both'};
    }),
    masterGain:numberInRange(value.masterGain??value.master,-24,-60,0),
    masking:{enabled:!!value.masking?.enabled,type:['white','pink','brown'].includes(value.masking?.type)?value.masking.type:'white',gain:numberInRange(value.masking?.gain,-42,-60,-12),filter:['none','lowpass','highpass'].includes(value.masking?.filter)?value.masking.filter:'none'},
    direct:{enabled:!!value.direct?.enabled,gain:numberInRange(value.direct?.gain,-18,-60,0),pan:['left','right','both'].includes(value.direct?.pan)?value.direct.pan:'both'},
    metronome:{enabled:!!value.metronome?.enabled,bpm:numberInRange(value.metronome?.bpm,60,30,180),type:['visual','sound','both'].includes(value.metronome?.type)?value.metronome.type:'visual'},
    choral:{continuous:!!value.choral?.continuous,countdown:numberInRange(value.choral?.countdown,0,0,5),rate:numberInRange(value.choral?.rate,1.2,.5,2),pause:numberInRange(value.choral?.pause,0,0,5)}
  };
  return condition;
}
function withoutAssistance(value){const condition=normalizeCondition(value);condition.branches.forEach(branch=>branch.enabled=false);condition.masking.enabled=false;condition.direct.enabled=false;condition.metronome.enabled=false;return condition;}
function migrateData(data){
  if(!Array.isArray(data.profiles)||!data.profiles.length)data.profiles=JSON.parse(JSON.stringify(defaultProfiles));
  data.profiles=data.profiles.map(profile=>{
    if(profile.condition)return {...profile,id:profile.id||crypto.randomUUID(),name:profile.name||'保存した設定',scene:profile.scene||'通話・会議',condition:profile.condition.mode==='none'?withoutAssistance(profile.condition):normalizeCondition(profile.condition),...(profile.migrationNote?{migrationNote:'旧版で無効になったFAF設定です。失われた音程値は復元できません。加工音声の音程を再設定して保存してください。'}:{})};
    const legacyMode=profile.mode||'daf';
    if(['faf','combo'].includes(legacyMode)){
      const condition=withoutAssistance({mode:'custom',branches:[{enabled:false,delay:profile.delayA??50,gain:0,pan:'both'},{enabled:false,delay:200,gain:-6,pan:'both'}],masterGain:profile.master??-24});
      return {id:profile.id||crypto.randomUUID(),name:profile.name||'保存した設定',scene:profile.scene||'通話・会議',condition,migrationNote:'旧FAF設定の音程値は不明です。加工音声を無効にして移行しました。加工音声の音程を再設定して保存してください。'};
    }
    return {id:profile.id||crypto.randomUUID(),name:profile.name||'保存した設定',scene:profile.scene||'通話・会議',condition:legacyMode==='none'?withoutAssistance({mode:'none'}):normalizeCondition({mode:'daf',branches:[{enabled:true,delay:profile.delayA??50,gain:0,pan:'both'},{enabled:!!profile.branchB,delay:200,gain:-6,pan:'both'}],masterGain:profile.master??-24})};
  });
  data.reflections=Array.isArray(data.reflections)?data.reflections:[];
  data.reflections.forEach(reflection=>{if(!reflection.conditionSnapshot)reflection.conditionSnapshot=null;});
  data.schema_version=SCHEMA_VERSION;
}
function record(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label}の形式が不正です。`);return value;}
function text(value,fallback,max,label){if(value===undefined)return fallback;if(typeof value!=='string'||value.length>max)throw Error(`${label}の文字数または形式が不正です。`);return value;}
function numeric(value,min,max,label){if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max))throw Error(`${label}の値が不正です。`);}
function choice(value,values,label){if(value!==undefined&&!values.includes(value))throw Error(`${label}の値が不正です。`);}
function validateCondition(value){
  record(value,'補助条件');choice(value.mode,['daf','faf','combo','none','custom'],'方式');
  numeric(value.masterGain,-60,0,'音量');numeric(value.master,-60,0,'音量');
  if(value.branches!==undefined){
    if(!Array.isArray(value.branches)||value.branches.length>2)throw Error('加工音声の形式が不正です。');
    value.branches.forEach(branch=>{record(branch,'加工音声');choice(branch.enabled,[true,false],'加工音声の有効状態');numeric(branch.delay,0,300,'遅延');numeric(branch.pitch,-12,12,'音程');numeric(branch.gain,-60,0,'相対ゲイン');choice(branch.pan,['left','right','both'],'左右');});
  }
  const sections={masking:{type:['white','pink','brown'],filter:['none','lowpass','highpass']},direct:{pan:['left','right','both']},metronome:{type:['visual','sound','both']},choral:{}};
  for(const [key,choices] of Object.entries(sections))if(value[key]!==undefined){const section=record(value[key],key);choice(section.enabled,[true,false],key);for(const [field,values] of Object.entries(choices))choice(section[field],values,field);}
  numeric(value.masking?.gain,-60,-12,'ノイズ音量');numeric(value.direct?.gain,-60,0,'自声音量');numeric(value.metronome?.bpm,30,180,'BPM');
  numeric(value.choral?.rate,.5,2,'TTS速度');numeric(value.choral?.countdown,0,5,'カウントダウン');numeric(value.choral?.pause,0,5,'句間休止');choice(value.choral?.continuous,[true,false],'連続再生');
}
function prepareData(value,{backup=false}={}){
  record(value,'保存データ');
  if(value.schema_version!==undefined&&(!Number.isInteger(value.schema_version)||value.schema_version<1||value.schema_version>SCHEMA_VERSION))throw Error('この版では扱えないバックアップです。');
  function list(name,max){const items=value[name];if(items===undefined&&!backup)return [];if(!Array.isArray(items)||items.length>max)throw Error(`${name}の件数または形式が不正です。`);return items;}
  const seen=new Set();
  const profiles=list('profiles',LIMITS.profiles).map(profile=>{
    record(profile,'設定');const id=text(profile.id,crypto.randomUUID(),128,'設定ID');if(!id||seen.has(id))throw Error('設定IDが空または重複しています。');seen.add(id);
    const result={id,name:text(profile.name,'保存した設定',200,'設定名'),scene:text(profile.scene,'通話・会議',200,'場面')};
    if(profile.condition!==undefined){validateCondition(profile.condition);result.condition=profile.condition;}
    else {choice(profile.mode,['daf','faf','combo','none','custom'],'旧方式');numeric(profile.delayA,0,300,'旧遅延');numeric(profile.master,-60,0,'旧音量');choice(profile.branchB,[true,false],'旧加工音声B');for(const key of ['mode','delayA','master','branchB'])if(profile[key]!==undefined)result[key]=profile[key];}
    if(profile.migrationNote!==undefined)result.migrationNote=text(profile.migrationNote,'',500,'移行メモ');return result;
  });
  const phrases=list('phrases',LIMITS.phrases).map(phrase=>{
    record(phrase,'句');const reading=text(phrase.reading,undefined,LIMITS.script,'読み');const original=text(phrase.text,reading,LIMITS.script,'句本文');if(original===undefined)throw Error('句本文がありません。');
    return {...(phrase.id===undefined?{}:{id:text(phrase.id,'',128,'句ID')}),text:original,reading:reading??original};
  });
  const reflections=(value.reflections===undefined?[]:list('reflections',LIMITS.reflections)).map(reflection=>{
    record(reflection,'履歴');for(const key of ['effort','naturalness'])if(reflection[key]!=null){numeric(reflection[key],1,9,key);if(!Number.isInteger(reflection[key]))throw Error('評価の値が不正です。');}
    choice(reflection.wouldUse,['','yes','unsure','no'],'次回の利用');if(reflection.conditionSnapshot!=null)validateCondition(reflection.conditionSnapshot);
    return {...(reflection.id===undefined?{}:{id:text(reflection.id,'',128,'履歴ID')}),profile:text(reflection.profile,'',200,'履歴の設定名'),at:text(reflection.at,'',200,'日時'),effort:reflection.effort??null,naturalness:reflection.naturalness??null,wouldUse:reflection.wouldUse??'',note:text(reflection.note,'',LIMITS.note,'メモ'),conditionSnapshot:reflection.conditionSnapshot?(reflection.conditionSnapshot.mode==='none'?withoutAssistance(reflection.conditionSnapshot):normalizeCondition(reflection.conditionSnapshot)):null};
  });
  numeric(value.ttsRate,.5,2,'TTS速度');
  const candidate={schema_version:SCHEMA_VERSION,profiles,script:text(value.script,'',LIMITS.script,'原稿'),phrases,reflections,ttsRate:value.ttsRate??1.2};
  migrateData(candidate);
  if(new TextEncoder().encode(JSON.stringify(candidate)).byteLength>LIMITS.fileBytes)throw Error('保存データが大きすぎます。');return candidate;
}
try { data = prepareData(data); if(!storageBlocked)recoveryRaw=null; }
catch { storageBlocked=true;storageMessage='保存データが壊れているか、この版では扱えません。元データは残しています。元データを書き出してから、正常なバックアップの復元またはデータの削除を行ってください。';data=emptyData(); }
let audio = new AssistanceAudioEngine({onPulse:()=>{const pulse=$('#pulse');pulse.classList.add('active');setTimeout(()=>pulse.classList.remove('active'),90);},onFault:reason=>{emergencyStop({broadcast:false}).then(stopped=>{if(stopped)$('#audioMessage').textContent=reason;});}});
let activeProfile = data.profiles[0]?.id || 'meeting';
let activeConditionName = data.profiles[0]?.name || '未選択';
let sessionConditionSnapshot = null;
let assistRequest = 0;
let phraseIndex = 0, speaking = false, trialStep = 0, toastTimer;
let speechToken = 0, advanceTimer = null;

function publicData(){const {schema_version,profiles,script,phrases,reflections,ttsRate}=data;return {schema_version:SCHEMA_VERSION,profiles,script,phrases,reflections,ttsRate};}
function showStorageNotice(message){$('#storageNotice').hidden=false;$('#storageMessage').textContent=message;$('#exportRecovery').hidden=recoveryRaw===null;}
function commitData(candidate,{replaceRecovery=false}={}){
  if(storageBlocked&&!replaceRecovery){showStorageNotice(storageMessage);return false;}
  let prepared;
  try {prepared=prepareData(candidate);localStorage.setItem(STORE,JSON.stringify(prepared));data=prepared;unsavedCandidate=null;storageBlocked=false;recoveryRaw=null;$('#storageNotice').hidden=true;return true;}
  catch(error){if(prepared&&!replaceRecovery)unsavedCandidate=prepared;showStorageNotice(error.name==='QuotaExceededError'||error.name==='SecurityError'?'保存できませんでした。空き容量やブラウザの設定を確認し、現在の内容をバックアップに書き出してください。':error.message||'保存できませんでした。入力した内容は画面上に残っています。');return false;}
}
function persist(){return commitData(data);}
function backupContents(){return unsavedCandidate??publicData();}
function toast(message){ const node=$('#toast'); node.textContent=message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),3500); }
function now(){ return new Date().toLocaleString('ja-JP',{dateStyle:'medium',timeStyle:'short'}); }
function setStatus(kind, state, text){ const n=$(`#${kind}Status`); n.className=`status ${state}`; n.replaceChildren(document.createElement('i'),document.createTextNode(text)); }
function go(page){ $$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===page)); $$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${page}`)); window.scrollTo({top:0,behavior:'smooth'}); const title=$(`#page-${page} h1`);if(title){title.tabIndex=-1;title.focus({preventScroll:true});} }
function profileSummary(profile){if(profile.migrationNote)return '音程の再設定が必要';return conditionLabel(profile.condition);}
function renderProfiles(){ const select=$('#profileSelect'); const cards=$('#profileCards'); select.replaceChildren(); cards.replaceChildren(); data.profiles.forEach(p=>{ const o=document.createElement('option'); o.value=p.id;o.textContent=`${p.name}（${p.scene}）`;select.append(o); const card=document.createElement('article');card.className='profile-card';const name=document.createElement('strong'),summary=document.createElement('p'),button=document.createElement('button');name.textContent=p.name;summary.textContent=`${p.scene} · ${profileSummary(p)}`;button.className='secondary';button.dataset.useProfile=p.id;button.textContent='読み込む';card.append(name,summary,button);cards.append(card); }); select.value=activeProfile; renderTrialSelectors(); }
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function selectedProfile(){return data.profiles.find(p=>p.id===activeProfile);}
function stoppedControls(){setStatus('assist','stopped','補助: 停止');setStatus('mic','idle','マイク: 未使用');$('#startAssist').disabled=false;$('#muteAssist').disabled=true;$('#outputDevice').disabled=false;}
async function stopAssistForConditionChange(){if(!audio.running&&!audio.starting)return false;if(!await clearAudio())return null;stoppedControls();return true;}
async function loadCondition(name,condition){const wasRunning=await stopAssistForConditionChange();if(wasRunning===null)return null;activeConditionName=name;sessionConditionSnapshot=null;applyCondition(condition);return wasRunning;}
async function applyProfile(id){const p=data.profiles.find(x=>x.id===id);if(!p)return;const wasRunning=await loadCondition(p.name,p.condition);if(wasRunning===null)return;activeProfile=id;$('#profileSelect').value=id;const note=p.migrationNote?` ${p.migrationNote}`:'';toast(`${wasRunning?`補助を停止して「${p.name}」を読み込みました。設定を確認してから補助を開始してください。`:`「${p.name}」を選びました。補助は停止中です。`}${note}`);}
function currentCondition(){return normalizeCondition({mode:'custom',branches:[{enabled:$('#branchAEnabled').checked,delay:$('#delayA').value,pitch:$('#pitchA').value,gain:$('#gainA').value,pan:$('#panA').value},{enabled:$('#branchBEnabled').checked,delay:$('#delayB').value,pitch:$('#pitchB').value,gain:$('#gainB').value,pan:$('#panB').value}],masterGain:$('#masterGain').value,masking:{enabled:$('#maskingEnabled').checked,type:$('#maskingType').value,gain:$('#maskingGain').value,filter:$('#maskingFilter').value},direct:{enabled:$('#directEnabled').checked,gain:$('#directGain').value,pan:$('#directPan').value},metronome:{enabled:$('#metroEnabled').checked,bpm:$('#bpm').value,type:$('#metroType').value},choral:{continuous:$('#continuousChoral').checked,countdown:$('#choralCountdown').value,rate:$('#ttsRate').value,pause:$('#phrasePause').value}});}
function applyCondition(condition){const c=condition.mode==='none'?withoutAssistance(condition):normalizeCondition(condition);[['A',c.branches[0]],['B',c.branches[1]]].forEach(([name,b])=>{$(`#branch${name}Enabled`).checked=b.enabled;$(`#delay${name}`).value=b.delay;$(`#pitch${name}`).value=b.pitch;$(`#gain${name}`).value=b.gain;$(`#pan${name}`).value=b.pan;});$('#masterGain').value=c.masterGain;$('#maskingEnabled').checked=c.masking.enabled;$('#maskingType').value=c.masking.type;$('#maskingGain').value=c.masking.gain;$('#maskingFilter').value=c.masking.filter;$('#directEnabled').checked=c.direct.enabled;$('#directGain').value=c.direct.gain;$('#directPan').value=c.direct.pan;$('#metroEnabled').checked=c.metronome.enabled;$('#bpm').value=c.metronome.bpm;$('#metroType').value=c.metronome.type;$('#continuousChoral').checked=c.choral.continuous;$('#choralCountdown').value=c.choral.countdown;$('#phrasePause').value=c.choral.pause;setTtsRate(c.choral.rate,false);syncControls();refreshAudio();}
function syncControls(){ ['pitchA','pitchB','delayA','delayB','gainA','gainB','bpm','masterGain','ttsRate','phrasePause','maskingGain','directGain','choralCountdown'].forEach(id=>{const unit=id.startsWith('pitch')?' 半音':id.startsWith('delay')?' ms':id.startsWith('gain')||id==='masterGain'||id==='maskingGain'||id==='directGain'?' dB':id==='bpm'?' BPM':id==='ttsRate'?' 倍':id==='choralCountdown'||id==='phrasePause'?' 秒':'';const label=id==='phrasePause'?'pause':id;const out=$(`#${label}Value`);if(out)out.textContent=`${Number($(`#${id}`).value).toFixed(id==='ttsRate'?2:id==='phrasePause'||id.startsWith('pitch')?1:0)}${unit}`;});$('#latencyReadout').textContent=['A','B'].filter(n=>$('#branch'+n+'Enabled').checked).map(n=>`${n}: ${$('#delay'+n).value} ms`).join(' ／ ')||'なし';const shifted=['A','B'].some(n=>$('#branch'+n+'Enabled').checked&&Number($('#pitch'+n).value)!==0),rate=audio.context?.sampleRate;$('#pitchLatencyReadout').textContent=shifted?(rate?`${(896000/rate).toFixed(1)}〜${(1024000/rate).toFixed(1)} ms（処理バッファの目安）`:'約19〜23 ms（44.1／48 kHz時の目安）'):'なし（0半音はバイパス）';}
function setTtsRate(value,save=true){const input=value==null?NaN:Number(value),rate=Math.round(Math.min(2,Math.max(.5,Number.isFinite(input)?input:1.2))*20)/20;data.ttsRate=rate;['ttsRate','compactRate'].forEach(id=>$(`#${id}`).value=String(rate));['ttsRateValue','compactRateValue'].forEach(id=>$(`#${id}`).textContent=`${rate.toFixed(2)} 倍`);if(save)persist();}
function gain(value){return Math.pow(10,Number(value)/20);}

async function enumerateDevices(){
  try { const devices=await navigator.mediaDevices.enumerateDevices(); const input=$('#inputDevice'); const current=input.value; input.innerHTML='<option value="default">既定のマイク（ブラウザが選択）</option>'; devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>input.add(new Option(d.label||`マイク ${i+1}`,d.deviceId))); input.value=[...input.options].some(x=>x.value===current)?current:'default';
    const output=$('#outputDevice');if(output.disabled)return;const liveOutput=audio.running&&typeof audio.context?.setSinkId==='function',currentOutput=liveOutput?audio.outputDeviceId:output.value;output.innerHTML='<option value="default">ブラウザの既定の出力</option>';devices.filter(d=>d.kind==='audiooutput').forEach((d,i)=>output.add(new Option(d.label||`出力 ${i+1}`,d.deviceId)));if(liveOutput&&![...output.options].some(x=>x.value===currentOutput))output.add(new Option('現在の出力先',currentOutput));output.value=[...output.options].some(x=>x.value===currentOutput)?currentOutput:'default';
  } catch { toast('機器一覧を取得できませんでした。ブラウザの権限を確認してください。'); }
}
async function prepareAudio(){
  if(!navigator.mediaDevices?.getUserMedia){$('#audioMessage').textContent='このブラウザはマイク入力に対応していません。';return false;}
  try{ const device=$('#inputDevice').value; const constraints={audio:device==='default'?true:{deviceId:{exact:device}},video:false}; const stream=await navigator.mediaDevices.getUserMedia(constraints); stream.getTracks().forEach(t=>t.stop()); await enumerateDevices(); $('#audioMessage').textContent='マイクを確認しました。補助はまだ停止中です。'; toast('マイクを確認しました。'); return true;
  }catch(e){ $('#audioMessage').textContent='マイクを使えません。ブラウザの権限・他アプリの利用状況を確認してください。';return false; }
}
async function clearAudio(){const request=++assistRequest;await audio.stop();return request===assistRequest;}
async function startAssist(){
  if(audio.running||audio.starting)return;if(!navigator.mediaDevices?.getUserMedia){toast('このブラウザではライブ補助を利用できません。');return;}
  const request=++assistRequest;
  try{
    $('#startAssist').disabled=true;$('#outputDevice').disabled=true;
    const condition=currentCondition();const result=await audio.start({inputDeviceId:$('#inputDevice').value,outputDeviceId:$('#outputDevice').value,settings:condition});if(request!==assistRequest)return;sessionConditionSnapshot=JSON.parse(JSON.stringify(condition));setStatus('assist','running','補助: 動作中');setStatus('mic',audio.stream?'running':'idle',audio.stream?'マイク: 使用中':'マイク: 未使用');syncControls();$('#startAssist').disabled=true;$('#muteAssist').disabled=false;$('#audioMessage').textContent=result.warnings[0]||'補助音をヘッドホンに再生しています。通話相手への音声は、通話アプリ側でミュートしてください。読み上げ音声はOS／ブラウザの既定の出力先を使います。';
  }catch(e){if(request!==assistRequest)return;sessionConditionSnapshot=null;stoppedControls();$('#audioMessage').textContent=({NotAllowedError:'マイクを利用できません。ブラウザのサイト設定でマイク許可を確認してください。',NotFoundError:'マイクが見つかりません。接続と入力機器を確認してください。',NotReadableError:'マイクを開けません。他のアプリによる占有や機器の接続を確認してください。'}[e.name])||e.message||'補助を開始できませんでした。マイク権限、ヘッドホン、他アプリの設定を確認してください。';}
  finally{if(request===assistRequest)$('#outputDevice').disabled=false;}
}
function refreshAudio(){if(audio.running&&!audio.muted){try{audio.configure(currentCondition());}catch(e){emergencyStop({broadcast:false}).then(stopped=>{if(stopped)$('#audioMessage').textContent=e.message;});}}}
async function muteAssist(){pausePhrase();if(!await clearAudio())return false;stoppedControls();$('#audioMessage').textContent='補助音を停止し、マイクを解放しました。通話のマイクは通話アプリ側で操作してください。';return true;}
const STOP_STORE = 'stuttersuite.emergency.v1';
let stopChannel;
try { stopChannel = new BroadcastChannel(STOP_STORE);stopChannel.onmessage=event=>{if(event.data?.type==='stop')emergencyStop({broadcast:false});}; } catch {}
function broadcastStop(){try{if(stopChannel){stopChannel.postMessage({type:'stop'});return;}}catch{}try{localStorage.setItem(STOP_STORE,crypto.randomUUID());localStorage.removeItem(STOP_STORE);}catch{}}
window.addEventListener('storage',event=>{if(event.key===STOP_STORE&&event.newValue)emergencyStop({broadcast:false});});
async function emergencyStop({broadcast=true}={}){pausePhrase();if(broadcast)broadcastStop();if(!await clearAudio())return false;stoppedControls();$('#audioMessage').textContent='補助音・マスキング・メトロノーム・TTSを停止し、マイクを解放しました。';toast('補助音を停止しました。');return true;}

function splitPhrases(text){return text.replace(/\r/g,'').split(/(?<=[。！？!?…]|\n)/).map(x=>x.trim()).filter(Boolean).map((text,i)=>({id:`p${Date.now()}-${i}`,text,reading:text}));}
function renderPhrases(){const list=$('#phraseList');list.innerHTML='';phraseIndex=Math.min(phraseIndex,Math.max(0,data.phrases.length-1));if(!data.phrases.length){list.innerHTML='<p class="empty">原稿を句に分けると、ここに表示されます。</p>';updatePlayer();return;}data.phrases.forEach((p,i)=>{const b=document.createElement('button');b.className=`phrase ${i===phraseIndex?'active':''}`;b.textContent=`${i+1}. ${p.reading}`;b.onclick=()=>{pausePhrase();phraseIndex=i;renderPhrases();};list.append(b);});updatePlayer();}
function updatePlayer(){const p=data.phrases[phraseIndex],n=data.phrases[phraseIndex+1];$('#currentPhrase').textContent=p?.reading||'—';$('#nextPhrase').textContent=n?.reading||'—';}
function localVoices(){return speechSynthesis.getVoices().filter(voice=>voice.localService===true);}
function loadVoices(){const voices=localVoices(),jp=voices.filter(v=>v.lang.toLowerCase().startsWith('ja')),all=jp.length?jp:voices,sel=$('#voiceSelect'),prev=sel.value;sel.innerHTML='';all.forEach(v=>sel.add(new Option(`${v.name} (${v.lang})`,v.name)));if(!all.length)sel.add(new Option('ローカル音声が利用できません',''));if([...sel.options].some(x=>x.value===prev))sel.value=prev;}
function playPhrase({skipCountdown=false}={}){const p=data.phrases[phraseIndex];if(!p){toast('まず原稿を句に分けてください。');return;}const voice=localVoices().find(v=>v.name===$('#voiceSelect').value);if(!voice){toast('ローカル音声が利用できないため、TTSは再生しません。');return;}pausePhrase();const token=speechToken,index=phraseIndex,start=()=>{if(token!==speechToken)return;const u=new SpeechSynthesisUtterance(p.reading);u.voice=voice;u.lang=voice.lang||'ja-JP';u.rate=Number($('#ttsRate').value);speaking=true;u.onend=()=>{if(token!==speechToken)return;speaking=false;if($('#continuousChoral').checked&&index<data.phrases.length-1){advanceTimer=setTimeout(()=>{advanceTimer=null;if(token!==speechToken)return;phraseIndex=index+1;renderPhrases();playPhrase({skipCountdown:true});},Number($('#phrasePause').value)*1000);}};u.onerror=()=>{if(token===speechToken)speaking=false;};speechSynthesis.speak(u);};const countdown=!skipCountdown?Number($('#choralCountdown').value)*1000:0;if(countdown){toast(`${countdown/1000} 秒後に読み上げます。`);advanceTimer=setTimeout(()=>{advanceTimer=null;start();},countdown);}else start();}
function pausePhrase(){speechToken++;if(advanceTimer!==null){clearTimeout(advanceTimer);advanceTimer=null;}speechSynthesis.cancel();speaking=false;}
function nextPhrase(){pausePhrase();phraseIndex=Math.min(phraseIndex+1,Math.max(0,data.phrases.length-1));renderPhrases();}
function previousPhrase(){pausePhrase();renderPhrases();}
function renderHistory(){const box=$('#historyList');box.replaceChildren();if(!data.reflections.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='まだ履歴はありません。';box.append(empty);return;}data.reflections.slice().reverse().forEach(r=>{const x=document.createElement('div');x.className='history-item';const name=document.createElement('strong'),detail=document.createElement('small'),note=document.createElement('div');name.textContent=r.profile;const condition=r.conditionSnapshot?` · 条件: ${conditionLabel(r.conditionSnapshot)}`:' · 開始時の設定なし（旧履歴）';detail.textContent=`${r.at}${condition} · 負担: ${r.effort??'未回答'} · 自然さ: ${r.naturalness??'未回答'} · 次も使う: ${{yes:'はい',unsure:'判断できない',no:'いいえ'}[r.wouldUse]||'未回答'}`;x.append(name,document.createElement('br'),detail);if(r.note){note.textContent=r.note;x.append(note);}box.append(x);});}
function conditionLabel(condition){const c=normalizeCondition(condition),labels=[];if(c.branches.some(b=>b.enabled&&b.delay>0))labels.push('DAF');if(c.branches.some(b=>b.enabled&&b.pitch!==0))labels.push('FAF');if(c.branches.some(b=>b.enabled&&b.delay===0&&b.pitch===0))labels.push('自声モニター');if(c.masking.enabled)labels.push('マスキング');if(c.direct.enabled)labels.push('直接');if(c.metronome.enabled)labels.push('メトロノーム');if(c.choral.continuous)labels.push('斉読/TTS');return labels.join(' + ')||'補助なし';}
function download(filename,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}

$$('.nav').forEach(b=>b.onclick=()=>go(b.dataset.page));$$('.goto').forEach(b=>b.onclick=()=>go(b.dataset.target));
function saveCurrentProfile(){const name=prompt('現在の設定の名前を入力してください',selectedProfile()?.name||'新しい設定');if(!name?.trim())return;const existing=selectedProfile(),candidate=structuredClone(data);let id;if(existing&&confirm(`「${existing.name}」を現在の設定で更新しますか？\n「キャンセル」を選ぶと新しい設定として保存します。`)){const profile=candidate.profiles.find(p=>p.id===existing.id);profile.name=name.trim();profile.condition=currentCondition();delete profile.migrationNote;id=profile.id;}else{const profile={id:crypto.randomUUID(),name:name.trim(),scene:'通話・会議',condition:currentCondition()};candidate.profiles.push(profile);id=profile.id;}if(!commitData(candidate))return;activeProfile=id;activeConditionName=data.profiles.find(p=>p.id===id).name;renderProfiles();toast('現在の補助条件を保存しました。');}
$('#newProfile').onclick=async()=>{const name=prompt('設定の名前を入力してください','新しい設定');if(!name?.trim())return;const p={id:crypto.randomUUID(),name:name.trim(),scene:'通話・会議',condition:currentCondition()};if(!commitData({...data,profiles:[...data.profiles,p]}))return;renderProfiles();await applyProfile(p.id);go('assist');};
$('#saveCurrentProfile').onclick=saveCurrentProfile;
$('#profileCards').onclick=async e=>{const id=e.target.dataset.useProfile;if(id){await applyProfile(id);go('assist');}};$('#profileSelect').onchange=async e=>applyProfile(e.target.value);
['pitchA','pitchB','delayA','delayB','gainA','gainB','bpm','masterGain','ttsRate','phrasePause','maskingGain','directGain','choralCountdown'].forEach(id=>{$(`#${id}`).oninput=()=>{if(id==='ttsRate'){setTtsRate($('#ttsRate').value);return;}syncControls();if(id==='masterGain')audio.setMasterGain($('#masterGain').value);else refreshAudio();};});
['branchAEnabled','branchBEnabled','panA','panB','maskingEnabled','maskingType','maskingFilter','directEnabled','directPan','metroEnabled','metroType','continuousChoral'].forEach(id=>{$(`#${id}`).onchange=e=>{syncControls();refreshAudio();};});
$('#prepareAudio').onclick=prepareAudio;$('#startAssist').onclick=startAssist;$('#muteAssist').onclick=muteAssist;$('#emergency').onclick=emergencyStop;$('#applyPreset').onclick=()=>{$('#branchAEnabled').checked=true;$('#delayA').value=50;$('#pitchA').value=0;$('#pitchB').value=0;$('#branchBEnabled').checked=true;$('#delayB').value=200;$('#gainB').value=-6;syncControls();refreshAudio();toast('加工音声Aを50 ms、Bを200 msに設定しました。研究の機器や条件を再現した設定ではありません。');};
$('#scriptText').value=data.script||'';$('#charCount').textContent=`${$('#scriptText').value.length.toLocaleString()} / 50,000 文字`;$('#scriptText').oninput=()=>$('#charCount').textContent=`${$('#scriptText').value.length.toLocaleString()} / 50,000 文字`;
$('#splitScript').onclick=()=>{const script=$('#scriptText').value;if(!commitData({...data,script,phrases:splitPhrases(script)}))return;pausePhrase();phraseIndex=0;renderPhrases();toast(`${data.phrases.length} 句に分けました。`);};
$('#saveScript').onclick=()=>{if(commitData({...data,script:$('#scriptText').value}))toast('原稿をこの端末に保存しました。');};
async function readFile(file){if(file.size>LIMITS.fileBytes)throw Error('読み込めるファイルは2 MiBまでです。');return file.text();}
let textRequest=0;
$('#txtImport').onchange=async e=>{const file=e.target.files[0];if(!file)return;const request=++textRequest;try{const contents=await readFile(file);if(request!==textRequest)return;if(contents.length>LIMITS.script)throw Error('原稿は50,000文字以内にしてください。');$('#scriptText').value=contents;$('#scriptText').dispatchEvent(new Event('input'));toast('TXTを読み込みました。');}catch(error){if(request===textRequest)toast(error.message||'TXTを読み込めませんでした。');}finally{e.target.value='';}};
$('#playPhrase').onclick=playPhrase;$('#repeatPhrase').onclick=playPhrase;$('#pausePhrase').onclick=pausePhrase;$('#nextPhraseBtn').onclick=nextPhrase;$('#previousPhrase').onclick=previousPhrase;
['effort','naturalness'].forEach(id=>{$(`#${id}`).oninput=()=>{$(`#${id}Out`).textContent=$(`#${id}`).value;};});$('#saveReflection').onclick=()=>{const conditionSnapshot=sessionConditionSnapshot||currentCondition(),reflection={id:crypto.randomUUID(),at:now(),profile:activeConditionName,conditionSnapshot:structuredClone(conditionSnapshot),effort:$('#effortOut').textContent==='—'?null:Number($('#effort').value),naturalness:$('#naturalnessOut').textContent==='—'?null:Number($('#naturalness').value),wouldUse:$('#wouldUse').value,note:$('#sessionNote').value};if(!commitData({...data,reflections:[...data.reflections,reflection]}))return;renderHistory();toast('補助開始時の設定と振り返りを保存しました。');};
$('#exportData').onclick=()=>download(`stuttersuite-export-${new Date().toISOString().slice(0,10)}.json`,backupContents());$('#backupData').onclick=()=>download(`stuttersuite-backup-${new Date().toISOString().slice(0,10)}.json`,backupContents());
let restoreRequest=0;
$('#restoreData').onchange=async e=>{const file=e.target.files[0];if(!file)return;const request=++restoreRequest;let committed=false;try{
  const contents=await readFile(file);if(request!==restoreRequest)return;
  const candidate=prepareData(JSON.parse(contents),{backup:true});
  if(!await emergencyStop({broadcast:false})||request!==restoreRequest)return;
  if(!commitData(candidate,{replaceRecovery:true}))return;
  committed=true;
  sessionConditionSnapshot=null;phraseIndex=0;activeProfile=data.profiles[0].id;activeConditionName=data.profiles[0].name;trial={order:[],index:0,active:false};closeTrial();renderProfiles();applyCondition(data.profiles[0].condition);
  $('#scriptText').value=data.script;$('#scriptText').dispatchEvent(new Event('input'));renderPhrases();renderHistory();toast('バックアップを復元・移行しました。補助は停止したままです。');
}catch(error){if(request===restoreRequest)toast(committed?'データは復元しましたが画面を更新できませんでした。ページを再読み込みしてください。':`復元できませんでした。${error.message||'StutterSuiteのバックアップを選んでください。'} 元データは変更していません。`);}finally{e.target.value='';}};
$('#clearData').onclick=()=>{if(confirm('このブラウザに保存した設定・原稿・履歴を削除します。元に戻せません。')){try{localStorage.removeItem(STORE);location.reload();}catch{showStorageNotice('データを削除できませんでした。ブラウザのサイトデータ設定を確認してください。');}}};
$('#exportRecovery').onclick=()=>{if(recoveryRaw===null)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([recoveryRaw],{type:'application/json'}));a.download='stuttersuite-recovery-original.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);};
$('#storageBackup').onclick=()=>$('#backupData').click();
$('#txtImportButton').onclick=()=>$('#txtImport').click();
$('#restoreDataButton').onclick=()=>$('#restoreData').click();
let outputRequest=0;
async function changeOutputDevice(){
  const select=$('#outputDevice'),request=++outputRequest,context=audio.context,session=assistRequest;
  if(!audio.running||typeof context?.setSinkId!=='function'){if(select.value!=='default')toast('開始時にこの出力先を適用します。TTSの出力先は切り替えられません。');return;}
  const current=()=>request===outputRequest&&session===assistRequest&&context===audio.context;
  const showActual=()=>{const id=audio.outputDeviceId;if(![...select.options].some(option=>option.value===id))select.add(new Option('現在の出力先',id));select.value=id;};
  select.disabled=true;
  try{await audio.setOutputDevice(select.value);if(current()){showActual();toast('補助音の出力先を変更しました。');}}
  catch(error){if(current()&&error.name!=='AbortError'){showActual();toast('この出力先へ変更できませんでした。OSまたはブラウザの既定出力を確認してください。');}}
  finally{if(request===outputRequest)select.disabled=!!audio.starting;}
}
$('#refreshDevices').onclick=enumerateDevices;$('#outputDevice').onchange=changeOutputDevice;
let trial={order:[],index:0,active:false},trialReturnFocus;
function closeTrial(){const modal=$('#trialModal'),wasOpen=modal.classList.contains('open');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');$('.app-shell').inert=false;if(wasOpen)trialReturnFocus?.focus();}
function renderTrialSelectors(){const options=[{id:'baseline',name:'補助なし'},...data.profiles.map(p=>({id:p.id,name:p.name}))];['trialProfileA','trialProfileB'].forEach((id,index)=>{const select=$(`#${id}`);if(!select)return;const value=select.value||options[Math.min(index,options.length-1)].id;select.innerHTML='';options.forEach(option=>select.add(new Option(option.name,option.id)));select.value=options.some(option=>option.id===value)?value:options[0].id;});}
function openTrial(){renderTrialSelectors();trialReturnFocus=document.activeElement;$('#trialModal').classList.add('open');$('#trialModal').setAttribute('aria-hidden','false');$('.app-shell').inert=true;const configuring=!trial.active;['trialProfileA','trialProfileB','trialRandomize'].forEach(id=>$(`#${id}`).disabled=!configuring);$('#trialStartButton').textContent=configuring?'比較を開始':'この条件を準備';$('#trialNext').hidden=configuring;if(configuring){$('#trialStep').textContent='準備';$('#trialCondition').textContent='条件を選んで「比較を開始」を押してください。';}else updateTrial();$('#trialModal .close').focus();}
async function applyTrialCondition(){const id=trial.order[trial.index];if(id==='baseline')await loadCondition('補助なし',withoutAssistance({...defaultCondition(),mode:'none'}));else await applyProfile(id);if(audio.running||audio.starting)return;sessionConditionSnapshot=JSON.parse(JSON.stringify(currentCondition()));closeTrial();go('assist');toast(`比較 ${trial.index+1}/${trial.order.length} の条件を準備しました。補助はまだ開始していません。`);}
$('#startTrial').onclick=openTrial;$$('[data-close-modal]').forEach(b=>b.onclick=closeTrial);function updateTrial(){const id=trial.order[trial.index],profile=data.profiles.find(p=>p.id===id);$('#trialStep').textContent=`${trial.index+1} / ${trial.order.length}`;$('#trialCondition').textContent=id==='baseline'?'補助なし':profile?.name||'保存済みの設定';$('#trialNext').textContent=trial.index<trial.order.length-1?'次の条件へ':'比較を終える';}$('#trialStartButton').onclick=async()=>{if(!trial.active){trial.order=[$('#trialProfileA').value,$('#trialProfileB').value];if($('#trialRandomize').checked&&Math.random()<.5)trial.order.reverse();trial.index=0;trial.active=true;}await applyTrialCondition();};$('#trialNext').onclick=()=>{if(trial.index<trial.order.length-1){trial.index++;updateTrial();}else{trial={order:[],index:0,active:false};closeTrial();toast('比較を終えました。必要なら振り返りを残せます。');go('history');}};
window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if($('#trialModal').classList.contains('open'))closeTrial();else emergencyStop();return;}if(e.key==='Tab'&&$('#trialModal').classList.contains('open')){const nodes=[...$('#trialModal').querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')].filter(node=>!node.hidden);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}if(e.ctrlKey&&e.altKey){if(e.code==='F12'){e.preventDefault();emergencyStop();}if(e.code==='F9'){e.preventDefault();speaking?pausePhrase():playPhrase();}if(e.code==='F10'){e.preventDefault();nextPhrase();}if(e.code==='F8'){e.preventDefault();previousPhrase();}}});
window.addEventListener('beforeunload',()=>{pausePhrase();audio.stop();stopChannel?.close();});speechSynthesis.onvoiceschanged=loadVoices;renderProfiles();applyCondition(selectedProfile()?.condition||defaultCondition());renderPhrases();renderHistory();loadVoices();enumerateDevices();if(storageBlocked)showStorageNotice(storageMessage);

function updatePitchSupport(){const supported=AssistanceAudioEngine.supportsPitch();for(const node of $$('#pitchA,#pitchB')){node.dataset.unavailable=String(!supported);node.disabled=!supported;node.title=supported?'':'FAFにはHTTPS接続とAudioWorklet対応ブラウザが必要です。';}$('#pitchSupport').textContent=supported?'音程の変更は端末内で処理します。音声の送信・録音保存は行いません。':'この環境では音程を変更できません。HTTPSまたはlocalhostで、AudioWorklet対応ブラウザを使用してください。追加遅延やノイズは利用できます。';}
updatePitchSupport();

$$('[data-help]').forEach(button=>button.onclick=()=>{go('guide');const section=document.getElementById(button.dataset.help);section.tabIndex=-1;section.scrollIntoView({behavior:'smooth',block:'start'});section.focus({preventScroll:true});});
