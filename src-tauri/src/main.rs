// Release builds are GUI apps. Without this Windows links the exe as a console
// program and opens a terminal window next to the app on launch.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const FILES_DEPTH: usize = 8;
const STORES_DEPTH: usize = 3;
const HEAD_BYTES: u64 = 64 * 1024;
const READ_LIMIT: u64 = 1024 * 1024;
const SKIP_DIRS: [&str; 14] = [
    "node_modules",
    ".git",
    "tool-results",
    "target",
    "cache",
    "code cache",
    "gpucache",
    "crashpad",
    "partitions",
    "local storage",
    "session storage",
    "cacheddata",
    "backups",
    "logs",
];
const SUMMARY_KEYS: [&str; 6] = ["summary", "customTitle", "title", "name", "cwd", "model"];
const GENERIC_PARENTS: [&str; 8] = [
    "conversations",
    "projects",
    "sessions",
    "chatsessions",
    "agent-transcripts",
    "workspace-sessions",
    "threads",
    "rollout",
];

#[derive(Serialize)]
struct AgentDir {
    agent: String,
    path: String,
    exists: bool,
    count: usize,
}

#[derive(Serialize)]
struct SessionFile {
    id: String,
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    modified: u64,
    size: u64,
    summary: Option<String>,
    source: String,
    project: Option<String>,
}

#[derive(Serialize)]
struct ReadResult {
    content: String,
}

#[derive(Clone, Copy)]
enum Mode {
    Files {
        exts: &'static [&'static str],
        filter: Option<&'static str>,
        skip_names: &'static [&'static str],
    },
    Stores {
        suffixes: &'static [&'static str],
    },
}

#[derive(Clone)]
struct AgentSpec {
    name: &'static str,
    root: PathBuf,
    mode: Mode,
}

/// Every agent we know how to read, with the path its sessions actually live at
/// on this platform. `Files` scans real transcripts; `Stores` points at a
/// SQLite/LevelDB store we detect but do not index yet.
fn specs() -> Vec<AgentSpec> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let roaming = dirs::data_dir().unwrap_or_else(|| home.join("AppData").join("Roaming"));
    let local = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData").join("Local"));

    vec![
        AgentSpec {
            name: "Claude Code",
            root: home.join(".claude").join("projects"),
            mode: Mode::Files { exts: &["jsonl"], filter: None, skip_names: &[] },
        },
        AgentSpec {
            name: "Codex",
            root: home.join(".codex").join("sessions"),
            mode: Mode::Files { exts: &["jsonl"], filter: None, skip_names: &[] },
        },
        AgentSpec {
            name: "Cursor",
            root: home.join(".cursor").join("projects"),
            mode: Mode::Files { exts: &["jsonl"], filter: None, skip_names: &[] },
        },
        AgentSpec {
            name: "VS Code / Copilot",
            root: roaming.join("Code").join("User").join("workspaceStorage"),
            mode: Mode::Files { exts: &["jsonl", "json"], filter: Some("chatSessions"), skip_names: &[] },
        },
        AgentSpec {
            name: "Kiro",
            root: roaming.join("Kiro").join("User").join("globalStorage").join("kiro.kiroagent"),
            mode: Mode::Files { exts: &["json"], filter: Some("sessions"), skip_names: &["sessions.json"] },
        },
        AgentSpec {
            name: "Antigravity",
            root: home.join(".gemini").join("antigravity").join("conversations"),
            mode: Mode::Files { exts: &["pb"], filter: None, skip_names: &[] },
        },
        AgentSpec {
            name: "ZCode",
            root: home.join(".zcode").join("cli").join("rollout"),
            mode: Mode::Files { exts: &["jsonl"], filter: None, skip_names: &[] },
        },
        AgentSpec {
            name: "OpenCode",
            root: home.join(".local").join("share").join("opencode"),
            mode: Mode::Stores { suffixes: &["opencode.db"] },
        },
        AgentSpec {
            name: "Zed",
            root: local.join("Zed").join("threads"),
            mode: Mode::Stores { suffixes: &["threads.db"] },
        },
        AgentSpec {
            name: "Trae",
            root: roaming.join("Trae").join("User").join("workspaceStorage"),
            mode: Mode::Stores { suffixes: &["state.vscdb"] },
        },
        AgentSpec {
            name: "Freebuff",
            root: roaming.join("Freebuff"),
            mode: Mode::Files { exts: &["json", "jsonl"], filter: None, skip_names: &[] },
        },
    ]
}

