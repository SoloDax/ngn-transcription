/**
 * NGN – AI Audio Transcription | Offscreen Document
 * 
 * SUBTITLE STRATEGY (v5 — "Netflix-style"):
 * 
 * The key problem: Soniox sends final translation tokens incrementally.
 * Old approach accumulated them into a growing string → user sees same text 
 * growing → feels like duplication.
 *
 * New approach: Each new batch of final tokens REPLACES the display.
 * - When new finals arrive: show ONLY the new text (+ any partials)
 * - Partials (non-final) are appended to show "typing" feel
 * - On endpoint (<end>): clear subtitle after brief delay
 * - History is still accumulated for export
 *
 * This mimics Netflix/YouTube subtitles: chunk appears → chunk disappears → 
 * next chunk appears. No accumulation, no repetition.
 */
const SONIOX_WS = 'wss://stt-rt.soniox.com/transcribe-websocket';
const TIMESLICE = 60;

let mediaStream, mediaRecorder, ws, cfg;
let audioCtx, audioSource;

// ── Export history (full accumulated text) ──
let historyOriginal = '';
let historyTranslation = '';

// ── Current subtitle display ──
// Netflix mode: accumulate translation silently, show only complete sentences.
let sentenceBuffer = '';  // Accumulates finals until endpoint
let currentDisplay = '';  // What's currently visible
let clearTimer = null;
let showTimer = null;     // Timer to show buffer if no endpoint comes
let lastSubtitle = '';    // Dedup

function send(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

function sendSubtitle(subtitle, extras) {
  const translationMode = !!cfg?.translateTo;
  const data = {
    finalText: historyOriginal,
    partialText: '',
    fullText: historyOriginal,
    finalTranslation: historyTranslation,
    subtitle: subtitle,
    hasTranslation: translationMode,
    debugLog: extras?.dbg || [],
    tokens: extras?.tokens || []
  };
  if (extras?.partialText) data.partialText = extras.partialText;
  send({ type: 'TRANSCRIPT_UPDATE', data });
}

function clearSubtitle() {
  currentDisplay = '';
  lastSubtitle = '';
  sendSubtitle('', { dbg: ['CLEAR'] });
}

/** Show the buffer content as a subtitle, then schedule clear */
function flushBuffer() {
  const text = sentenceBuffer.trim();
  sentenceBuffer = '';
  if (!text) return;

  // Cancel any currently showing subtitle — new one takes priority
  clearTimeout(clearTimer);

  if (text.length <= 80) {
    showAndScheduleClear(text);
  } else {
    const chunks = splitIntoSubtitles(text, 80);
    showChunksSequentially(chunks, 0);
  }
}

/** Show a subtitle and schedule its removal */
function showAndScheduleClear(text) {
  if (!text || text === lastSubtitle) return;
  currentDisplay = text;
  lastSubtitle = text;
  clearTimeout(clearTimer);
  sendSubtitle(text, { dbg: ['SHOW "' + text + '"'] });
  // Reading time: ~40ms per char, min 1.5s, max 3.5s
  const readTime = Math.max(1500, Math.min(3500, text.length * 40));
  clearTimer = setTimeout(clearSubtitle, readTime);
}

/** Show multiple subtitle chunks one after another */
function showChunksSequentially(chunks, idx) {
  if (idx >= chunks.length) return;
  const chunk = chunks[idx];
  showAndScheduleClear(chunk);
  if (idx + 1 < chunks.length) {
    const readTime = Math.max(1500, Math.min(3000, chunk.length * 40));
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      showChunksSequentially(chunks, idx + 1);
    }, readTime);
  }
}

