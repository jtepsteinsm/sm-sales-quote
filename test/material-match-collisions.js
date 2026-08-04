// ─────────────────────────────────────────────────────────────────────────────
// Material-name normalization collision test.
// pmNorm once flattened every symbol, so "3/8\"" (fraction) collided with
// "3\" - 8\"" (range) and "2' - 4'" (feet) with "24\"" (inches) — picking
// 3" - 8" Crushed Rock priced 3/8" Crushed Rock (Jason, 2026-08-04).
// Pulls the REAL pmNorm out of index.html and asserts:
//   1. the only norm collisions across price-matrix.json are the INTENDED
//      Class Roman-numeral ↔ digit merges;
//   2. the specific grammar distinctions hold;
//   3. legacy spellings still unify where they should.
// Run from anywhere inside the repo: node test/material-match-collisions.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const MATRIX = JSON.parse(fs.readFileSync(path.join(REPO, 'price-matrix.json'), 'utf8')).matrix;

const i = SRC.indexOf('function pmNorm(');
let d = 0, j = SRC.indexOf('{', i);
for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) break; } }
eval(SRC.slice(i, j + 1));

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fail++; };

// 1. collision sweep — only Class-family merges allowed
const by = {};
[...new Set(MATRIX.map(r => r.m))].forEach(n => { (by[pmNorm(n)] = by[pmNorm(n)] || []).push(n); });
const collisions = Object.values(by).filter(v => v.length > 1);
collisions.forEach(v => console.log('  merge: ' + v.map(x => JSON.stringify(x)).join(' <-> ')));
ok(collisions.every(v => v.every(x => /\bclass\b/i.test(x))), 'only Class Roman/digit merges collide');

// 2. grammar distinctions
ok(pmNorm('3" - 8" Crushed Rock') !== pmNorm('3/8" Crushed Rock'), 'range 3"-8" ≠ fraction 3/8"');
ok(pmNorm("2' - 4' Rip Rap") !== pmNorm('24" Rip Rap'), "feet 2'-4' ≠ inches 24\"");
ok(pmNorm('3/4" Gravel') !== pmNorm('3" - 4" Gravel'), 'range 3"-4" ≠ fraction 3/4"');

// 3. intended unifications survive
ok(pmNorm('3"-8+" Crushed Rock') === pmNorm('3" - 8" Crushed Rock'), 'legacy 3"-8+" == range 3"-8"');
ok(pmNorm('Class II Rip Rap') === pmNorm('Class 2 Rip Rap'), 'Class II == Class 2');
ok(pmNorm('3/4"  50-50 Mix (C-Mix)') === pmNorm('3/4" 50-50 Mix (C-Mix)'), 'whitespace-insensitive');
ok(pmNorm('1 1/2" Crushed Rock') === pmNorm('1 1/2” Crushed Rock'), 'curly vs straight quotes');

console.log(fail === 0 ? '### ALL ASSERTIONS PASSED ###' : '### ' + fail + ' FAILED ###');
process.exit(fail ? 1 : 0);
