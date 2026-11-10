use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
struct SessionFile {
    id: String,
    name: String,
    path: String,
    source_agent: String,
    modified_at: String,
    size: u64,
    summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DirectoryScanResult {
    agent_name: String,
    path: String,
    exists: bool,
    session_count: usize,
}

#[tauri::command]
fn scan_session_directories() -> Result<Vec<DirectoryScanResult>, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    
    let possible_paths = vec![
        ("Claude Code", home_dir.join(".claude").join("projects")),
        ("Codex", home_dir.join(".codex").join("sessions")),
        ("Cursor", home_dir.join(".cursor").join("workspaceHistory")),
        ("VSCode", home_dir.join(".config").join("Code").join("User").join("globalStorage")),
        ("Zed", home_dir.join(".local").join("share").join("zed")),
        ("OpenCode", home_dir.join(".opencode")),
        ("Trae", home_dir.join(".trae")),
        ("Antigravity", home_dir.join(".antigravity")),
        ("Kiro", home_dir.join(".kiro")),
        ("FreeBuff", home_dir.join(".freebuff")),
        ("ZCode", home_dir.join(".zcode")),
    ];

    let mut results = Vec::new();
    
    for (agent_name, path) in possible_paths.iter() {
        let exists = path.exists();
        let session_count = if exists {
            count_sessions_recursive(path)
        } else {
            0
        };
        
        results.push(DirectoryScanResult {
            agent_name: agent_name.clone(),
            path: path.to_string_lossy().to_string(),
            exists,
            session_count,
        });
    }

    Ok(results)
}

fn count_sessions_recursive(dir: &PathBuf) -> usize {
    let mut count = 0;
    
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check if this looks like a session/project folder
                let filename = path.file_name()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                
                if filename.contains("session") 
                    || filename.contains("chat") 
                    || filename.contains("history")
                    || filename.starts_with('.')
                {
                    count += 1;
                }
                
                // Recursively count in subdirectories
                count += count_sessions_recursive(&path);
            } else if is_session_file(&path) {
                count += 1;
            }
        }
    }
    
    count
}

fn is_session_file(path: &PathBuf) -> bool {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    
    let session_extensions = ["json", "txt", "md"];
    let filename_lower = path.file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    
    session_extensions.contains(&ext.as_str()) 
        || filename_lower.contains("session")
        || filename_lower.contains("chat")
        || filename_lower.contains("conversation")
}

#[tauri::command]
fn list_sessions_from_directory(directory: String) -> Result<Vec<SessionFile>, String> {
    let dir = PathBuf::from(&directory);
    let mut sessions = Vec::new();
    
    fn scan_dir(current_dir: &PathBuf, source_agent: &str, result: &mut Vec<SessionFile>) {
        if !current_dir.exists() {
            return;
        }
        
        if let Ok(entries) = fs::read_dir(current_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                
                if path.is_dir() {
                    // Check if this might be a session folder
                    let filename = path.file_name()
                        .map(|s| s.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    
                    if filename.contains("session") 
                        || filename.contains("chat")
                        || filename.contains("history")
                        || filename.starts_with('.')
                        || filename == "workspace"
                    {
                        // Add as a project/session folder
                        result.push(SessionFile {
                            id: generate_id(&path),
                            name: path.file_name()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| "unknown".to_string()),
                            path: path.to_string_lossy().to_string(),
                            source_agent: source_agent.to_string(),
                            modified_at: entry.metadata()
                                .map(|m| m.modified()
                                    .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                                    .unwrap_or_else(|_| "unknown".to_string()))
                                .unwrap_or_else(|_| "unknown".to_string()),
                            size: 0,
                            summary: None,
                        });
                        
                        // Scan subdirectory too
                        scan_dir(&path, source_agent, result);
                    } else {
                        // Recursively scan other directories
                        scan_dir(&path, source_agent, result);
                    }
                } else if is_session_file(&path) {
                    if let Ok(metadata) = fs::metadata(&path) {
                        let summary = read_session_summary(&path);
                        
                        result.push(SessionFile {
                            id: generate_id(&path),
                            name: path.file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| "unknown".to_string()),
                            path: path.to_string_lossy().to_string(),
                            source_agent: source_agent.to_string(),
                            modified_at: metadata.modified()
                                .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                                .unwrap_or_else(|_| "unknown".to_string()),
                            size: metadata.len(),
                            summary,
                        });
                    }
                }
            }
        }
    }
    
    scan_dir(&dir, guess_agent_from_path(&dir), &mut sessions);
    
    // Sort by modified date (newest first)
    sessions.sort_by(|a, b| {
        b.modified_at.cmp(&a.modified_at)
    });
    
    Ok(sessions)
}

