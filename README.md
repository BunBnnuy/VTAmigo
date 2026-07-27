# VTAmigo

An AI co-host companion for Twitch and TikTok Live streams. It reads chat in real time, batches messages, and generates spoken responses using your choice of AI provider — with VTube Studio lip-sync support.

## Features

- **Twitch & TikTok Live** chat reading
- **AI responses** via Claude CLI, Grok CLI, or ChatGPT through the OpenAI API (switchable from settings)
- **Text-to-Speech** with configurable voice, speed, and volume
- **VTube Studio lip-sync** — mouth animation driven by phoneme timing
- **Twitch EventSub** — reacts to follows, subs, raids, cheers, and channel point redeems
- **Reddit stories** — reads aloud random stories from configurable subreddits when chat is idle
- **Mic transcription** — includes your voice in the AI context via SpeechRecognition
- **Configurable batching** — groups messages in a time window before sending to the AI
- **Response styles** — Auto, Chatbot, or Narrator
- **Screen question watcher** — detects trivia/quiz questions on screen (local Windows OCR + AI vision), posts them to chat for voting, and answers as co-host
- **Auto-click** — clicks the chosen answer on screen via OCR, with fallbacks (first option, window center) so the game never gets stuck
- **Auto-navigation (Majotori)** — after each round, clicks through the results screen back to the main menu and starts the next Solo Trivia round automatically
- **YouTube peek** — periodically comments on the YouTube video open in Chrome

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Claude CLI](https://github.com/anthropics/claude-code) (`npm install -g @anthropic-ai/claude-code`) **or** [Grok CLI](https://x.ai/) installed at `C:\Users\<you>\.grok\bin\grok.exe`
- For ChatGPT: an OpenAI API key in the `OPENAI_API_KEY` environment variable (a ChatGPT subscription does not include API usage)
- A Chromium-based browser for mic transcription (Web Speech API)
- (Optional) [VTube Studio](https://denchisoft.com/) with the Plugin API enabled
- (Optional) Windows 10/11 with an OCR language pack for the screen question watcher (uses the built-in `Windows.Media.Ocr` engine via PowerShell)

## Setup

```bash
# 1. Install all dependencies
npm run install:all

# 2. Start in development mode (backend + Vite frontend + browser)
npm run dev
```

The app opens at `http://localhost:5173`. The backend API runs on port `3001`.

## Building

```bash
# Build the frontend
npm run build

# Package as a Windows installer (Electron)
npm run dist:win
```

The installer is output to `dist-electron/`.

## Configuration

All settings are available in the in-app Settings panel:

| Setting | Description |
|---|---|
| AI Provider | Switch between Claude, Grok, and ChatGPT |
| Twitch channel / OAuth token / Client-ID | Connect to Twitch chat and EventSub |
| TikTok username | Connect to a TikTok Live chat |
| Batch window | Seconds to collect messages before sending to AI |
| Max messages per batch | Cap on messages sent per request |
| Response style | Auto / Chatbot / Narrator |
| Base prompt | System prompt prepended to every AI request |
| Reddit subreddits | Sources for idle-chat stories |
| TTS voice / speed / volume | Speech synthesis settings |
| Mic device / language / label | Voice transcription settings |
| VTube Studio URL / plugin / mouth param | Lip-sync connection settings |
| Screen watcher | Scan interval, chat voting window, target process, and capture region |
| Auto-click | Click the AI's answer or the chat's top vote |
| Auto-navigation | Click through Majotori's results screen and start the next Solo Trivia round |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_PATH` | WinGet install path | Path to the `claude.exe` binary |
| `GROK_PATH` | `C:\Users\<you>\.grok\bin\grok.exe` | Path to the `grok.exe` binary |
| `OPENAI_API_KEY` | â€” | API key for the ChatGPT/OpenAI provider |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional OpenAI model override |

## Project structure

```
AICompanion/
├── backend/          # Express API server
│   ├── index.js      # Routes
│   ├── claude.js     # AI provider (Claude / Grok) integration
│   ├── twitch.js     # Twitch IRC client
│   ├── eventsub.js   # Twitch EventSub client
│   ├── tiktok.js     # TikTok Live chat client
│   ├── reddit.js     # Reddit scraper
│   ├── vtube.js      # VTube Studio WebSocket
│   ├── phonemes.js   # Phoneme-based lip-sync scheduler
│   ├── animations.js # Thinking / speaking animation states
│   ├── screenwatch.js  # Screen question watcher + auto-navigation
│   ├── screenwatch.ps1 # Screen/window capture + OCR (Windows.Media.Ocr)
│   └── screenclick.ps1 # OCR-located mouse clicks on answer options
├── frontend/         # Vite + React UI
│   └── src/
│       ├── App.jsx
│       ├── Settings.jsx
│       ├── ChatFeed.jsx
│       └── ResponsePanel.jsx
└── electron/         # Electron main process
```

## License

MIT — see [LICENSE](LICENSE).
