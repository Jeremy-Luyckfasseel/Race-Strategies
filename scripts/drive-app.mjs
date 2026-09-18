/**
 * Drives the running packaged app through Electron's DevTools protocol:
 * inspect the DOM, click things, and capture real screenshots.
 *
 * Launch the app with --remote-debugging-port=9222 first.
 *   node scripts/drive-app.mjs <command> [args]
 *
 * Commands:
 *   shot <file>        capture the window to a PNG
 *   eval  <js>         evaluate an expression in the page, print the result
 *   click <selector>   click the first match
 *   text  <selector>   print textContent of all matches
 */

import { WebSocket } from 'ws';
import { writeFileSync } from 'fs';

const PORT = process.env.CDP_PORT || 9222;

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target — is the app running with --remote-debugging-port?');
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

let nextId = 1;
function send(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== id) return;
      ws.off('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const evaluate = (ws, expression) =>
  send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

const [command, ...args] = process.argv.slice(2);

const target = await pageTarget();
const ws = await connect(target.webSocketDebuggerUrl);

try {
  if (command === 'shot') {
    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    const file = args[0] || 'shot.png';
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`wrote ${file}`);
  } else if (command === 'eval') {
    const r = await evaluate(ws, args.join(' '));
    console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
  } else if (command === 'click') {
    const sel = args.join(' ');
    const r = await evaluate(ws, `
      (() => { const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return 'NOT FOUND'; el.click(); return 'clicked: ' + el.textContent.trim().slice(0,40); })()`);
    console.log(r.result?.value);
  } else if (command === 'text') {
    const sel = args.join(' ');
    const r = await evaluate(ws, `
      [...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent.trim())`);
    console.log(JSON.stringify(r.result?.value, null, 2));
  } else {
    console.error('commands: shot <file> | eval <js> | click <sel> | text <sel>');
    process.exitCode = 1;
  }
} finally {
  ws.close();
}
