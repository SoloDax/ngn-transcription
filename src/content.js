/**
 * NGN – AI Audio Transcription | Content Script
 * - Movie-style subtitle overlay (draggable, resizable)
 * - Floating mini-player with settings panel
 * - Caption customization: color, background, opacity, font, blur, bold
 */
(() => {
  // ═══════════ Subtitle Overlay ═══════════
  let overlay, subBox, line1El, line2El;
  let isVisible = false, isLocked = false, clearTimer = null;
  let isDragging = false, dragStart = {x:0,y:0}, overlayStart = {x:0,y:0};
  let isResizing = false, resizeStart = {x:0,w:0,left:0};

  let captionSettings = {
    textColor: '#ffffff', bgColor: '#000000', bgOpacity: 78,
    fontSize: 22, bold: false, blur: true,
  };

  let captionAnimation = 'none'; // none | fade | slide

  function loadCaptionSettings() {
    try { const d = localStorage.getItem('ngn-caption-settings'); if (d) Object.assign(captionSettings, JSON.parse(d)); } catch(e) {}
    // Also load from chrome.storage (synced from popup)
    chrome.storage.local.get('captionStyle', r => {
      if (r.captionStyle) {
        const cs = r.captionStyle;
        if (cs.color) captionSettings.textColor = cs.color;
        if (cs.bgColor) captionSettings.bgColor = cs.bgColor;
        if (cs.opacity != null) captionSettings.bgOpacity = cs.opacity;
        if (cs.bold != null) captionSettings.bold = cs.bold;
        if (cs.blur != null) captionSettings.blur = cs.blur;
        if (cs.lock != null) isLocked = cs.lock;
        if (cs.fontSize) captionSettings.fontSize = cs.fontSize;
        if (cs.animation) captionAnimation = cs.animation;
        applyCaptionSettings();
      }
    });
  }
  function saveCaptionSettings() { try { localStorage.setItem('ngn-caption-settings', JSON.stringify(captionSettings)); } catch(e) {} }

  function applyCaptionSettings() {
    if (!subBox) return;
    const {textColor, bgColor, bgOpacity, fontSize, bold, blur} = captionSettings;
    const r = parseInt(bgColor.slice(1,3),16), g = parseInt(bgColor.slice(3,5),16), b = parseInt(bgColor.slice(5,7),16);
    subBox.style.background = `rgba(${r},${g},${b},${bgOpacity/100})`;
    subBox.style.fontSize = fontSize + 'px';
    subBox.style.fontWeight = bold ? '700' : '500';
    subBox.style.backdropFilter = blur ? 'blur(10px)' : 'none';
    subBox.style.webkitBackdropFilter = blur ? 'blur(10px)' : 'none';
    overlay?.querySelectorAll('.ngn-line').forEach(l => l.style.color = textColor);
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'ngn-sub';
    overlay.innerHTML = `
      <div class="ngn-sub-box">
        <div class="ngn-line ngn-l1" dir="auto"></div>
        <div class="ngn-line ngn-l2" dir="auto"></div>
      </div>
      <div class="ngn-resize-l"></div>
      <div class="ngn-resize-r"></div>`;
    document.documentElement.appendChild(overlay);
    subBox = overlay.querySelector('.ngn-sub-box');
    line1El = overlay.querySelector('.ngn-l1');
    line2El = overlay.querySelector('.ngn-l2');

    subBox.addEventListener('mousedown', e => { if (!isLocked) onDragStart(e); });
    overlay.querySelector('.ngn-resize-l').addEventListener('mousedown', e => onResizeStart(e,'left'));
    overlay.querySelector('.ngn-resize-r').addEventListener('mousedown', e => onResizeStart(e,'right'));
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);

    loadCaptionSettings(); loadPosition(); applyCaptionSettings();
  }

  function onDragStart(e) { e.preventDefault(); e.stopPropagation(); isDragging=true; dragStart={x:e.clientX,y:e.clientY}; const r=overlay.getBoundingClientRect(); overlayStart={x:r.left,y:r.top}; overlay.classList.add('ngn-dragging'); }
  function onResizeStart(e, side) { if(isLocked)return; e.preventDefault(); e.stopPropagation(); isResizing=side; resizeStart={x:e.clientX,w:overlay.offsetWidth,left:overlay.offsetLeft}; overlay.classList.add('ngn-dragging'); }
  function onMouseMove(e) {
    if (isDragging) { overlay.style.left=(overlayStart.x+e.clientX-dragStart.x)+'px'; overlay.style.top=(overlayStart.y+e.clientY-dragStart.y)+'px'; overlay.style.bottom='auto'; overlay.style.transform='none'; }
    else if (isResizing) { const dx=e.clientX-resizeStart.x; if(isResizing==='right') overlay.style.width=Math.max(200,resizeStart.w+dx)+'px'; else { const nw=Math.max(200,resizeStart.w-dx); overlay.style.width=nw+'px'; overlay.style.left=(resizeStart.left+(resizeStart.w-nw))+'px'; } }
  }
  function onMouseUp() { if(isDragging||isResizing){isDragging=false;isResizing=false;overlay.classList.remove('ngn-dragging');savePosition();} }

  function savePosition() { try { localStorage.setItem('ngn-sub-pos', JSON.stringify({left:overlay.style.left,top:overlay.style.top,bottom:overlay.style.bottom,transform:overlay.style.transform,width:overlay.style.width,locked:isLocked})); } catch(e) {} }
  function loadPosition() { try { const d=JSON.parse(localStorage.getItem('ngn-sub-pos')); if(!d)return; if(d.left)overlay.style.left=d.left; if(d.top)overlay.style.top=d.top; if(d.bottom)overlay.style.bottom=d.bottom; if(d.transform)overlay.style.transform=d.transform; if(d.width)overlay.style.width=d.width; if(d.locked){isLocked=true;overlay.classList.add('ngn-locked');} } catch(e) {} }

  function show() { createOverlay(); overlay.classList.add('ngn-visible'); isVisible = true; }
  function hide() { if (overlay) { overlay.classList.remove('ngn-visible'); isVisible = false; } }

  function showSubtitle(text, isFinal) {
    if (!isVisible) show();
    if (!line1El || !line2El) return;
    clearTimeout(clearTimer);
    if (!text?.trim()) { line1El.textContent=''; line2El.textContent=''; subBox?.classList.remove('ngn-fade-in','ngn-slide-in'); return; }
    const lines = splitLines(text.trim(), 42);

    // Apply animation
    if (captionAnimation === 'fade' && subBox) {
      subBox.classList.remove('ngn-fade-in');
      void subBox.offsetWidth; // force reflow
      subBox.classList.add('ngn-fade-in');
    } else if (captionAnimation === 'slide' && subBox) {
      subBox.classList.remove('ngn-slide-in');
      void subBox.offsetWidth;
      subBox.classList.add('ngn-slide-in');
    }

    line1El.textContent = lines[0] || '';
    line2El.textContent = lines[1] || '';
    overlay.classList.toggle('ngn-partial', !isFinal);
    if (isFinal) clearTimer = setTimeout(() => { line1El.textContent=''; line2El.textContent=''; }, 4000);
  }

  function splitLines(text, max) {
    if (text.length <= max) return [text];
    const mid = Math.floor(text.length/2); let b = -1;
    for (let i=mid; i>=Math.max(0,mid-20); i--) if (text[i]===' '){b=i;break;}
    if (b===-1) for (let i=mid; i<Math.min(text.length,mid+20); i++) if (text[i]===' '){b=i;break;}
    if (b===-1) return [text.substring(0,max),''];
    let l1=text.substring(0,b).trim(), l2=text.substring(b).trim();
    if (l1.length>max){const sp=l1.indexOf(' ',l1.length-max);if(sp!==-1)l1=l1.substring(sp+1);}
    if (l2.length>max){const sp=l2.lastIndexOf(' ',max);if(sp!==-1)l2=l2.substring(0,sp);}
    return [l1, l2];
  }

  // ═══════════ Mini-Player + Settings ═══════════
  let mini, panel, miniRecording = false;
  let mDrag = false, mMoved = false, mOff = {x:0,y:0};

  function createMini() {
    if (mini) return;
    mini = document.createElement('div');
    mini.id = 'ngn-mini';
    mini.innerHTML = `
      <button class="ngn-mini-btn" id="ngn-mini-toggle" title="Stop (Alt+S)">
        <svg class="ngn-mini-mic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        <svg class="ngn-mini-stop" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
      <div class="ngn-mini-waves"><div class="ngn-mini-bar"></div><div class="ngn-mini-bar"></div><div class="ngn-mini-bar"></div><div class="ngn-mini-bar"></div><div class="ngn-mini-bar"></div></div>
      <span class="ngn-mini-status">NGN</span>
      <button class="ngn-mini-gear" title="Caption Settings">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.38.23.63.63.71 1.09V10h.09a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>`;
    document.documentElement.appendChild(mini);

    mini.querySelector('#ngn-mini-toggle').addEventListener('click', e => {
      e.stopPropagation(); if (mMoved){mMoved=false;return;}
      if (miniRecording) {
        chrome.runtime.sendMessage({type:'STOP_RECORDING'});
        setMiniRecording(false);
      } else {
        // Show hint tooltip — tabCapture requires popup click or Alt+S
        showMiniHint();
      }
    });
    mini.querySelector('.ngn-mini-gear').addEventListener('click', e => { e.stopPropagation(); togglePanel(); });

    mini.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      mDrag=true; mMoved=false; const r=mini.getBoundingClientRect();
      mOff={x:e.clientX-r.left,y:e.clientY-r.top}; mini.style.transition='none'; e.preventDefault();
    });
    document.addEventListener('mousemove', e => { if(!mDrag)return; mMoved=true; mini.style.right='auto'; mini.style.left=(e.clientX-mOff.x)+'px'; mini.style.top=(e.clientY-mOff.y)+'px'; });
    document.addEventListener('mouseup', () => { if(mDrag){mDrag=false;mini.style.transition='';} });

    chrome.runtime.sendMessage({type:'GET_STATE'}, r => { if(r?.isRecording) setMiniRecording(true); });
  }

  function setMiniRecording(on, hasTranslation) {
    miniRecording = on; if (!mini) return;
    mini.classList.toggle('ngn-mini-rec', on);
    mini.classList.toggle('ngn-mini-translate', !!hasTranslation);
    const mic=mini.querySelector('.ngn-mini-mic'), stop=mini.querySelector('.ngn-mini-stop');
    if(mic)mic.style.display=on?'none':''; if(stop)stop.style.display=on?'':'none';
    const st=mini.querySelector('.ngn-mini-status'); if(st)st.textContent=on?(hasTranslation?'LIVE':'REC'):'NGN';
  }

  let hintEl = null;
  function showMiniHint() {
    if (hintEl) { hintEl.remove(); hintEl = null; return; }
    hintEl = document.createElement('div');
    hintEl.id = 'ngn-hint';
    hintEl.innerHTML = `
      <div class="ngn-hint-arrow"></div>
      <div class="ngn-hint-title">Start Recording</div>
      <div class="ngn-hint-body">
        <div class="ngn-hint-opt"><kbd>Alt</kbd> + <kbd>S</kbd><span>Keyboard shortcut</span></div>
        <div class="ngn-hint-divider">or</div>
        <div class="ngn-hint-opt"><span>Click the <strong>NGN icon</strong> in the toolbar ↗</span></div>
      </div>`;
    document.documentElement.appendChild(hintEl);
    // Position near the mini player
    const mr = mini.getBoundingClientRect();
    hintEl.style.top = (mr.bottom + 10) + 'px';
    hintEl.style.right = Math.max(8, window.innerWidth - mr.right) + 'px';
    // Auto-dismiss
    setTimeout(() => {
      document.addEventListener('click', function dismiss(ev) {
        if (hintEl && !hintEl.contains(ev.target) && !mini.contains(ev.target)) {
          hintEl.remove(); hintEl = null;
        }
        document.removeEventListener('click', dismiss);
      });
    }, 100);
    setTimeout(() => { if (hintEl) { hintEl.remove(); hintEl = null; } }, 6000);
  }

  // ═══════════ Settings Panel ═══════════
  function togglePanel() { if (panel) { panel.remove(); panel=null; return; } createPanel(); }

  function createPanel() {
    loadCaptionSettings();
    const cs = captionSettings;
    panel = document.createElement('div');
    panel.id = 'ngn-panel';
    panel.innerHTML = `
      <div class="ngn-ph">
        <span class="ngn-pt">Caption Settings</span>
        <div class="ngn-pa">
          <button class="ngn-pa-btn" data-act="log">📋 Log</button>
          <button class="ngn-pa-btn" data-act="reset">Reset</button>
          <button class="ngn-pa-close">✕</button>
        </div>
      </div>
      <div class="ngn-pb">
        <div class="ngn-pr">
          <div class="ngn-pc">
            <label class="ngn-pl">Text</label>
            <div class="ngn-cw"><input type="color" class="ngn-ci" data-key="textColor" value="${cs.textColor}"><span class="ngn-cs" style="background:${cs.textColor}"></span></div>
          </div>
          <div class="ngn-pc">
            <label class="ngn-pl">Background</label>
            <div class="ngn-cw"><input type="color" class="ngn-ci" data-key="bgColor" value="${cs.bgColor}"><span class="ngn-cs" style="background:${cs.bgColor}"></span></div>
          </div>
        </div>
        <div class="ngn-pr ngn-pr-slider">
          <label class="ngn-pl">Font Size <span class="ngn-val" data-for="fontSize">${cs.fontSize}px</span></label>
          <div class="ngn-slider-row"><span class="ngn-sl">A</span><input type="range" class="ngn-range" data-key="fontSize" min="14" max="48" value="${cs.fontSize}"><span class="ngn-sl ngn-sl-big">A</span></div>
        </div>
        <div class="ngn-pr ngn-pr-slider">
          <label class="ngn-pl">Opacity <span class="ngn-val" data-for="bgOpacity">${cs.bgOpacity}%</span></label>
          <div class="ngn-slider-row"><span class="ngn-sl">○</span><input type="range" class="ngn-range" data-key="bgOpacity" min="0" max="100" value="${cs.bgOpacity}"><span class="ngn-sl">●</span></div>
        </div>
        <div class="ngn-pr ngn-toggles">
          <div class="ngn-ti"><label class="ngn-pl">Bold</label><button class="ngn-tg ${cs.bold?'ngn-on':''}" data-key="bold"><span class="ngn-tg-dot"></span></button></div>
          <div class="ngn-ti"><label class="ngn-pl">Blur BG</label><button class="ngn-tg ${cs.blur?'ngn-on':''}" data-key="blur"><span class="ngn-tg-dot"></span></button></div>
          <div class="ngn-ti"><label class="ngn-pl">Lock</label><button class="ngn-tg ${isLocked?'ngn-on':''}" data-key="lock"><span class="ngn-tg-dot"></span></button></div>
        </div>
      </div>
      <div class="ngn-pp">
        <div class="ngn-pp-label">Preview</div>
        <div class="ngn-pp-box" dir="auto"><div class="ngn-pp-line">Sample caption line</div><div class="ngn-pp-line">Second line wrapping test</div></div>
      </div>`;
    document.documentElement.appendChild(panel);

    // Position
    const mr = mini.getBoundingClientRect();
    panel.style.top = (mr.bottom + 8) + 'px';
    const rightOffset = Math.max(8, window.innerWidth - mr.right);
    panel.style.right = rightOffset + 'px';
    updatePreview();

    // Ranges
    panel.querySelectorAll('.ngn-range').forEach(r => r.addEventListener('input', () => {
      captionSettings[r.dataset.key] = parseInt(r.value);
      const v = panel.querySelector(`.ngn-val[data-for="${r.dataset.key}"]`);
      if (v) v.textContent = r.value + (r.dataset.key==='bgOpacity'?'%':'px');
      applyCaptionSettings(); saveCaptionSettings(); updatePreview();
    }));

    // Colors
    panel.querySelectorAll('.ngn-ci').forEach(c => c.addEventListener('input', () => {
      captionSettings[c.dataset.key] = c.value;
      c.nextElementSibling.style.background = c.value;
      applyCaptionSettings(); saveCaptionSettings(); updatePreview();
    }));

    // Toggles (real toggle switches)
    panel.querySelectorAll('.ngn-tg').forEach(t => t.addEventListener('click', () => {
      const key = t.dataset.key;
      if (key==='lock') { isLocked=!isLocked; if(overlay)overlay.classList.toggle('ngn-locked',isLocked); t.classList.toggle('ngn-on',isLocked); savePosition(); }
      else { captionSettings[key]=!captionSettings[key]; t.classList.toggle('ngn-on',captionSettings[key]); applyCaptionSettings(); saveCaptionSettings(); updatePreview(); }
    }));

    // Log viewer
    panel.querySelector('[data-act="log"]').addEventListener('click', () => { toggleLogViewer(); });

    // Reset
    panel.querySelector('[data-act="reset"]').addEventListener('click', () => {
      captionSettings={textColor:'#ffffff',bgColor:'#000000',bgOpacity:78,fontSize:22,bold:false,blur:true};
      applyCaptionSettings(); saveCaptionSettings(); panel.remove(); panel=null; createPanel();
      if(overlay){overlay.style.left='50%';overlay.style.top='';overlay.style.bottom='60px';overlay.style.transform='translateX(-50%)';overlay.style.width='';loadPosition();applyCaptionSettings();}
    });

    // Close
    panel.querySelector('.ngn-pa-close').addEventListener('click', () => { panel.remove(); panel=null; });
    setTimeout(() => document.addEventListener('click', function h(e) { if(panel&&!panel.contains(e.target)&&!mini.contains(e.target)){panel.remove();panel=null;document.removeEventListener('click',h);} }), 100);
  }

  function updatePreview() {
    if (!panel) return;
    const box = panel.querySelector('.ngn-pp-box'); if (!box) return;
    const {textColor,bgColor,bgOpacity,fontSize,bold,blur} = captionSettings;
    const r=parseInt(bgColor.slice(1,3),16),g=parseInt(bgColor.slice(3,5),16),b=parseInt(bgColor.slice(5,7),16);
    box.style.background=`rgba(${r},${g},${b},${bgOpacity/100})`;
    box.style.fontSize=Math.min(fontSize,18)+'px';
    box.style.fontWeight=bold?'700':'500';
    box.style.backdropFilter=blur?'blur(10px)':'none';
    box.querySelectorAll('.ngn-pp-line').forEach(l=>l.style.color=textColor);
  }

  // ═══════════ Debug Log Buffer ═══════════
  const debugLog = [];
  const MAX_LOG = 200;
  function addLog(msg) {
    const ts = new Date().toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits:3});
    debugLog.push(ts + ' ' + msg);
    if (debugLog.length > MAX_LOG) debugLog.shift();
  }

  let logOverlay = null;
  function toggleLogViewer() {
    if (logOverlay) { logOverlay.remove(); logOverlay = null; return; }
    logOverlay = document.createElement('div');
    logOverlay.id = 'ngn-log';
    logOverlay.innerHTML = `
      <div class="ngn-log-header">
        <span>NGN Debug Log</span>
        <div>
          <button class="ngn-log-btn" id="ngn-log-copy">Copy</button>
          <button class="ngn-log-btn" id="ngn-log-clear">Clear</button>
          <button class="ngn-log-btn" id="ngn-log-close">✕</button>
        </div>
      </div>
      <pre class="ngn-log-body" id="ngn-log-body"></pre>`;
    document.documentElement.appendChild(logOverlay);
    refreshLogView();
    logOverlay.querySelector('#ngn-log-close').addEventListener('click', () => { logOverlay.remove(); logOverlay = null; });
    logOverlay.querySelector('#ngn-log-clear').addEventListener('click', () => { debugLog.length = 0; refreshLogView(); });
    logOverlay.querySelector('#ngn-log-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(debugLog.join('\n')).then(() => {
        const btn = logOverlay.querySelector('#ngn-log-copy');
        btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });
  }
  function refreshLogView() {
    if (!logOverlay) return;
    const body = logOverlay.querySelector('#ngn-log-body');
    if (body) { body.textContent = debugLog.length ? debugLog.join('\n') : '(no logs yet — start recording)'; body.scrollTop = body.scrollHeight; }
  }
  // Auto-refresh log every 500ms if open
  setInterval(() => { if (logOverlay) refreshLogView(); }, 500);

  // ═══════════ Init ═══════════
  createMini();
  chrome.runtime.onMessage.addListener(msg => {
    switch (msg.type) {
      case 'TRANSCRIPT_UPDATE':
        showSubtitle(msg.data.subtitle??'', !msg.data.subtitle);
        if (!miniRecording) setMiniRecording(true, msg.data.hasTranslation);
        // Log subtitle updates
        if (msg.data.subtitle) addLog('SUB: "' + msg.data.subtitle + '"');
        if (msg.data.debugLog) msg.data.debugLog.forEach(l => addLog(l));
        break;
      case 'TRANSCRIPT_FINAL': showSubtitle('',true); addLog('── FINAL ──'); break;
      case 'CAPTURE_STARTED': case 'ASR_STATE_CHANGE': if(msg.data?.state==='recording') { setMiniRecording(true); addLog('STATE: recording'); } break;
      case 'CAPTURE_ERROR':
        setMiniRecording(false); addLog('ERROR: ' + (msg.data?.message || 'unknown')); break;
      case 'RECORDING_STOPPED':
        setMiniRecording(false); addLog('STATE: stopped');
        setTimeout(()=>{if(line1El)line1El.textContent='';if(line2El)line2El.textContent='';setTimeout(()=>hide(),1000);},2000); break;
      case 'SHOW_CAPTIONS': show(); break;
      case 'HIDE_CAPTIONS': hide(); break;
      case 'UPDATE_CAPTION_STYLE':
        const cs = msg.data || {};
        if (cs.color) captionSettings.textColor = cs.color;
        if (cs.bgColor) captionSettings.bgColor = cs.bgColor;
        if (cs.opacity != null) captionSettings.bgOpacity = cs.opacity;
        if (cs.bold != null) captionSettings.bold = cs.bold;
        if (cs.blur != null) captionSettings.blur = cs.blur;
        if (cs.lock != null) { isLocked = cs.lock; overlay?.classList.toggle('ngn-locked', isLocked); }
        if (cs.fontSize) captionSettings.fontSize = cs.fontSize;
        if (cs.animation) captionAnimation = cs.animation;
        applyCaptionSettings(); saveCaptionSettings();
        break;
    }
  });
})();
