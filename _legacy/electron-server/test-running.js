const { exec } = require('child_process');
const path = require('path');

console.log('========================================');
console.log('  Testing Context Hub Desktop App');
console.log('========================================');
console.log();

// Get current directory
const appDir = __dirname;
console.log('App Directory:', appDir);
console.log();

// Check if Electron is available
try {
    const electronPath = require.resolve('electron');
    console.log('[OK] Electron found at:', electronPath);
} catch (err) {
    console.log('[ERROR] Electron not found!');
    console.log('Run: npm install');
    process.exit(1);
}

console.log();
console.log('Checking required files...');

// Check main files exist
const files = ['main.js', 'index.html', 'package.json'];
let allFilesExist = true;

for (const file of files) {
    const fs = require('fs');
    const exists = fs.existsSync(path.join(appDir, file));
    if (exists) {
        console.log(`[OK] ${file}`);
    } else {
        console.log(`[MISSING] ${file}`);
        allFilesExist = false;
    }
}

console.log();
if (!allFilesExist) {
    console.log('Some files are missing. Cannot start app.');
    process.exit(1);
}

console.log('[OK] All files present');
console.log();

// Read package.json
const packageJson = JSON.parse(require('fs').readFileSync(path.join(appDir, 'package.json'), 'utf-8'));
console.log('App Details:');
console.log('  Name:', packageJson.name);
console.log('  Version:', packageJson.version);
console.log('  Main:', packageJson.main);
console.log();

console.log('========================================');
console.log('  Starting App...');
console.log('========================================');
console.log();
console.log('The desktop window will open now.');
console.log('Look for a window titled "Context Hub"');
console.log();

// Start the app
const child = exec(`node main.js`, {
    cwd: appDir,
    stdio: 'inherit'
});

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\nStopping app...');
    child.kill();
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('\nStopping app...');
    child.kill();
    process.exit();
});
