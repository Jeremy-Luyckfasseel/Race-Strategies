/**
 * Comparison CLI (engine-validation, Task 2).
 *
 * Reads ONE recorded session JSON, derives the real-world inputs from it, feeds
 * them into the strategy engine, and prints a plain-language report comparing the
 * engine's predictions against reality — with the numeric error on each metric and
 * a clear per-metric verdict. Pure Node; it does NOT modify the engine.
 *
 * Usage:
 *   node scripts/compare-session.js captures/session-YYYYMMDD-HHMMSS.json
 *   node scripts/compare-session.js <file> --json        # dump the raw report object
 *   node scripts/compare-session.js <file> --out report.txt
 */

import fs from 'fs';
import path from 'path';
import { compareSession, formatReport } from './lib/validation.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

if (!file) {
  console.error('usage: node scripts/compare-session.js <capture.json> [--json] [--out report.txt]');
  process.exit(1);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error(`capture not found: ${abs}`);
  process.exit(1);
}

let capture;
try {
  capture = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
  console.error(`could not parse capture JSON: ${e.message}`);
  process.exit(1);
}

if (!capture.laps || !Array.isArray(capture.laps) || capture.laps.length === 0) {
  console.error('capture has no laps — nothing to validate');
  process.exit(1);
}

const report = compareSession(capture);

if (asJson) {
  // Drop the verbose annotated lap array from the JSON dump for readability.
  const { laps, ...rest } = report;
  void laps;
  console.log(JSON.stringify(rest, null, 2));
} else {
  const text = formatReport(report);
  console.log(text);
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), text);
    console.log(`\n(report written to ${outPath})`);
  }
}
