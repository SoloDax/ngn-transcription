/**
 * NGN – AI Audio Transcription | Popup UI v2 (Tabbed)
 */
let isRecording = false, captionsEnabled = true, finalText = '', partialText = '', allTokens = [];
let translationText = '', recordStart = null, timerInterval = null;
const $ = s => document.querySelector(s);

// ── Language options (shared between selects) ──
const LANGUAGES = [
  ['','No translation – show original'],['af','Afrikaans'],['sq','Shqip – Albanian'],['ar','العربية – Arabic'],
  ['az','Azərbaycan – Azerbaijani'],['eu','Euskara – Basque'],['be','Беларуская – Belarusian'],
  ['bn','বাংলা – Bengali'],['bs','Bosanski – Bosnian'],['bg','Български – Bulgarian'],
  ['ca','Català – Catalan'],['zh','中文 – Chinese'],['hr','Hrvatski – Croatian'],['cs','Čeština – Czech'],
  ['da','Dansk – Danish'],['nl','Nederlands – Dutch'],['en','English'],['et','Eesti – Estonian'],
  ['fi','Suomi – Finnish'],['fr','Français – French'],['gl','Galego – Galician'],['de','Deutsch – German'],
  ['el','Ελληνικά – Greek'],['gu','ગુજરાતી – Gujarati'],['he','עברית – Hebrew'],['hi','हिन्दी – Hindi'],
  ['hu','Magyar – Hungarian'],['id','Bahasa Indonesia'],['it','Italiano – Italian'],
  ['ja','日本語 – Japanese'],['kn','ಕನ್ನಡ – Kannada'],['kk','Қазақ – Kazakh'],['ko','한국어 – Korean'],
  ['lv','Latviešu – Latvian'],['lt','Lietuvių – Lithuanian'],['mk','Македонски – Macedonian'],
  ['ms','Bahasa Melayu – Malay'],['ml','മലയാളം – Malayalam'],['mr','मराठी – Marathi'],
  ['no','Norsk – Norwegian'],['fa','فارسی – Persian'],['pl','Polski – Polish'],
  ['pt','Português – Portuguese'],['pa','ਪੰਜਾਬੀ – Punjabi'],['ro','Română – Romanian'],
  ['ru','Русский – Russian'],['sr','Српски – Serbian'],['sk','Slovenčina – Slovak'],
  ['sl','Slovenščina – Slovenian'],['es','Español – Spanish'],['sw','Kiswahili – Swahili'],
  ['sv','Svenska – Swedish'],['tl','Tagalog'],['ta','தமிழ் – Tamil'],['te','తెలుగు – Telugu'],
  ['th','ไทย – Thai'],['tr','Türkçe – Turkish'],['uk','Українська – Ukrainian'],
  ['ur','اردو – Urdu'],['vi','Tiếng Việt – Vietnamese'],['cy','Cymraeg – Welsh']
];

function populateSelect(el, includeAutoDetect) {
  if (!el) return;
  el.innerHTML = '';
  if (includeAutoDetect) {
    el.innerHTML = '<option value="">Auto-detect (recommended)</option>';
    LANGUAGES.filter(l => l[0]).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); });
  } else {
    LANGUAGES.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); });
  }
}

// ── Init ──
async function init() {
  // Populate all language selects
  populateSelect($('#translate-to'), false);
  populateSelect($('#source-language'), true);
  populateSelect($('#onboard-translate'), false);

  const saved = await chrome.storage.local.get(['settings', 'captionsEnabled', 'captionStyle', 'onboarded']);
  if (!saved.settings?.apiKey && !saved.onboarded) { showOnboarding(); return; }
  $('#main-app').style.display = 'flex';
  loadSettings(saved);
}

