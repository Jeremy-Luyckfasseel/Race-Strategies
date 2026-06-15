/**
 * Electron main process (Phase 3, Task 3.2).
 *
 * This is the reason Electron was chosen (DECISION 1): it runs the EXISTING Node
 * relay (`server/telemetry-server.js`) directly — UDP + Salsa20 + WebSocket — and
 * loads the built Vite UI, bundling both into one installable app so a
 * non-technical user needs no Node, npm, or terminal.
 *
 * CommonJS (.cjs) on purpose: package.json is `"type": "module"`, and an ESM
 * Electron main entry is still fiddly across versions. The RELAY stays ESM and is
 * run via a forked Node process (below).
 */

const { app, BrowserWindow } = require('electron');
const { fork } = require('child_process');
const path = require('path');

let win = null;
let relay = null;

/**
 * Resolve the relay script path. When packaged we keep `server/**` (and `ws`)
 * unpacked from the asar (see electron-builder `asarUnpack` in package.json), so
 * the forked Node process can read them and resolve `ws` from node_modules.
 */
function relayScriptPath() {
  const inAsar = path.join(__dirname, '..', 'server', 'telemetry-server.js');
  return app.isPackaged ? inAsar.replace('app.asar', 'app.asar.unpacked') : inAsar;
}

function startRelay() {
  const script = relayScriptPath();
  // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain Node,
  // so the relay's dgram / dns / ws imports work without a separate Node install.
  relay = fork(script, [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  relay.stdout?.on('data', (d) => console.log(`[relay] ${d}`.trimEnd()));
  relay.stderr?.on('data', (d) => console.error(`[relay] ${d}`.trimEnd()));
  relay.on('exit', (code) => console.log(`[relay] exited with code ${code}`));
}

function stopRelay() {
  if (relay && !relay.killed) {
    relay.kill();
    relay = null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#06080F',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev: load the Vite dev server when its URL is provided; otherwise load the
  // built files. Production always loads dist/index.html.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  startRelay();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Standard Windows/Linux behaviour: quit when all windows close.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopRelay);
app.on('will-quit', stopRelay);
