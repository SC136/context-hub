# Context Hub - Native Windows Desktop App

A **fully native** Windows application built with **Tauri + Rust** that scans your device for real AI coding assistant sessions.

## Why Tauri?

✅ **Native** - Rust backend (not Node.js/Electron)  
✅ **Tiny** - ~5MB vs 150MB+ for Electron apps  
✅ **Fast** - Instant startup, no Chromium bloat  
✅ **Secure** - System-level access only where needed  
✅ **Modern** - Clean UI with vanilla JavaScript  

## Quick Start

### Prerequisites
1. Install **Rust**: https://rustup.rs/
2. Install **Node.js** 18+: https://nodejs.org/
3. Install **Visual Studio Build Tools** with C++:
   - Download: https://visualstudio.microsoft.com/downloads/
   - Select: "Desktop development with C++"

### Installation & Running

```bash
cd ai-context-dashboard

# Install dependencies
npm install

# Run in development mode (auto-reloads on changes)
npm run tauri dev

# Or build a production installer
npm run tauri build
```

After building, you'll find an MSI installer in `dist/` that creates a proper Windows app.

## What It Does

- 📂 **Scans** common AI agent storage locations automatically
- 🔍 **Discovers** session files (JSON, TXT, MD formats)
- 📊 **Displays** all your AI coding sessions in one place
-  **Generates** transfer guides for moving context between agents
- 💾 **Exports** full session data when needed
- 🌐 **Works offline** - nothing uploaded to cloud

## Supported Agents

- Claude Code
- Codex (OpenAI)
- Cursor
- Copilot Workspace
- Windsurf
- Cline
- Antigravity
- OpenCode
- Trae
- ZCode
- VSCode
- Kiro
- FreeBuff

## Architecture

```
┌─────────────────────────────────────┐
│         Native UI (Webview)          │
│   (React/Vue/Svelte + Tailwind)      │
└─────────────────────────────────────┘
              ↕ Tauri IPC
┌─────────────────────────────────────┐
│       Rust Backend (Safe & Fast)     │
│  • File system scanning              │
│  • Session parsing                   │
│  • Transfer generation               │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│        Your Windows System            │
│  • Reads actual AI session files     │
│  • No internet required              │
│  • Everything stays local             │
└─────────────────────────────────────┘
```

## Security

- Only reads files from paths you have permission to access
- Nothing is uploaded to external servers
- All processing happens locally
- Uses Rust's memory safety guarantees
- Minimal permissions (file system read-only)

## Development

### Adding New Features

1. **Frontend** - Edit `index.html` (JavaScript/Tailwind)
2. **Backend** - Add commands in `src/main.rs`
3. **Rebuild** - `npm run tauri dev` or `npm run tauri build`

### Example: Add New Agent Support

Add to the `possible_paths` array in `src/main.rs`:

```rust
("AgentName", home_dir.join(".agentname")),
```

## Troubleshooting

**Windows Defender blocks it?**
- Not a virus! Add an exclusion or sign the binary
- See: https://tauri.app/v1/guides/security/windows-smart-screen/

**Permission denied errors?**
- Make sure you've selected directories you own
- Run as administrator if needed

**No sessions found?**
- The agents might be installed in non-standard locations
- Use "Select Directory" to manually browse
- Check if your AI agent actually stores sessions locally

## Releases and auto-update

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed, and the app
updates itself from GitHub Releases (`https://github.com/SC136/context-hub/releases/latest/download/latest.json`).

Updater artifacts are signed. The public key lives in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`); the private key must never be committed. The workflow reads it from
two repository secrets:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password, empty if the key has none |

Generate a keypair with `npm run tauri -- signer generate -w ~/.tauri/context-hub.key` and copy
the new public key into `tauri.conf.json`. Changing the key pair breaks updates for anyone on an
older build, so keep one key for the life of the app.

A local release build also needs the private key in the environment:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\context-hub.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run build
```

## License

MIT

---

**Built for developers who want real control over their AI session data.**