fn walk(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        // Skip symlinks and Windows junctions: they can cycle and hang the scan.
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(&path, depth + 1, max_depth, out);
        } else if ft.is_file() {
            out.push(path);
        }
    }
}

fn matches_ext(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| exts.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn millis(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// FNV-1a over the absolute path: stable across scans, no crypto dependency.
fn stable_id(path: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in path.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    format!("{:016x}", h)
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_value(bytes[i + 1]), hex_value(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// VS Code-family editors drop a `workspace.json` beside the opaque hash folder.
/// Its `folder` field is the only human-readable name a transcript has.
fn workspace_label(path: &Path) -> Option<String> {
    let mut cursor = path.parent();
    let mut hops = 0;
    while let Some(dir) = cursor {
        if hops > 4 {
            break;
        }
        let candidate = dir.join("workspace.json");
        if candidate.exists() {
            if let Some(bytes) = read_head(&candidate, 8192) {
                let text = String::from_utf8_lossy(&bytes);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(folder) = value.get("folder").and_then(|v| v.as_str()) {
                        let decoded = percent_decode(folder.trim_start_matches("file:///"));
                        if let Some(tail) = decoded.rsplit(['/', '\\']).find(|s| !s.is_empty()) {
                            let tail: String = tail.chars().take(40).collect();
                            if !tail.is_empty() {
                                return Some(tail);
                            }
                        }
                    }
                }
            }
        }
        cursor = dir.parent();
        hops += 1;
    }
    None
}

fn display_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Claude/Cursor/VS Code name transcripts after a bare UUID - lead with the
    // nearest meaningful ancestor (project slug, workspace) instead.
    let looks_uuid = stem.len() >= 8
        && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        && stem.chars().any(|c| c == '-');
    if !looks_uuid {
        return stem;
    }

    let short: String = stem.chars().take(8).collect();
    if let Some(label) = workspace_label(path) {
        return format!("{} · {}", label, short);
    }
    let mut cursor = path.parent();
    let mut hops = 0;
    while let Some(dir) = cursor {
        if hops >= 3 {
            break;
        }
        let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else { break };
        let generic = GENERIC_PARENTS.contains(&name.to_lowercase().as_str());
        if !generic && !name.is_empty() && !name.starts_with(&short) {
            let label: String = name.chars().take(40).collect();
            return format!("{} · {}", label, short);
        }
        cursor = dir.parent();
        hops += 1;
    }
    short
}

fn read_head(path: &Path, limit: u64) -> Option<Vec<u8>> {
    let file = fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(limit).read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// Depth-limited hunt for the first human-meaningful string in a JSON line.
fn extract_hint(value: &serde_json::Value, depth: usize) -> Option<String> {
    if depth > 6 {
        return None;
    }
    match value {
        serde_json::Value::Object(map) => {
            for key in SUMMARY_KEYS {
                if let Some(s) = map.get(key).and_then(|v| v.as_str()) {
                    let s = s.trim();
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
            map.values().find_map(|v| extract_hint(v, depth + 1))
        }
        serde_json::Value::Array(items) => items
            .iter()
            .take(4)
            .find_map(|v| extract_hint(v, depth + 1)),
        _ => None,
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// Pull the first human-sounding `"text": "..."` value out of a JSON blob that
/// is too big or too pretty-printed to parse from a partial read.
fn first_text_blob(text: &str) -> Option<String> {
    let mut rest = text;
    while let Some(idx) = rest.find("\"text\"") {
        let after = rest[idx + 6..].trim_start();
        rest = after;
        let Some(after) = after.strip_prefix(':') else { continue };
        let after = after.trim_start();
        let Some(after) = after.strip_prefix('"') else { continue };

        let mut out = String::new();
        let mut escaped = false;
        for c in after.chars() {
            if escaped {
                out.push(match c {
                    'n' | 'r' | 't' => ' ',
                    other => other,
                });
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                break;
            } else {
                out.push(c);
            }
        }
        let clean = out.split_whitespace().collect::<Vec<_>>().join(" ");
        if clean.chars().count() > 20 && !clean.starts_with('<') {
            return Some(clean);
        }
        rest = after;
    }
    None
}

/// Best-effort one-line preview. Reads only the first 64 KB, never the whole
/// transcript (Claude/Codex sessions reach hundreds of MB).
fn summarize(path: &Path) -> Option<String> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pb"))
        .unwrap_or(false)
    {
        return None; // protobuf blob, nothing textual to show
    }

    let bytes = read_head(path, HEAD_BYTES)?;
    let text = String::from_utf8_lossy(&bytes);

    // Drop the final line: the 64 KB read usually cuts it mid-object.
    let mut lines: Vec<&str> = text.lines().collect();
    if !text.ends_with('\n') {
        lines.pop();
    }

    for line in lines.iter().take(6) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(hint) = extract_hint(&value, 0) {
                let hint = hint.trim();
                if hint.chars().count() >= 3 {
                    return Some(truncate_chars(hint, 200));
                }
            }
        }
    }

    if let Some(blob) = first_text_blob(&text) {
        return Some(truncate_chars(&blob, 200));
    }

    // Last resort: first line that is actually prose rather than JSON punctuation.
    let first = lines
        .iter()
        .map(|l| l.trim())
        .find(|l| !l.is_empty() && *l != "{" && *l != "[" && *l != "}" && *l != "]")?;
    Some(truncate_chars(first, 160))
}

/// Normalise a path so the same project groups together across agents.
fn normalize_path(p: &str) -> String {
    let mut out = p.replace('/', "\\");
    let bytes = out.as_bytes();
    if bytes.len() > 1 && bytes[1] == b':' {
        let head = out.chars().next().unwrap().to_ascii_uppercase();
        let mut buf = [0u8; 4];
        out.replace_range(0..head.len_utf8(), head.encode_utf8(&mut buf));
    }
    out
}

/// VS Code-family editors drop a `workspace.json` beside the opaque hash folder.
fn workspace_path(path: &Path) -> Option<String> {
    let mut cursor = path.parent();
    let mut hops = 0;
    while let Some(dir) = cursor {
        if hops > 4 {
            break;
        }
        let candidate = dir.join("workspace.json");
        if candidate.exists() {
            if let Some(bytes) = read_head(&candidate, 8192) {
                let text = String::from_utf8_lossy(&bytes);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(folder) = value.get("folder").and_then(|v| v.as_str()) {
                        let decoded = percent_decode(folder.trim_start_matches("file:///"));
                        if !decoded.is_empty() {
                            return Some(normalize_path(&decoded));
                        }
                    }
                }
            }
        }
        cursor = dir.parent();
        hops += 1;
    }
    None
}

fn b64url_decode(input: &str) -> Option<String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in input.bytes() {
        if c == b'=' {
            continue;
        }
        let v = TABLE.iter().position(|&t| t == c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    String::from_utf8(out).ok()
}

/// Kiro names its workspace folders with the base64url of the project path.
fn kiro_project(path: &Path) -> Option<String> {
    if !path.to_string_lossy().contains("kiro.kiroagent") {
        return None;
    }
    let parent = path.parent()?.file_name()?.to_string_lossy().to_string();
    if parent.len() < 8 {
        return None;
    }
    let decoded = b64url_decode(&parent)?;
    let cleaned = decoded.trim_end_matches(|c: char| {
        c.is_whitespace() || matches!(c, '?' | '.' | '*' | '"' | '<' | '>' | '|')
    });
    if cleaned.len() >= 3 && (cleaned.contains('\\') || cleaned.contains('/')) {
        return Some(normalize_path(cleaned));
    }
    None
}

fn find_cwd(value: &serde_json::Value, depth: usize) -> Option<String> {
    if depth > 5 {
        return None;
    }
    match value {
        serde_json::Value::Object(map) => {
            if let Some(cwd) = map.get("cwd").and_then(|v| v.as_str()) {
                if !cwd.trim().is_empty() {
                    return Some(normalize_path(cwd.trim()));
                }
            }
            map.values().find_map(|v| find_cwd(v, depth + 1))
        }
        serde_json::Value::Array(items) => items
            .iter()
            .take(6)
            .find_map(|v| find_cwd(v, depth + 1)),
        _ => None,
    }
}

/// Claude Code and Codex both stamp the working directory into the transcript.
fn cwd_from_head(path: &Path) -> Option<String> {
    let bytes = read_head(path, 16 * 1024)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<&str> = text.lines().collect();
    if !text.ends_with('\n') {
        lines.pop();
    }
    for line in lines.iter().take(8) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(cwd) = find_cwd(&value, 0) {
                return Some(cwd);
            }
        }
    }

    // A single huge first line (Codex `instructions`) truncates before `cwd`;
    // fall back to finding the key in the raw text.
    if let Some(idx) = text.find("\"cwd\"") {
        let after = &text[idx + 5..];
        if let Some(colon) = after.find(':') {
            let rest = after[colon + 1..].trim_start();
            if let Some(rest) = rest.strip_prefix('"') {
                if let Some(end) = rest.find('"') {
                    let raw = rest[..end].replace("\\\\", "\\");
                    if !raw.is_empty() {
                        return Some(normalize_path(&raw));
                    }
                }
            }
        }
    }
    None
}

/// Last resort: Claude/Cursor munge `C:\\code\\Quotation` into `C--code-Quotation`.
fn munged_parent(path: &Path) -> Option<String> {
    let mut cursor = path.parent();
    while let Some(dir) = cursor {
        let name = dir.file_name()?.to_string_lossy().to_string();
        let drive = name.chars().next()?;
        if drive.is_ascii_alphabetic() && name.chars().nth(1) == Some('-') {
            let mut out = String::new();
            out.push(drive.to_ascii_uppercase());
            out.push(':');
            for c in name.chars().skip(1) {
                out.push(if c == '-' { '\\' } else { c });
            }
            while out.contains("\\\\") {
                out = out.replace("\\\\", "\\");
            }
            return Some(out);
        }
        cursor = dir.parent();
    }
    None
}

/// Transcripts in one folder share a project, so a file with no `cwd` can borrow
/// the answer from a neighbour (this is what keeps `C:\\code\\a-port` from being
/// split into `C:\\code\\a\\port` by the lossy folder-name fallback).
fn sibling_cwd(path: &Path) -> Option<String> {
    let dir = path.parent()?;
    let Ok(entries) = fs::read_dir(dir) else {
        return None;
    };
    let mut probed = 0;
    for entry in entries.flatten() {
        let candidate = entry.path();
        if candidate == path || !candidate.is_file() {
            continue;
        }
        if !matches_ext(&candidate, &["jsonl", "json"]) {
            continue;
        }
        if let Some(cwd) = cwd_from_head(&candidate) {
            return Some(cwd);
        }
        probed += 1;
        if probed >= 3 {
            break;
        }
    }
    None
}

fn project_of(path: &Path) -> Option<String> {
    if let Some(p) = workspace_path(path) {
        return Some(p);
    }
    if let Some(p) = kiro_project(path) {
        return Some(p);
    }
    if let Some(p) = cwd_from_head(path) {
        return Some(p);
    }
    if let Some(p) = sibling_cwd(path) {
        return Some(p);
    }
    munged_parent(path)
}

fn make_session(path: &Path, agent: &str) -> Option<SessionFile> {
    let meta = fs::metadata(path).ok()?;
    let full = path.to_string_lossy().to_string();
    Some(SessionFile {
        id: stable_id(&full),
        name: display_name(path),
        path: full,
        kind: "file".to_string(),
        modified: meta.modified().map(millis).unwrap_or(0),
        size: meta.len(),
        summary: summarize(path),
        source: agent.to_string(),
        project: project_of(path),
    })
}

fn make_store(path: &Path, agent: &str) -> Option<SessionFile> {
    let meta = fs::metadata(path).ok()?;
    let full = path.to_string_lossy().to_string();
    let file = path.file_name()?.to_string_lossy().to_string();
    let parent = path
        .parent()
        .and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let label = if parent.is_empty() {
        file
    } else {
        let short: String = parent.chars().take(12).collect();
        format!("{} · {}", short, file)
    };
    Some(SessionFile {
        id: stable_id(&full),
        name: label,
        path: full,
        kind: "file".to_string(),
        modified: meta.modified().map(millis).unwrap_or(0),
        size: meta.len(),
        summary: Some(format!(
            "SQLite session store ({}) - session rows not indexed yet",
            agent
        )),
        source: agent.to_string(),
        project: None,
    })
}

/// Some editors keep the same conversation twice (`.json` on older builds,
/// `.jsonl` on newer). Count it once.
fn dedupe_by_session(files: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for path in files {
        let key = (
            path.parent().map(|p| p.to_path_buf()).unwrap_or_default(),
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
        );
        if seen.insert(key) {
            out.push(path);
        }
    }
    out
}

fn collect(spec: &AgentSpec) -> Vec<PathBuf> {
    let max_depth = match spec.mode {
        Mode::Files { .. } => FILES_DEPTH,
        Mode::Stores { .. } => STORES_DEPTH,
    };
    let mut all = Vec::new();
    walk(&spec.root, 0, max_depth, &mut all);
    all.retain(|p| match spec.mode {
        Mode::Files { exts, filter, skip_names } => {
            if !matches_ext(p, exts) {
                return false;
            }
            if let Some(needle) = filter {
                if !p.to_string_lossy().contains(needle) {
                    return false;
                }
            }
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            !skip_names.iter().any(|s| name.eq_ignore_ascii_case(s))
        }
        Mode::Stores { suffixes } => {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            suffixes.iter().any(|s| name == *s)
        }
    });
    match spec.mode {
        Mode::Files { .. } => dedupe_by_session(all),
        Mode::Stores { .. } => all,
    }
}

fn list_for(spec: &AgentSpec) -> Vec<SessionFile> {
    let mut files: Vec<SessionFile> = match spec.mode {
        Mode::Files { .. } => collect(spec)
            .iter()
            .filter_map(|p| make_session(p, spec.name))
            .collect(),
        Mode::Stores { .. } => collect(spec)
            .iter()
            .filter_map(|p| make_store(p, spec.name))
            .collect(),
    };
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files
}

#[tauri::command]
fn scan_directories() -> Result<Vec<AgentDir>, String> {
    Ok(specs()
        .into_iter()
        .map(|spec| {
            let exists = spec.root.exists();
            let count = if exists { collect(&spec).len() } else { 0 };
            AgentDir {
                agent: spec.name.to_string(),
                path: spec.root.to_string_lossy().to_string(),
                exists,
                count,
            }
        })
        .collect())
}

#[tauri::command]
fn list_files(directory: String) -> Result<Vec<SessionFile>, String> {
    let dir = PathBuf::from(&directory);
    if !dir.exists() {
        return Err(format!("Directory not found: {}", directory));
    }

    let spec = specs()
        .into_iter()
        .find(|s| s.root == dir)
        .unwrap_or_else(|| AgentSpec {
            name: "Custom folder",
            root: dir.clone(),
            mode: Mode::Files {
                exts: &["jsonl", "json", "md", "txt"],
                filter: None,
                skip_names: &[],
            },
        });

    Ok(list_for(&spec))
}

#[tauri::command]
fn read_file(file_path: String) -> Result<ReadResult, String> {
    let path = PathBuf::from(&file_path);
    let meta = fs::metadata(&path).map_err(|e| format!("Cannot open {}: {}", file_path, e))?;

    if meta.len() > READ_LIMIT {
        return Ok(ReadResult {
            content: format!(
                "This file is {:.1} MB, too large to preview.\n\n{}",
                meta.len() as f64 / 1_048_576.0,
                file_path
            ),
        });
    }

    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let content = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => "Binary file - no text preview available.".to_string(),
    };
    Ok(ReadResult { content })
}

/// Reads the last `max_bytes` of a file, for summaries of large transcripts.
/// Drops the partial first line so the text starts on a whole record.
#[tauri::command]
fn read_tail(file_path: String, max_bytes: u64) -> Result<ReadResult, String> {
    use std::io::{Seek, SeekFrom};
    let path = PathBuf::from(&file_path);
    let mut file = fs::File::open(&path).map_err(|e| format!("Cannot open {}: {}", file_path, e))?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.take(max_bytes).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if start > 0 {
        if let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            buf.drain(..=pos);
        }
    }
    let content = match String::from_utf8(buf) {
        Ok(text) => text,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    };
    Ok(ReadResult { content })
}