function loadSettings(saved) {
  const s = saved.settings || {};
  if (s.apiKey) $('#api-key').value = s.apiKey;
  if (s.translateTo) $('#translate-to').value = s.translateTo;
  if (s.sourceLanguage) $('#source-language').value = s.sourceLanguage;
  if (s.contextText) $('#context-text').value = s.contextText;
  if (s.captionFontSize) { $('#caption-font-size').value = s.captionFontSize; $('#font-size-value').textContent = s.captionFontSize + 'px'; }

  // Caption style
  const cs = saved.captionStyle || {};
  if (cs.color) { $('#caption-color').value = cs.color; $('#caption-color-label').textContent = cs.color; }
  if (cs.bgColor) { $('#caption-bg-color').value = cs.bgColor; $('#caption-bg-label').textContent = cs.bgColor; }
  if (cs.opacity != null) { $('#caption-opacity').value = cs.opacity; $('#opacity-value').textContent = cs.opacity + '%'; }
  if (cs.bold) $('#caption-bold').checked = true;
  if (cs.blur) $('#caption-blur').checked = true;
  if (cs.lock) $('#caption-lock').checked = true;
  if (cs.animation) { const r = $(`input[name="anim"][value="${cs.animation}"]`); if (r) r.checked = true; }

  captionsEnabled = saved.captionsEnabled !== false;
  $('#caption-toggle').classList.toggle('active', captionsEnabled);

  // Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const ta = $('#context-text');
      if (chip.classList.contains('active')) { chip.classList.remove('active'); ta.value = ''; }
      else { document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); ta.value = chip.dataset.val; }
    });
    if (s.contextText && chip.dataset.val === s.contextText) chip.classList.add('active');
  });

  // Check if already recording
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, r => { if (r?.isRecording) setRecordingUI(true); });
}

function showOnboarding() {
  $('#onboarding-view').style.display = '';
  $('#main-app').style.display = 'none';
  $('#onboard-done').addEventListener('click', async () => {
    const key = $('#onboard-key').value.trim();
    if (!key) { $('#onboard-key').style.borderColor = '#ef4444'; $('#onboard-key').focus(); return; }
    const translateTo = $('#onboard-translate')?.value || '';
    await chrome.storage.local.set({ settings: { apiKey: key, translateTo, captionFontSize: 22 }, onboarded: true });
    $('#onboarding-view').style.display = 'none';
    $('#main-app').style.display = 'flex';
    $('#api-key').value = key;
    if (translateTo) $('#translate-to').value = translateTo;
    showToast('Ready! Open a tab and click record');
  });
}

// ── Tabs ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const target = $('#tab-' + tab.dataset.tab);
    if (target) target.classList.add('active');
    if (tab.dataset.tab === 'export') updateExportStats();
  });
});

// ── Recording ──
async function startRecording() {
  const s = await chrome.storage.local.get('settings');
  const config = s.settings || {};
  if (!config.apiKey) { showToast('Set API key in Settings'); switchTab('settings'); return; }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = tabs[0];
  if (!tab?.id || tab.url?.startsWith('chrome')) {
    const all = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = all.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'));
  }
  if (!tab?.id) { showToast('Open a web page first'); return; }

  $('#record-btn').disabled = true;
  setStatus('connecting', 'Connecting...');
  finalText = ''; partialText = ''; translationText = ''; allTokens = []; updateDisplay();

  try {
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    } catch (e) {
      await new Promise(r => { chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => setTimeout(r, 500)); });
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }
    chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      data: { tabId: tab.id, streamId, config: { apiKey: config.apiKey, translateTo: config.translateTo || '', sourceLanguage: config.sourceLanguage || '', contextText: config.contextText || '' } }
    }, r => {
      $('#record-btn').disabled = false;
      if (r?.success) setRecordingUI(true);
      else { setStatus('error', 'Failed'); showToast(r?.error || 'Failed'); }
    });
  } catch (e) {
    $('#record-btn').disabled = false;
    setStatus('error', 'Failed');
    showToast(e.message || 'Capture failed');
  }
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
  setRecordingUI(false);
}

function setRecordingUI(rec) {
  isRecording = rec;
  const btn = $('#record-btn');
  btn.classList.toggle('recording', rec);
  $('#mic-icon').style.display = rec ? 'none' : '';
  $('#stop-icon').style.display = rec ? '' : 'none';
  btn.title = rec ? 'Stop Recording' : 'Start Recording';
  setStatus(rec ? 'recording' : 'idle', rec ? 'Recording' : 'Ready');

  // Timer
  const timer = $('#timer');
  if (rec) {
    recordStart = Date.now();
    timer.style.display = 'flex';
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  } else {
    clearInterval(timerInterval);
    // Keep timer visible to show final duration
    if (!recordStart) timer.style.display = 'none';
  }
}

