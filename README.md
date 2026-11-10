# Context Hub

**Find any AI coding session, and pick up where you left off.**

Context Hub is a small native Windows app that reads the session history your AI coding assistants already keep on disk, groups it by project, and lets you copy the context back into a new chat. Nothing is uploaded. Everything stays on your machine.

## Features

- **Timeline:** every session from every assistant on one list, grouped by day, with a ribbon to jump through time.
- **Projects:** sessions grouped by the folder they were run in (for example `C:\code\Quotation`). Switch between a list and a grid.
- **Last worked on:** open a project and see your last request and the assistant's last reply.
- **Copy project context:** copies the recent sessions of one project into a single block, with a "where it left off" summary at the top. Paste it into a new chat to continue.
- **Copy as context:** copy any single session the same way.
- **Search:** filter by text across sessions. Press `/` to start.
- **Light and dark themes.**

## Supported assistants

| Assistant | Where it reads from |
| --- | --- |
| Claude Code | `%USERPROFILE%\.claude\projects` |
| Codex | `%USERPROFILE%\.codex\sessions` |
| Cursor | `%USERPROFILE%\.cursor\projects` |
| VS Code / GitHub Copilot | `%APPDATA%\Code\User\workspaceStorage` |
| Kiro | `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent` |
| Antigravity | `%USERPROFILE%\.gemini\antigravity\conversations` |
| ZCode | `%USERPROFILE%\.zcode\cli\rollout` |
| OpenCode | `%USERPROFILE%\.local\share\opencode` |
| Zed | `%LOCALAPPDATA%\Zed\threads` |
| Trae | `%APPDATA%\Trae\User\workspaceStorage` |
| Freebuff | `%APPDATA%\Freebuff` |

## Download

Get the latest build from the [Releases](../../releases) page:

- **Context Hub_x.y.z_x64-setup.exe**: installer (recommended).
- **context-hub.exe**: portable, no installation. Needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 already include.

## Known limits

- The session viewer shows files up to **1 MB**. Larger sessions show a "too large to preview" note. Project summaries still read the end of larger Claude Code and VS Code sessions.
- Antigravity conversations are binary and have no text preview.
- OpenCode, Zed and Trae keep sessions in SQLite databases. They're listed, but their contents aren't read yet.
- Windows only.

## Build from source

You need:

- [Node.js](https://nodejs.org) 18 or newer
- [Rust](https://rustup.rs) (stable, MSVC toolchain)
- Microsoft C++ Build Tools (the "Desktop development with C++" workload)

```bash
npm install
npm run tauri dev       # run with live reload
npm run tauri build     # build the installer and portable exe
```

Build output lands in `src-tauri/target/release/`.

### Command line

```bash
npm run scan                  # list every session found, then exit
```

The UI lives in `ui/` (plain HTML, CSS and JavaScript, no framework). The Rust backend in `src-tauri/src/main.rs` finds and summarises the session files and serves them to the UI.

## Privacy

Context Hub only reads files in the folders listed above, on your machine. It makes no network requests.

## License

MIT