fn generate_id(path: &PathBuf) -> String {
    format!(
        "{}-{}",
        path.to_string_lossy(),
        chrono::Utc::now().timestamp_nanos().unwrap_or(0)
    )
}

fn guess_agent_from_path(path: &PathBuf) -> String {
    let path_str = path.to_string_lossy().to_lowercase();
    
    if path_str.contains(".claude") {
        "Claude Code".to_string()
    } else if path_str.contains(".codex") {
        "Codex".to_string()
    } else if path_str.contains(".cursor") {
        "Cursor".to_string()
    } else if path_str.contains(".vscode") || path_str.contains("code") {
        "VSCode".to_string()
    } else if path_str.contains(".zed") {
        "Zed".to_string()
    } else if path_str.contains(".opencode") {
        "OpenCode".to_string()
    } else if path_str.contains(".trae") {
        "Trae".to_string()
    } else if path_str.contains(".antigravity") {
        "Antigravity".to_string()
    } else if path_str.contains(".kiro") {
        "Kiro".to_string()
    } else if path_str.contains(".freebuff") {
        "FreeBuff".to_string()
    } else if path_str.contains(".zcode") {
        "ZCode".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn read_session_summary(path: &PathBuf) -> Option<String> {
    if let Ok(content) = fs::read_to_string(path) {
        let lines: Vec<&str> = content.lines().collect();
        
        if path.extension().map(|e| e.to_string_lossy().to_lowercase()) == Some("json".into()) {
            // Try to parse JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(summary) = json.get("summary").as_str() {
                    return Some(summary.to_string());
                } else if let Some(title) = json.get("title").as_str() {
                    return Some(title.to_string());
                } else if let Some(messages) = json.get("messages").as_array() {
                    if let Some(last_msg) = messages.last() {
                        if let Some(content) = last_msg.get("content").as_str() {
                            return Some(content.chars().take(200).collect());
                        }
                    }
                }
            }
        }
        
        // Use first few lines
        if !lines.is_empty() {
            return Some(lines[..std::cmp::min(5, lines.len())].join("\n"));
        }
    }
    None
}

#[tauri::command]
fn read_file_content(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Could not read file: {}", e))
}

#[tauri::command]
fn create_transfer_guide(target_agent: String) -> Result<String, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    
    // Collect all session files
    let scan_dirs = [
        home_dir.join(".claude"),
        home_dir.join(".cursor"),
        home_dir.join(".codex"),
        home_dir.join(".config").join("Code"),
    ];
    
    let mut all_files = Vec::new();
    
    for dir in scan_dirs.iter() {
        if dir.exists() {
            collect_session_files(dir, &mut all_files);
        }
    }
    
    // Generate transfer guide
    let mut guide = String::new();
    guide.push_str(&format!("CONTEXT TRANSFER GUIDE\n");
    guide.push_str("=====================\n\n");
    guide.push_str(&format!("Target Agent: {}\n", target_agent.to_uppercase()));
    guide.push_str(&format!("Found {} session files\n\n", all_files.len()));
    guide.push_str("To continue your work with another AI agent:\n\n");
    guide.push_str("1. Copy the relevant session information below\n");
    guide.push_str("2. Start a new conversation in the target agent\n");
    guide.push_str("3. Paste this context to continue where you left off\n\n");
    
    guide.push_str("========================================\n");
    guide.push_str("AVAILABLE SESSION FILES\n");
    guide.push_str("========================================\n\n");
    
    for (i, file_info) in all_files.iter().enumerate() {
        guide.push_str(&format!("## File {}: {}\n", i + 1, file_info.name));
        guide.push_str(&format!("Location: {}\n", file_info.path));
        guide.push_str(&format!("Size: {} bytes\n", file_info.size));
        if let Some(summary) = &file_info.summary {
            guide.push_str(&format!("Preview: {}\n", summary));
        }
        guide.push_str("\n---\n\n");
    }
    
    guide.push_str("========================================\n");
    guide.push_str("END OF GUIDE\n");
    guide.push_str("========================================\n");
    
    Ok(guide)
}

fn collect_session_files(dir: &PathBuf, files: &mut Vec<FileInfo>) {
    if !dir.exists() {
        return;
    }
    
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            
            if path.is_dir() {
                collect_session_files(&path, files);
            } else if is_session_file(&path) {
                if let Ok(metadata) = fs::metadata(&path) {
                    let content_preview = read_session_summary(&path);
                    
                    files.push(FileInfo {
                        name: path.file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "unknown".to_string()),
                        path: path.to_string_lossy().to_string(),
                        size: metadata.len(),
                        summary: content_preview,
                    });
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    summary: Option<String>,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_session_directories,
            list_sessions_from_directory,
            read_file_content,
            create_transfer_guide
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
