/**
 * NGN – AI Audio Transcription | Background Service Worker
 */
let isRecording = false, currentTabId = null;

async function ensureOffscreen() {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
    if (ctx.length > 0) return;
  } catch (e) {
    // getContexts might not be available in older Chrome, try creating anyway
  }
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Audio capture for tab transcription' });
  } catch (e) {
    if (!e.message.includes('Only a single offscreen')) throw e;
  }
}

async function startCapture(tabId, streamId, config) {
  // If already recording, force stop first (fixes "active stream" error)
  if (isRecording) {
    console.log('[NGN BG] Force stopping previous recording before starting new one');
    await forceStop();
    // Brief delay to let Chrome release the stream
    await new Promise(r => setTimeout(r, 300));
  }

  // Ensure offscreen document exists
  await ensureOffscreen();

  // Validate the tab
  let targetTab;
  try {
    targetTab = await chrome.tabs.get(tabId);
  } catch (e) {
    throw new Error('Tab not found');
  }

  if (targetTab.url && (targetTab.url.startsWith('chrome://') || targetTab.url.startsWith('chrome-extension://'))) {
    throw new Error('Cannot capture audio from this page. Open a regular web page.');
  }

  if (!streamId) throw new Error('No stream ID provided');

  console.log('[NGN BG] Capturing tab:', tabId, targetTab.url?.substring(0, 50));

  // Send to offscreen for processing
  chrome.runtime.sendMessage({ type: 'START_CAPTURE', target: 'offscreen', data: { streamId, config, tabId } });

  isRecording = true;
  currentTabId = tabId;
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  return { success: true };
}

/** Force stop without checks — ensures clean state */
function forceStop() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', target: 'offscreen' });
    const prevTabId = currentTabId;
    isRecording = false;
    currentTabId = null;
    chrome.action.setBadgeText({ text: '' });
    if (prevTabId) chrome.tabs.sendMessage(prevTabId, { type: 'RECORDING_STOPPED' }).catch(() => {});
    // Small delay to ensure offscreen processes the stop
    setTimeout(resolve, 100);
  });
}

function stopCapture() {
  if (!isRecording) return;
  forceStop();
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  switch (msg.type) {
    case 'START_RECORDING':
      startCapture(msg.data.tabId, msg.data.streamId, msg.data.config)
        .then(() => respond({ success: true }))
        .catch(e => {
          console.error('[NGN BG] Start failed:', e);
          respond({ success: false, error: e.message });
        });
      return true; // async response

    case 'STOP_RECORDING':
      stopCapture();
      respond({ success: true });
      break;

    case 'GET_STATE':
      respond({ isRecording, currentTabId });
      break;

    // Forward transcription messages to popup/sidepanel AND content script
    case 'TRANSCRIPT_UPDATE':
    case 'TRANSCRIPT_FINAL':
    case 'TRANSCRIPT_FINISHED':
    case 'TRANSCRIPT_ERROR':
    case 'ASR_STATE_CHANGE':
    case 'CAPTURE_STARTED':
    case 'CAPTURE_ERROR':
      // Forward to other extension pages
      chrome.runtime.sendMessage(msg).catch(() => {});
      // Forward to content script on the captured tab
      if (currentTabId) chrome.tabs.sendMessage(currentTabId, msg).catch(() => {});
      // Handle errors
      if (msg.type === 'CAPTURE_ERROR') {
        isRecording = false;
        currentTabId = null;
        chrome.action.setBadgeText({ text: '' });
      }
      break;

    case 'RECORDING_STOPPED_BY_OFFSCREEN':
      const oldTab = currentTabId;
      isRecording = false;
      currentTabId = null;
      chrome.action.setBadgeText({ text: '' });
      chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(() => {});
      if (oldTab) chrome.tabs.sendMessage(oldTab, { type: 'RECORDING_STOPPED' }).catch(() => {});
      break;
  }
});

// Clean up if captured tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === currentTabId) stopCapture();
});

// Keyboard shortcut: Alt+S to toggle recording
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recording') return;
  
  if (isRecording) {
    stopCapture();
    // Notify all extension pages
    chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(() => {});
    return;
  }

  // Start recording on active tab
  try {
    const s = await chrome.storage.local.get('settings');
    const config = s.settings || {};
    if (!config.apiKey) return; // can't start without API key

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id || tab.url?.startsWith('chrome')) return;

    // For keyboard shortcut, we need to inject content script if not already there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => !!document.getElementById('ngn-sub')
      });
    } catch(e) {
      // Content script not injected yet, inject it
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/caption-overlay.css'] });
      } catch(e2) {}
    }

    // Get streamId - this works from background with activeTab triggered by command
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await startCapture(tab.id, streamId, {
      apiKey: config.apiKey,
      translateTo: config.translateTo || '',
      sourceLanguage: config.sourceLanguage || '',
      contextText: config.contextText || '',
    });
  } catch (e) {
    console.error('[NGN BG] Shortcut start failed:', e);
  }
});
