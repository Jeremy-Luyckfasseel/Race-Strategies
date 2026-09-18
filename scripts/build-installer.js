/**
 * Builds the Windows installer.
 *
 * Exists because two Windows-specific things have to be handled and neither
 * can be expressed in package.json:
 *
 * 1. `CSC_IDENTITY_AUTO_DISCOVERY=false`. Without it electron-builder goes
 *    looking for a signing certificate, which makes it download a code-signing
 *    toolchain containing macOS symlinks. Extracting those on Windows needs a
 *    privilege a normal account does not have, and the build dies. We do not
 *    sign anything, so we tell it not to look. An npm script cannot set an
 *    env var portably (cmd.exe does not take `VAR=x cmd`), hence this file
 *    rather than a one-liner.
 *
 * 2. If it fails anyway, say why in English instead of leaving a 7-Zip stack
 *    trace about libcrypto.dylib.
 *
 * See docs/PACKAGING.md for the branded-executable variant.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
// Run the CLI with this same Node rather than going through npx: a .cmd
// shim cannot be spawned without a shell, and shell quoting on Windows is
// its own adventure.
const cli = join(here, '..', 'node_modules', 'electron-builder', 'cli.js');

const child = spawn(process.execPath, [cli, '--win'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
});

let output = '';
const relay = (stream, to) => {
  stream.on('data', (d) => {
    const text = d.toString();
    output += text;
    to.write(text);
  });
};
relay(child.stdout, process.stdout);
relay(child.stderr, process.stderr);

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\nInstaller written to release/. Hand that .exe to anyone — no Node, no terminal.');
    process.exit(0);
  }

  if (/Cannot create symbolic link|A required privilege is not held/i.test(output)) {
    console.error('\n─────────────────────────────────────────────────────────');
    console.error('Windows would not let the build extract a symlink.');
    console.error('');
    console.error('This happens when electron-builder edits the .exe (icon and');
    console.error('product name) — that step pulls in a toolchain containing');
    console.error('macOS symlinks, which Windows only allows with Developer');
    console.error('Mode on.');
    console.error('');
    console.error('Fix: Settings → System → For developers → Developer Mode = On,');
    console.error('then run this again. See docs/PACKAGING.md.');
    console.error('─────────────────────────────────────────────────────────');
  }
  process.exit(code ?? 1);
});
