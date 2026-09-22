// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later

(() => {
  const $ = (s) => document.querySelector(s);
  const sync = () => {
    $('#compactAssist').textContent = $('#assistStatus').textContent.trim();
    $('#compactPhrase').textContent = $('#currentPhrase').textContent.trim();
    $('#compactSource').textContent = '原稿の現在句:';
    $('#compactGain').value = $('#masterGain').value;
    $('#compactRate').value = $('#ttsRate').value;
    $('#compactRateValue').textContent = $('#ttsRateValue').textContent;
  };
  $('#openCompact').addEventListener('click', () => { sync(); $('#compactPanel').hidden = false; });
  $('#closeCompact').addEventListener('click', () => $('#compactPanel').hidden = true);
  $('#compactMute').addEventListener('click', () => $('#muteAssist').click());
  $('#compactPrevious').addEventListener('click', () => $('#previousPhrase').click());
  $('#compactPlay').addEventListener('click', () => $('#playPhrase').click());
  $('#compactNext').addEventListener('click', () => $('#nextPhraseBtn').click());
  $('#compactGain').addEventListener('input', (event) => { $('#masterGain').value = event.target.value; $('#masterGain').dispatchEvent(new Event('input')); });
  $('#compactRate').addEventListener('input', (event) => { $('#ttsRate').value = event.target.value; $('#ttsRate').dispatchEvent(new Event('input')); });
  new MutationObserver(sync).observe($('#assistStatus'), {childList:true,subtree:true,characterData:true});
  new MutationObserver(sync).observe($('#currentPhrase'), {childList:true,subtree:true,characterData:true});
  $('#settingLock').addEventListener('change', (event) => {
    document.querySelectorAll('#detailsPanel, .module-grid, .rhythm').forEach((section) => section.querySelectorAll('input,select,button').forEach((node) => node.disabled = event.target.checked));
    if (event.target.checked) $('#audioMessage').textContent = '詳細設定をロックしました。補助停止と音量はそのまま操作できます。';
  });
})();