function updateTimer() {
  if (!recordStart) return;
  const elapsed = Math.floor((Date.now() - recordStart) / 1000);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  $('#timer-text').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // ~$0.002/min = $0.12/hr
  const cost = (elapsed / 3600) * 0.12;
  $('#timer-cost').textContent = cost < 0.01 ? '' : `~$${cost.toFixed(3)}`;
}

// ── Transcript Display ──
function updateDisplay() {
  const has = finalText || partialText;
  $('#transcript-empty').style.display = has ? 'none' : '';
  const tc = $('#transcript-content');
  tc.style.display = has ? 'block' : 'none';
  tc.classList.toggle('active', !!has);
  if (has) {
    tc.innerHTML = `<span class="final">${esc(finalText)}</span><span class="partial">${esc(partialText)}</span>${isRecording ? '<span class="cursor"></span>' : ''}`;
    $('#transcript-area').scrollTop = $('#transcript-area').scrollHeight;
  }
  const total = finalText.length + partialText.length;
  $('#char-count').textContent = total > 0 ? `${total} chars` : '';
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function setStatus(state, text) { const si = $('#status-indicator'); si.className = 'status-indicator ' + state; si.querySelector('.status-text').textContent = text; }
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
}

// ── Settings ──
async function saveSettings() {
  await chrome.storage.local.set({ settings: {
    apiKey: $('#api-key').value.trim(),
    translateTo: $('#translate-to').value,
    sourceLanguage: $('#source-language').value,
    contextText: $('#context-text')?.value?.trim() || '',
    captionFontSize: parseInt($('#caption-font-size').value)
  }});
  showToast('Settings saved');
}

async function saveCaptionStyle() {
  const style = {
    color: $('#caption-color').value,
    bgColor: $('#caption-bg-color').value,
    opacity: parseInt($('#caption-opacity').value),
    bold: $('#caption-bold').checked,
    blur: $('#caption-blur').checked,
    lock: $('#caption-lock').checked,
    animation: $('input[name="anim"]:checked')?.value || 'none',
    fontSize: parseInt($('#caption-font-size').value)
  };
  await chrome.storage.local.set({ captionStyle: style, settings: { ...((await chrome.storage.local.get('settings')).settings || {}), captionFontSize: style.fontSize } });
  // Send to content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_CAPTION_STYLE', data: style }).catch(() => {});
  showToast('Captions updated');
}

async function testConnection() {
  const key = $('#api-key').value.trim();
  const tr = $('#test-result');
  if (!key) { tr.className = 'test-result error'; tr.textContent = 'Enter an API key'; tr.style.display = 'block'; return; }
  $('#test-btn').disabled = true; tr.style.display = 'none';
  try {
    await new Promise((res, rej) => {
      let done = false;
      const finish = fn => { if (done) return; done = true; fn(); };
      const w = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
      const to = setTimeout(() => { try{w.close();}catch(e){} finish(() => rej(new Error('Timeout'))); }, 8000);
      w.onopen = () => { w.send(JSON.stringify({ api_key: key, model: 'stt-rt-v4', audio_format: 'auto' })); setTimeout(() => { clearTimeout(to); try{w.close();}catch(e){} finish(() => res()); }, 2000); };
      w.onmessage = e => { try { const d = JSON.parse(e.data); if (d.error_code) { clearTimeout(to); try{w.close();}catch(e2){} finish(() => rej(new Error(d.error_message||'Error'))); } } catch(e2){} };
      w.onerror = () => { clearTimeout(to); finish(() => rej(new Error('Connection failed'))); };
      w.onclose = ev => { clearTimeout(to); if (ev.code !== 1000 && ev.code !== 1005) finish(() => rej(new Error(ev.reason||'Closed'))); };
    });
    tr.className = 'test-result success'; tr.textContent = '✓ Connected'; tr.style.display = 'block';
  } catch (e) { tr.className = 'test-result error'; tr.textContent = '✗ ' + e.message; tr.style.display = 'block'; }
  finally { $('#test-btn').disabled = false; }
}

