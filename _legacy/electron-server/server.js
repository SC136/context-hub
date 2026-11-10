const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Helper function to execute ctx commands
function executeCtxCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error.message);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

// Get all sessions from ctx
app.get('/api/sessions', async (req, res) => {
    try {
        // Try to get sessions using ctx command
        const result = await executeCtxCommand('ctx list --json');
        res.json(JSON.parse(result));
    } catch (error) {
        // Fallback: check for existing session files
        const fallbackSessions = [];
        
        // Common paths where AI tools store sessions
        const possiblePaths = [
            '~/.claude/projects/',
            '~/.codex/sessions/',
            '~/.cursor/sessions/',
            './sessions/'
        ];
        
        possiblePaths.forEach(basePath => {
            const fullBasePath = path.join(process.env.HOME || process.env.USERPROFILE, basePath.substring(2));
            if (fs.existsSync(fullBasePath)) {
                const files = fs.readdirSync(fullBasePath);
                files.forEach(file => {
                    const filePath = path.join(fullBasePath, file);
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        let data;
                        try {
                            data = JSON.parse(content);
                        } catch {
                            data = { rawContent: content };
                        }
                        
                        fallbackSessions.push({
                            id: Date.now().toString(),
                            title: file.replace('.json', ''),
                            agent: 'unknown',
                            project: path.basename(path.dirname(filePath)),
                            date: new Date().toISOString(),
                            status: 'active',
                            summary: data.summary || 'Session data loaded',
                            filesChanged: 1,
                            commits: 0,
                            tokenUsage: 0
                        });
                    } catch (err) {
                        console.error(`Error reading ${file}:`, err);
                    }
                });
            }
        });
        
        res.json(fallbackSessions);
    }
});

// Get sessions with filters
app.get('/api/sessions/filtered', async (req, res) => {
    try {
        let { agent, date, search } = req.query;
        
        let command = 'ctx list';
        if (agent) command += ` --agent=${agent}`;
        if (date) command += ` --since=${date}`;
        if (search) command += ` --search="${search}"`;
        
        const result = await executeCtxCommand(command + ' --json');
        res.json(JSON.parse(result));
    } catch (error) {
        // Fallback implementation
        res.json([]);
    }
});

// Generate transfer prompt for another agent
app.post('/api/generate-transfer', async (req, res) => {
    try {
        const { sessionId, targetAgent } = req.body;
        
        if (!sessionId || !targetAgent) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        let command = `ctx transfer --to=${targetAgent} --session=${sessionId}`;
        const result = await executeCtxCommand(command);
        
        res.json({ 
            success: true, 
            transferPrompt: result,
            message: `Transfer prompt generated for ${targetAgent}`
        });
    } catch (error) {
        // Fallback: Create a transfer instruction file
        res.json({
            success: true,
            transferPrompt: `CONTEXT TRANSFER INSTRUCTION\n\nTarget Agent: ${targetAgent}\nSource Session: ${sessionId}\n\nContinue the current task following the context transferred from the previous agent.\n\nSee ai-context-transfer-session.md for full details.`,
            message: 'Manual transfer instructions generated'
        });
    }
});

// Export session data
app.post('/api/export-session', async (req, res) => {
    try {
        const { sessionId, format } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({ error: 'Missing sessionId' });
        }
        
        let command = `ctx export --session=${sessionId}`;
        if (format) command += ` --format=${format}`;
        
        const result = await executeCtxCommand(command);
        
        res.json({
            success: true,
            data: result,
            format: format || 'json'
        });
    } catch (error) {
        res.json({
            success: false,
            error: 'Export failed'
        });
    }
});

// Initialize ctx for a new project
app.post('/api/init-project', async (req, res) => {
    try {
        const { projectName } = req.body;
        
        if (!projectName) {
            return res.status(400).json({ error: 'Missing projectName' });
        }
        
        const result = await executeCtxCommand(`ctx init`);
        
        res.json({
            success: true,
            message: `Project initialized: ${projectName}`,
            output: result
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Check if ctx is installed
app.get('/api/check-ctx', async (req, res) => {
    try {
        const result = await executeCtxCommand('ctx --version');
        res.json({
            installed: true,
            version: result
        });
    } catch (error) {
        res.json({
            installed: false,
            error: error.message
        });
    }
});

// Add sample session (for testing)
app.post('/api/add-sample', async (req, res) => {
    const sampleSession = {
        id: Date.now().toString(),
        title: req.body.title || 'Implement user authentication feature',
        agent: req.body.agent || 'claude-code',
        project: req.body.project || 'my-awesome-project',
        date: new Date().toISOString(),
        status: 'active',
        summary: req.body.summary || 'Working on JWT-based auth system with refresh tokens',
        filesChanged: req.body.filesChanged || 5,
        commits: req.body.commits || 3,
        tokenUsage: req.body.tokenUsage || 15420
    };
    
    res.json({
        success: true,
        session: sampleSession
    });
});

app.listen(PORT, () => {
    console.log(`AI Context Transfer Dashboard running at http://localhost:${PORT}`);
    console.log(`Open this URL in your browser to access the dashboard.`);
});