/** Split text into subtitle-sized chunks at punctuation or word boundaries */
function splitIntoSubtitles(text, max) {
  const result = [];
  let remaining = text;
  while (remaining.length > max) {
    // Find break in first 'max' chars, prefer punctuation
    const segment = remaining.slice(0, max);
    let breakAt = -1;
    // Look for punctuation break from the end backwards
    for (let i = segment.length - 1; i > max * 0.4; i--) {
      if ('.!?;,'.includes(segment[i]) && i + 1 < segment.length && segment[i + 1] === ' ') {
        breakAt = i + 2; break;
      }
    }
    if (breakAt === -1) {
      // No punctuation — break at last space
      const lastSpace = segment.lastIndexOf(' ');
      breakAt = lastSpace > max * 0.3 ? lastSpace + 1 : max;
    }
    result.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

// ── ASR Connection ──
let reconnectAttempts = 0;
const MAX_RECONNECT = 3;

async function reconnectASR() {
  if (!cfg || !mediaStream || !mediaRecorder) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT) {
    console.log('[NGN] Max reconnect attempts reached, stopping');
    send({ type: 'TRANSCRIPT_ERROR', data: { code: 'MAX_RECONNECT', message: 'Connection lost after ' + MAX_RECONNECT + ' retries' } });
    stopCapture();
    send({ type: 'RECORDING_STOPPED_BY_OFFSCREEN' });
    return;
  }
  console.log('[NGN] Reconnecting ASR, attempt', reconnectAttempts);
  send({ type: 'ASR_STATE_CHANGE', data: { state: 'connecting' } });
  try {
    await connectASR(cfg);
    reconnectAttempts = 0; // reset on success
    send({ type: 'ASR_STATE_CHANGE', data: { state: 'recording' } });
    console.log('[NGN] Reconnected successfully');
  } catch (e) {
    console.error('[NGN] Reconnect failed:', e);
    setTimeout(() => reconnectASR(), 2000 * reconnectAttempts);
  }
}

function connectASR(config) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(SONIOX_WS);
    const timeout = setTimeout(() => { reject(new Error('Timeout')); try { ws.close(); } catch(e) {} }, 10000);

    ws.onopen = () => {
      clearTimeout(timeout);
      const c = {
        api_key: config.apiKey,
        model: 'stt-rt-v4',
        audio_format: 'auto',
        enable_endpoint_detection: true,
        enable_language_identification: true,
        enable_speaker_diarization: true,
        max_endpoint_delay_ms: 500,
      };
      if (config.sourceLanguage) c.language_hints = [config.sourceLanguage];
      if (config.contextText) c.context = { text: config.contextText };
      if (config.translateTo) c.translation = { type: 'one_way', target_language: config.translateTo };
      console.log('[NGN] Config:', JSON.stringify(c, (k, v) => k === 'api_key' ? '***' : v));
      ws.send(JSON.stringify(c));
      send({ type: 'ASR_STATE_CHANGE', data: { state: 'connected' } });
      resolve();
    };

    ws.onmessage = e => handleMsg(e.data);
    ws.onerror = (ev) => {
      clearTimeout(timeout);
      console.error('[NGN] WebSocket error:', ev);
      send({ type: 'TRANSCRIPT_ERROR', data: { code: 'WS_ERR', message: 'WebSocket connection error' } });
      reject(new Error('WS'));
    };
    ws.onclose = (ev) => {
      clearTimeout(timeout);
      console.log('[NGN] WS closed:', ev.code, ev.reason);
      send({ type: 'ASR_STATE_CHANGE', data: { state: 'idle' } });
      if (cfg && ev.code !== 1000) {
        send({ type: 'TRANSCRIPT_ERROR', data: { code: 'WS_CLOSED', message: 'Connection lost (' + ev.code + ')' } });
        // Auto-reconnect: if we still have a media stream, reconnect the ASR
        if (mediaStream && mediaRecorder && cfg) {
          console.log('[NGN] Auto-reconnecting ASR...');
          ws = null;
          setTimeout(() => reconnectASR(), 1000);
          return;
        }
        stopCapture();
        send({ type: 'RECORDING_STOPPED_BY_OFFSCREEN' });
      }
    };
  });
}

