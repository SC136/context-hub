const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        titleBarStyle: 'default',
        frame: true,
    });

    console.log('Context Hub App Starting...');
    console.log('Platform:', process.platform);
    console.log('Home Directory:', process.env.HOME || process.env.USERPROFILE);
    console.log('Loading index.html...');
    
    mainWindow.loadFile('index.html');
    
    // Open DevTools for debugging (comment out in production)
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// File system access functions
ipcMain.handle('scan-directories', async () => {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    
    const paths = [
        { agent: 'Claude Code', path: path.join(homeDir, '.claude', 'projects') },
        { agent: 'Codex', path: path.join(homeDir, '.codex', 'sessions') },
        { agent: 'Cursor', path: path.join(homeDir, '.cursor', 'workspaceHistory') },
        { agent: 'VSCode', path: path.join(homeDir, '.config', 'Code', 'User', 'globalStorage') },
        { agent: 'Zed', path: path.join(homeDir, '.local', 'share', 'zed') },
        { agent: 'OpenCode', path: path.join(homeDir, '.opencode') },
        { agent: 'Trae', path: path.join(homeDir, '.trae') },
        { agent: 'Antigravity', path: path.join(homeDir, '.antigravity') },
        { agent: 'Kiro', path: path.join(homeDir, '.kiro') },
        { agent: 'FreeBuff', path: path.join(homeDir, '.freebuff') },
        { agent: 'ZCode', path: path.join(homeDir, '.zcode') },
    ];

    return await Promise.all(paths.map(async (p) => {
        try {
            const exists = fs.existsSync(p.path);
            let count = 0;
            if (exists) {
                count = await scanRecursive(p.path);
            }
            return { ...p, exists, count };
        } catch {
            return { ...p, exists: false, count: 0 };
        }
    }));
});

async function scanRecursive(dir) {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                count++; // Count directories as potential sessions
                count += await scanRecursive(fullPath);
            } else if (isSessionFile(entry.name)) {
                count++;
            }
        }
    } catch (err) {
        console.error(`Error scanning ${dir}:`, err.message);
    }
    return count;
}

function isSessionFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.json', '.txt', '.md'].includes(ext);
}

ipcMain.handle('list-files', async (event, dir) => {
    const files = [];
    
    async function scanDirectory(currentDir, sourceAgent) {
        if (!fs.existsSync(currentDir)) return;
        
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            
            if (entry.isDirectory()) {
                const nameLower = entry.name.toLowerCase();
                if (nameLower.includes('session') || 
                    nameLower.includes('chat') || 
                    nameLower.includes('history') ||
                    nameLower.includes('workspace')) {
                    
                    try {
                        const stats = fs.statSync(fullPath);
                        files.push({
                            id: `${fullPath}-${Date.now()}`,
                            name: entry.name,
                            path: fullPath,
                            type: 'folder',
                            modified: stats.mtime,
                            size: 0,
                            source: sourceAgent
                        });
                        await scanDirectory(fullPath, sourceAgent);
                    } catch {}
                } else {
                    await scanDirectory(fullPath, sourceAgent);
                }
            } else if (entry.isFile() && isSessionFile(entry.name)) {
                try {
                    const stats = fs.statSync(fullPath);
                    let summary = '';
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        if (path.extname(fullPath).toLowerCase() === '.json') {
                            try {
                                const json = JSON.parse(content);
                                summary = json.summary || json.title || String(content).substring(0, 100);
                            } catch {}
                        } else {
                            summary = content.substring(0, 200);
                        }
                    } catch {}
                    
                    files.push({
                        id: `${fullPath}-${Date.now()}`,
                        name: entry.name.replace(/\.(json|txt|md)$/, ''),
                        path: fullPath,
                        type: 'file',
                        modified: stats.mtime,
                        size: stats.size,
                        summary,
                        source: sourceAgent
                    });
                } catch (err) {
                    console.error(`Error reading ${fullPath}:`, err.message);
                }
            }
        }
    }
    
    // Determine source agent from path
    const agent = guessAgentFromPath(dir);
    await scanDirectory(dir, agent);
    
    // Sort by modified date
    files.sort((a, b) => b.modified - a.modified);
    
    return files;
});

function guessAgentFromPath(path) {
    const lower = path.toLowerCase();
    if (lower.includes('.claude')) return 'Claude Code';
    if (lower.includes('.codex')) return 'Codex';
    if (lower.includes('.cursor')) return 'Cursor';
    if (lower.includes('.vscode')) return 'VSCode';
    if (lower.includes('.zed')) return 'Zed';
    if (lower.includes('.opencode')) return 'OpenCode';
    if (lower.includes('.trae')) return 'Trae';
    if (lower.includes('.antigravity')) return 'Antigravity';
    if (lower.includes('.kiro')) return 'Kiro';
    if (lower.includes('.freebuff')) return 'FreeBuff';
    if (lower.includes('.zcode')) return 'ZCode';
    return 'Unknown';
}

ipcMain.handle('read-file', async (event, filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, content };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-content', async (event, options) => {
    return {
        title: 'Context Hub - Demo Mode',
        message: 'This is running in browser mode. For full functionality with real file access, run with Electron.\n\nRun with: electron .\nOr build installer with: npm run package'
    };
});
