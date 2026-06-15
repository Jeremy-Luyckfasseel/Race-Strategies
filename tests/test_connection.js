/**
 * Tests for the pure connection helpers in src/logic/connection.js (Phase 3, Task 3.1).
 * Run with: node tests/test_connection.js
 */

import { backoffDelay, isSessionActive, pickAutoConnectIp, RECONNECT_CONFIG } from '../src/logic/connection.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

section('backoffDelay — exponential, capped (DECISION 4)');
{
  assert('attempt 0 → 1s', backoffDelay(0) === 1000);
  assert('attempt 1 → 2s', backoffDelay(1) === 2000);
  assert('attempt 2 → 4s', backoffDelay(2) === 4000);
  assert('attempt 3 → 8s', backoffDelay(3) === 8000);
  assert('attempt 4 capped at 15s', backoffDelay(4) === RECONNECT_CONFIG.capMs);
  assert('large attempt stays capped', backoffDelay(20) === RECONNECT_CONFIG.capMs);
  assert('negative attempt → base', backoffDelay(-3) === 1000);
}

section('isSessionActive — onTrack AND moving (DECISION 5)');
{
  assert('onTrack + moving → active', isSessionActive({ onTrack: true, speedKmh: 120 }) === true);
  assert('onTrack but stationary → not active', isSessionActive({ onTrack: true, speedKmh: 2 }) === false);
  assert('moving but off track (menu) → not active', isSessionActive({ onTrack: false, speedKmh: 120 }) === false);
  assert('paused → not active', isSessionActive({ onTrack: true, speedKmh: 120, paused: true }) === false);
  assert('null packet → not active', isSessionActive(null) === false);
  assert('boundary speed == 5 → not active', isSessionActive({ onTrack: true, speedKmh: 5 }) === false);
}

section('pickAutoConnectIp — auto-pick only a single PS5 (DECISION 4)');
{
  assert('single result → that ip', pickAutoConnectIp([{ ip: '192.168.1.50' }]) === '192.168.1.50');
  assert('multiple results → null (ask user)', pickAutoConnectIp([{ ip: '192.168.1.50' }, { ip: '192.168.1.51' }]) === null);
  assert('empty → null', pickAutoConnectIp([]) === null);
  assert('non-array → null', pickAutoConnectIp(undefined) === null);
  assert('ignores blank ips', pickAutoConnectIp([{ ip: '' }, { ip: '192.168.1.9' }]) === '192.168.1.9');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
