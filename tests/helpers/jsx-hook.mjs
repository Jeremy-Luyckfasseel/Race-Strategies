/**
 * Node module hook that transpiles .jsx on import, so the UI tests can load
 * the real components instead of a build artefact.
 *
 * Uses esbuild, which is already present as a Vite dependency — no new tool,
 * and the same transform Vite itself applies in dev.
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { transform } from 'esbuild';

/**
 * The app's own imports are extensionless (`from '../logic/teams'`), which
 * Vite resolves and plain Node does not. Fill that in rather than rewriting
 * application source to suit the tests.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.')) {
      for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch { /* try the next candidate */ }
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.jsx')) return nextLoad(url, context);

  const source = await readFile(fileURLToPath(url), 'utf8');
  const { code } = await transform(source, {
    loader: 'jsx',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcefile: url,
  });

  return { format: 'module', source: code, shortCircuit: true };
}