// ── Export ──
function updateExportStats() {
  const elapsed = recordStart ? Math.floor(((isRecording ? Date.now() : Date.now()) - recordStart) / 1000) : 0;
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  $('#export-duration').textContent = elapsed > 0 ? `${m}:${String(s).padStart(2, '0')}` : '—';
  const chars = finalText.length + partialText.length;
  $('#export-chars').textContent = chars > 0 ? chars.toLocaleString() : '—';
  const cost = (elapsed / 3600) * 0.12;
  $('#export-cost').textContent = elapsed > 0 ? `$${cost.toFixed(3)}` : '—';

  // Update balance if present
  const balInput = $('#balance-input');
  if (balInput.value && elapsed > 0) {
    const originalBal = parseFloat(balInput.value);
    const remaining = Math.max(0, originalBal - cost);
    const hoursLeft = remaining / 0.12;
    const h = Math.floor(hoursLeft), mn = Math.round((hoursLeft - h) * 60);
    const timeEl = $('#balance-time');
    if (timeEl) timeEl.textContent = h > 0 ? `${h}h ${mn}m` : `${mn} min`;
  }
}

function buildSubtitleSegments() {
  const segs = [];
  let cur = { s: 0, e: 0, t: '' };
  // Use original tokens (they have timestamps), not translation tokens
  const tokens = allTokens.filter(t => t.isFinal && !t.isTranslation && t.startMs != null);
  if (tokens.length === 0) return segs;
  for (const tk of tokens) {
    const s = tk.startMs, e = tk.endMs || s + 500;
    if (cur.t.length + tk.text.length > 42 || e - cur.s > 5000) {
      if (cur.t) segs.push({ ...cur });
      cur = { s, e, t: tk.text };
    } else {
      if (!cur.t) cur.s = s;
      cur.t += tk.text;
      cur.e = e;
    }
  }
  if (cur.t) segs.push(cur);
  return segs;
}

function exportSRT() {
  const text = finalText + partialText;
  if (!text) { showToast('No transcript'); return; }
  const segs = buildSubtitleSegments();
  if (segs.length === 0) { showToast('No timestamp data — try TXT export'); return; }
  const srt = segs.map((s, i) => `${i + 1}\n${fmtSRT(s.s)} --> ${fmtSRT(s.e)}\n${s.t.trim()}\n`).join('\n');
  dl(srt, 'transcript.srt', 'text/plain');
  showToast('SRT exported');
}

function exportVTT() {
  const text = finalText + partialText;
  if (!text) { showToast('No transcript'); return; }
  const segs = buildSubtitleSegments();
  if (segs.length === 0) { showToast('No timestamp data — try TXT export'); return; }
  const vtt = 'WEBVTT\n\n' + segs.map((s, i) => `${i + 1}\n${fmtVTT(s.s)} --> ${fmtVTT(s.e)}\n${s.t.trim()}\n`).join('\n');
  dl(vtt, 'transcript.vtt', 'text/plain');
  showToast('VTT exported');
}

function exportTXT() {
  const text = finalText + partialText;
  if (!text && !translationText) { showToast('No transcript'); return; }
  const ts = new Date().toLocaleString();
  let content = `NGN Transcript\n${ts}\n${'='.repeat(50)}\n\n${text}\n`;
  if (translationText) content += `\n── Translation ──\n${translationText}\n`;
  dl(content, 'transcript.txt', 'text/plain');
  showToast('TXT exported');
}

function fmtSRT(ms) { const h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000), l = ms%1000; return `${p(h)}:${p(m)}:${p(s)},${p(l,3)}`; }
function fmtVTT(ms) { const h = Math.floor(ms/3600000), m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000), l = ms%1000; return `${p(h)}:${p(m)}:${p(s)}.${p(l,3)}`; }
function p(n, l=2) { return String(n).padStart(l, '0'); }
function dl(c, f, m) { const b = new Blob([c], {type: m+';charset=utf-8'}), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = f; a.click(); URL.revokeObjectURL(u); }

// ── Toast ──
let toastT = null;
function showToast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('visible'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('visible'), 2500); }