#[tauri::command]
fn recent_sessions(limit: usize) -> Result<Vec<SessionFile>, String> {
    let mut rows: Vec<(u64, PathBuf, &'static str)> = Vec::new();
    for spec in specs() {
        if !matches!(spec.mode, Mode::Files { .. }) || !spec.root.exists() {
            continue;
        }
        for path in collect(&spec) {
            let Ok(meta) = fs::metadata(&path) else { continue };
            rows.push((meta.modified().map(millis).unwrap_or(0), path, spec.name));
        }
    }
    // Sort cheaply on metadata first; only the newest N get a preview read.
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    let take = limit.min(200);
    Ok(rows
        .into_iter()
        .take(take)
        .filter_map(|(_, path, agent)| make_session(&path, agent))
        .collect())
}

#[tauri::command]
fn all_sessions() -> Result<Vec<SessionFile>, String> {
    let mut out = Vec::new();
    for spec in specs() {
        if !matches!(spec.mode, Mode::Files { .. }) || !spec.root.exists() {
            continue;
        }
        for path in collect(&spec) {
            if let Some(file) = make_session(&path, spec.name) {
                out.push(file);
            }
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
fn create_transfer_guide(target_agent: String) -> Result<String, String> {
    let mut picked: Vec<SessionFile> = Vec::new();
    for spec in specs() {
        if !matches!(spec.mode, Mode::Files { .. }) || !spec.root.exists() {
            continue;
        }
        picked.extend(list_for(&spec).into_iter().take(5));
    }
    picked.sort_by(|a, b| b.modified.cmp(&a.modified));

    let mut guide = String::new();
    guide.push_str("CONTEXT TRANSFER GUIDE\n=====================\n\n");
    guide.push_str(&format!("Target agent: {}\n", target_agent));
    guide.push_str(&format!("Sessions available: {}\n\n", picked.len()));
    guide.push_str("1. Pick the session below whose file path matches the work you want to continue.\n");
    guide.push_str("2. Open it in Context Hub and copy the conversation you need.\n");
    guide.push_str("3. Paste it into a new conversation in the target agent.\n\n");
    guide.push_str("========================================\nAVAILABLE SESSIONS (newest first)\n========================================\n\n");

    for (i, file) in picked.iter().enumerate() {
        guide.push_str(&format!("## {}. {}\n", i + 1, file.name));
        guide.push_str(&format!("Agent: {}\nPath: {}\nSize: {} bytes\n", file.source, file.path, file.size));
        if let Some(summary) = &file.summary {
            guide.push_str(&format!("Preview: {}\n", summary));
        }
        guide.push_str("\n---\n\n");
    }

    Ok(guide)
}

#[cfg(windows)]
fn attach_console() {
    // A GUI-subsystem exe has no console of its own. When it is started from a
    // terminal with CLI flags, reattach to that terminal so println! is visible.
    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    #[cfg(windows)]
    if args.iter().any(|a| a == "--scan-only" || a == "--projects") {
        attach_console();
    }

    // `cargo run -- --scan-only` prints what the scanner finds without opening a window.
    if args.iter().any(|a| a == "--projects") {
        let mut map: std::collections::BTreeMap<String, std::collections::BTreeMap<String, usize>> =
            Default::default();
        for spec in specs() {
            if !matches!(spec.mode, Mode::Files { .. }) || !spec.root.exists() {
                continue;
            }
            for path in collect(&spec) {
                let key = project_of(&path).unwrap_or_else(|| "(no project)".to_string());
                *map.entry(key)
                    .or_default()
                    .entry(spec.name.to_string())
                    .or_insert(0) += 1;
            }
        }
        let mut rows: Vec<_> = map
            .into_iter()
            .map(|(name, agents)| (name, agents.values().sum::<usize>(), agents))
            .collect();
        rows.sort_by(|a, b| b.1.cmp(&a.1));
        for (name, count, agents) in rows.iter().take(40) {
            let by_agent: Vec<String> = agents.iter().map(|(a, n)| format!("{}:{}", a, n)).collect();
            println!("{:>5}  {:<28} {}", count, by_agent.join(" "), name);
        }
        println!("{} projects total", rows.len());
        return;
    }

    if args.iter().any(|a| a == "--scan-only") {
        for spec in specs() {
            let exists = spec.root.exists();
            let count = if exists { collect(&spec).len() } else { 0 };
            println!(
                "{:<18} {:>5}  {}{}",
                spec.name,
                count,
                spec.root.display(),
                if exists { "" } else { "  (missing)" }
            );
            for session in list_for(&spec).into_iter().take(2) {
                println!(
                    "     - {}  [{} bytes] {}",
                    session.name,
                    session.size,
                    session.summary.unwrap_or_default()
                );
            }
        }
        return;
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_directories,
            list_files,
            read_file,
            read_tail,
            recent_sessions,
            all_sessions,
            create_transfer_guide
        ])
        .run(tauri::generate_context!())
        .expect("error while running Context Hub");
}