// ── Message Handler ──
function handleMsg(raw) {
  try {
    if (typeof raw !== 'string') {
      if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
      else return;
    }

    const r = JSON.parse(raw);

    if (r.error_code) {
      console.error('[NGN] API error:', r.error_code, r.error_message);
      send({ type: 'TRANSCRIPT_ERROR', data: { code: String(r.error_code), message: r.error_message || 'API error' } });
      if (r.error_code >= 400) { stopCapture(); send({ type: 'RECORDING_STOPPED_BY_OFFSCREEN' }); }
      return;
    }

    if (!r.tokens || r.tokens.length === 0) {
      if (r.finished) {
        send({ type: 'TRANSCRIPT_FINAL', data: { text: historyOriginal, translation: historyTranslation } });
        send({ type: 'TRANSCRIPT_FINISHED' });
      }
      return;
    }

    const translationMode = !!cfg?.translateTo;
    let endpointHit = false;

    // ── Extract tokens ──
    let newFinalOrig = '';
    let newFinalTrans = '';
    let partialOrig = '';
    let partialTrans = '';

    for (const t of r.tokens) {
      if (!t.text) continue;
      const txt = t.text.trim();

      if (txt === '<end>' || txt === '<END>') { endpointHit = true; continue; }
      if (txt === '<unk>' || txt === '<UNK>' || txt === '<silence>' || txt === '<SILENCE>') continue;

      const status = t.translation_status || 'none';

      if (t.is_final) {
        if (status === 'translation') {
          newFinalTrans += t.text;
          historyTranslation += t.text;
        } else {
          newFinalOrig += t.text;
          historyOriginal += t.text;
        }
      } else {
        if (status === 'translation') partialTrans += t.text;
        else partialOrig += t.text;
      }
    }

    // Forward tokens with timestamps for SRT export
    const exportTokens = r.tokens
      .filter(t => t.text && t.is_final && !['<end>','<END>','<unk>','<UNK>','<silence>','<SILENCE>'].includes(t.text.trim()))
      .map(t => ({
        text: t.text,
        isFinal: true,
        isTranslation: (t.translation_status || 'none') === 'translation',
        startMs: t.start_ms ?? null,
        endMs: t.end_ms ?? null,
      }));
    if (exportTokens.length > 0) {
      send({ type: 'TRANSCRIPT_UPDATE', data: {
        finalText: historyOriginal,
        partialText: '',
        finalTranslation: historyTranslation,
        hasTranslation: !!cfg?.translateTo,
        tokens: exportTokens,
        subtitle: '' // no subtitle update here, handled below
      }});
    }

    // ══════════ FAST NETFLIX-STYLE SUBTITLES ══════════
    // Hybrid: accumulate briefly (max 1.2s), then show as clean chunk.
    // Endpoint = instant flush. Punctuation (. ! ?) = instant flush.
    // This gives ~1s latency with clean readable subtitles.

    const newFinal = translationMode ? newFinalTrans : newFinalOrig;
    const partial = translationMode ? partialTrans : partialOrig;

    if (endpointHit) {
      if (newFinal) sentenceBuffer += newFinal;
      clearTimeout(showTimer);
      flushBuffer();
      return;
    }

    if (newFinal) {
      sentenceBuffer += newFinal;
      const buf = sentenceBuffer.trim();

      // Flush immediately if:
      // 1. Buffer ends with sentence-ending punctuation
      // 2. Buffer is longer than 50 chars (enough for a subtitle line)
      const endsWithPunct = /[.!?]$/.test(buf) || /[.!?]["'\u201d\u05f4]?$/.test(buf);
      
      if (endsWithPunct || buf.length > 50) {
        clearTimeout(showTimer);
        flushBuffer();
      } else {
        // Brief wait (1.2s) to batch small chunks together
        clearTimeout(showTimer);
        showTimer = setTimeout(() => {
          if (sentenceBuffer.trim()) flushBuffer();
        }, 1200);
      }
    }

    // Show partials as live preview while buffer accumulates
    if (partial && sentenceBuffer.trim()) {
      const preview = (sentenceBuffer + partial).trim();
      const trimmed = preview.length > 80 ? preview.slice(-80) : preview;
      if (trimmed !== lastSubtitle) {
        lastSubtitle = trimmed;
        sendSubtitle(trimmed, { dbg: ['⏳ "' + trimmed + '"'] });
      }
    }

    if (r.finished) {
      send({ type: 'TRANSCRIPT_FINAL', data: { text: historyOriginal, translation: historyTranslation } });
      send({ type: 'TRANSCRIPT_FINISHED' });
    }
  } catch (e) { console.error('[NGN] Parse error:', e); }
}

/**
 * Smart trim: cut text to max chars at the best break point.
 * Keeps the END of the text (newest content).
 * Prefers cutting after punctuation (. , ; ! ? —) + space.
 */
function smartTrim(text, max) {
  if (text.length <= max) return text;
  // We want to keep the TAIL of the text
  const excess = text.length - max;
  // Look for a break point in the first portion we're cutting
  const cutZone = text.slice(0, excess + 30); // search a bit past the cut point
  let cutAt = -1;

  // Find the LAST good break in the cut zone
  const re = /[.!?;,—]\s+/g;
  let m;
  while ((m = re.exec(cutZone)) !== null) {
    cutAt = m.index + m[0].length;
  }

  // Also check for just a space near the excess point
  if (cutAt === -1 || cutAt < excess - 10) {
    const spaceIdx = text.indexOf(' ', excess);
    if (spaceIdx !== -1 && spaceIdx < excess + 15) {
      cutAt = spaceIdx + 1;
    }
  }

  if (cutAt > 0 && cutAt < text.length - 5) {
    return text.slice(cutAt);
  }
  // Fallback: hard cut at word boundary
  const spaceIdx = text.indexOf(' ', excess);
  if (spaceIdx !== -1) return text.slice(spaceIdx + 1);
  return text.slice(-max);
}

// ── Capture ──
async function startCapture(streamId, config) {
  cfg = config;
  historyOriginal = ''; historyTranslation = '';
  sentenceBuffer = ''; currentDisplay = '';
  clearTimeout(clearTimer); clearTimeout(showTimer); lastSubtitle = '';
  reconnectAttempts = 0;

  try {
    console.log('[NGN] Starting capture, translateTo:', config.translateTo || 'none');

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });
    if (!mediaStream.getAudioTracks().length) throw new Error('No audio track');

    audioCtx = new AudioContext();
    audioSource = audioCtx.createMediaStreamSource(mediaStream);
    audioSource.connect(audioCtx.destination);

    await connectASR(config);

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0 && ws?.readyState === WebSocket.OPEN) ws.send(e.data);
    };
    mediaRecorder.onerror = () => send({ type: 'CAPTURE_ERROR', data: { message: 'Recorder error' } });
    mediaRecorder.start(TIMESLICE);

    mediaStream.getAudioTracks()[0].onended = () => {
      stopCapture();
      send({ type: 'RECORDING_STOPPED_BY_OFFSCREEN' });
    };

    send({ type: 'CAPTURE_STARTED' });
    send({ type: 'ASR_STATE_CHANGE', data: { state: 'recording' } });
  } catch (e) {
    console.error('[NGN] Capture failed:', e);
    send({ type: 'CAPTURE_ERROR', data: { message: e.message || 'Capture failed' } });
    stopCapture();
  }
}

function stopCapture() {
  const hadCfg = !!cfg;
  cfg = null; // Set null FIRST to prevent reconnect during cleanup
  reconnectAttempts = MAX_RECONNECT + 1; // prevent any pending reconnect
  try { if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop(); } catch(e) {}
  mediaRecorder = null;
  try { audioSource?.disconnect(); } catch(e) {} audioSource = null;
  try { audioCtx?.close(); } catch(e) {} audioCtx = null;
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  try { if (ws?.readyState === WebSocket.OPEN) ws.send(''); } catch(e) {}
  try { ws?.close(); } catch(e) {} ws = null;
  historyOriginal = ''; historyTranslation = '';
  sentenceBuffer = ''; currentDisplay = '';
  clearTimeout(clearTimer); clearTimeout(showTimer); lastSubtitle = '';
  reconnectAttempts = 0;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'START_CAPTURE') startCapture(msg.data.streamId, msg.data.config);
  else if (msg.type === 'STOP_CAPTURE') stopCapture();
});
