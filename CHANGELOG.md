# Changelog

## [2.0.0] - 2026-02-17

### 🎨 New Tabbed UI
- Complete popup redesign with 4 tabs: Transcript, Settings, Captions, Export
- Compact header with inline record button and live timer
- All settings accessible without scrolling
- Professional dark theme throughout

### 📤 SRT/VTT Export
- Export subtitles as **SRT** (SubRip) with timestamps
- Export subtitles as **VTT** (WebVTT) for web players
- Export as **TXT** with optional translation
- Timestamps from Soniox tokens (`start_ms` / `end_ms`)
- Smart segmentation: max 42 chars / 5 seconds per subtitle

### ✨ Caption Animations
- **None** — Instant display
- **Fade** — Smooth 300ms fade-in
- **Slide up** — Slide + fade from below

### 💰 Balance Calculator
- Enter your Soniox credit balance in the Export tab
- See remaining watch time (days/hours/minutes)
- Color-coded bar: green (>2hr), yellow (>30min), red (<30min)
- Balance saved between sessions
- Direct link to Soniox Console

### ⏱️ Live Session Timer
- Duration counter in the header while recording
- Real-time cost estimate ($0.12/hr)
- Session stats in Export tab (duration, characters, cost)

### 🎬 Caption Customization (Captions Tab)
- Font size slider (14–48px)
- Text color picker
- Background color picker
- Background opacity slider
- Bold, Blur BG, Lock position toggles
- Settings synced from popup to content script in real-time

### 🔧 Bug Fixes
- Fixed "No timestamp data" error in SRT export — tokens now forwarded with `startMs`/`endMs`
- Fixed subtitle delay reduced to ~1 second (from 2-3s)
- Fixed "Cannot capture a tab with an active stream" — auto force-stop and retry
- Fixed floating button start — now shows helpful hint tooltip instead of failing silently

## [1.0.0] - 2026-02-17

### Initial Release
- Real-time transcription via Soniox ASR v4
- Translation to 61 languages
- Netflix-style subtitle overlay (draggable, resizable)
- Mini floating player with audio wave visualization
- Onboarding flow for first-time users
- Content type presets (Movie, YouTube, News, Podcast, Music, Lecture)
- Source language hints for improved accuracy
- Speaker diarization support
- Keyboard shortcut (Alt+S) to toggle recording
- Tab audio passthrough