// ── Message Listener ──
chrome.runtime.onMessage.addListener(msg => {
  switch (msg.type) {
    case 'TRANSCRIPT_UPDATE':
      finalText = msg.data.finalText || finalText;
      partialText = msg.data.partialText || '';
      if (msg.data.finalTranslation) translationText = msg.data.finalTranslation;
      if (msg.data.tokens) allTokens.push(...msg.data.tokens);
      updateDisplay();
      break;
    case 'TRANSCRIPT_FINAL':
      finalText = msg.data.text || finalText;
      partialText = '';
      if (msg.data.translation) translationText = msg.data.translation;
      updateDisplay();
      break;
    case 'TRANSCRIPT_ERROR':
      setStatus('error', msg.data.message || 'Error');
      showToast(msg.data.message || 'Error');
      break;
    case 'CAPTURE_ERROR':
      setRecordingUI(false);
      showToast(msg.data.message || 'Capture error');
      break;
    case 'RECORDING_STOPPED':
      setRecordingUI(false);
      break;
    case 'ASR_STATE_CHANGE':
      if (msg.data.state === 'recording') setStatus('recording', 'Recording');
      else if (msg.data.state === 'connected') setStatus('connected', 'Connected');
      break;
  }
});

// ── Event Listeners ──
$('#record-btn').addEventListener('click', () => isRecording ? stopRecording() : startRecording());
$('#save-btn').addEventListener('click', saveSettings);
$('#test-btn').addEventListener('click', testConnection);
$('#toggle-key-btn').addEventListener('click', () => { const i = $('#api-key'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('#caption-font-size').addEventListener('input', () => $('#font-size-value').textContent = $('#caption-font-size').value + 'px');
$('#caption-opacity').addEventListener('input', () => $('#opacity-value').textContent = $('#caption-opacity').value + '%');
$('#caption-color').addEventListener('input', () => $('#caption-color-label').textContent = $('#caption-color').value);
$('#caption-bg-color').addEventListener('input', () => $('#caption-bg-label').textContent = $('#caption-bg-color').value);
$('#save-caption-btn').addEventListener('click', saveCaptionStyle);
$('#clear-btn').addEventListener('click', () => { finalText = ''; partialText = ''; translationText = ''; allTokens = []; updateDisplay(); showToast('Cleared'); });
$('#caption-toggle').addEventListener('click', async () => {
  captionsEnabled = !captionsEnabled;
  $('#caption-toggle').classList.toggle('active', captionsEnabled);
  await chrome.storage.local.set({ captionsEnabled });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: captionsEnabled ? 'SHOW_CAPTIONS' : 'HIDE_CAPTIONS' }).catch(() => {});
});
$('#export-srt').addEventListener('click', exportSRT);
$('#export-vtt').addEventListener('click', exportVTT);
$('#export-txt').addEventListener('click', exportTXT);

// Balance calculator
$('#balance-input').addEventListener('input', () => {
  const val = parseFloat($('#balance-input').value);
  const result = $('#balance-result');
  if (!val || val <= 0) { result.style.display = 'none'; return; }

  // $0.12/hr for real-time streaming
  const hoursRemaining = val / 0.12;
  const h = Math.floor(hoursRemaining);
  const m = Math.round((hoursRemaining - h) * 60);

  let timeStr;
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const rh = h % 24;
    timeStr = `${days}d ${rh}h ${m}m`;
  } else if (h > 0) {
    timeStr = `${h}h ${m}m`;
  } else {
    timeStr = `${m} minutes`;
  }

  $('#balance-time').textContent = timeStr;

  // Bar: map to visual scale (cap at $50 = 100%)
  const pct = Math.min(100, (val / 50) * 100);
  $('#balance-bar').style.width = pct + '%';

  // Color: green if > 2hrs, yellow if > 30min, red if less
  const timeEl = $('#balance-time');
  const barEl = $('#balance-bar');
  if (hoursRemaining > 2) {
    timeEl.style.color = 'var(--ok)';
    barEl.style.background = 'linear-gradient(90deg, var(--ok), var(--pr))';
  } else if (hoursRemaining > 0.5) {
    timeEl.style.color = '#f59e0b';
    barEl.style.background = 'linear-gradient(90deg, #f59e0b, var(--pr))';
  } else {
    timeEl.style.color = 'var(--dg)';
    barEl.style.background = 'var(--dg)';
  }

  result.style.display = '';
  // Save balance
  chrome.storage.local.set({ soniox_balance: val });
});

// Load saved balance
chrome.storage.local.get('soniox_balance', r => {
  if (r.soniox_balance) {
    $('#balance-input').value = r.soniox_balance;
    $('#balance-input').dispatchEvent(new Event('input'));
  }
});

init();
