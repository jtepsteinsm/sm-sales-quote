// ─────────────────────────────────────────────────────────────────────────────
// Group 5 harness: per-truck haul multipliers.
// Pulls the REAL calcHaulRate + constants out of the repo's index.html
// (post-change) and the REAL pre-Phase-2 calcHaulRate out of
// `git show origin/master:index.html`, then asserts the Transfer / no-truck
// baseline is byte-identical.
//
// Run from anywhere inside the repo:  node test/group5-haul-multiplier-harness.js
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const REPO = path.resolve(__dirname, '..');
const NEW = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OLD = execSync('git show origin/master:index.html', { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

function grab(src, re, what) { const m = src.match(re); if (!m) throw new Error('not found: ' + what); return m[0]; }

// Shared DOM-free stubs: fixed zone/access/job-type so both versions see the
// same inputs. Z2 (1.15) + canyon (+0.10) is a deliberately non-trivial case.
const STUBS = `
  let truck = null;
  let ZONE = "Z2", ACCESS = "canyon", JOBTYPE = "standard";
  const ZONE_MULTIPLIERS = { Z0:{mult:1.00}, Z1:{mult:1.05}, Z2:{mult:1.15}, Z3:{mult:1.30}, Z4:{mult:1.40}, Z5:{mult:1.55} };
  function getZoneMult(){ return ZONE_MULTIPLIERS[ZONE].mult; }
  function getAccessMod(){ let mod=0;
    if(ACCESS==="canyon")mod+=0.10; if(ACCESS==="tight")mod+=0.05;
    if(ACCESS==="commercial")mod-=0.05; if(ACCESS==="no_far")mod+=0.10;
    if(JOBTYPE==="repeat")mod-=0.05; if(JOBTYPE==="rush")mod+=0.10; return mod; }
  function getTransferFee(){ return ACCESS==="no_far" ? 1.75 : 0; }
`;

// ---- OLD (origin/master, pre-Phase-2) --------------------------------------
const oldSrc = STUBS + grab(OLD, /function calcHaulRate\(miles\) \{[\s\S]*?\n\}/, 'old calcHaulRate');
const OLDMOD = {}; (new Function('M', oldSrc + '\nM.calcHaulRate=calcHaulRate;'))(OLDMOD);

// ---- NEW (phase2) ----------------------------------------------------------
const newSrc = STUBS
  + grab(NEW, /const TRUCK_RATES = \{[^\n]*\n/, 'TRUCK_RATES')
  + grab(NEW, /const TRUCK_HAUL_MULT = \{[\s\S]*?\n\};/, 'TRUCK_HAUL_MULT') + '\n'
  + grab(NEW, /const TRUCK_ALIAS = \{[^\n]*\n/, 'TRUCK_ALIAS')
  + grab(NEW, /function truckKey\(t\) \{[^\n]*\n/, 'truckKey')
  + grab(NEW, /function truckHaulMult\(t\) \{[\s\S]*?\n\}/, 'truckHaulMult') + '\n'
  + 'const DEFAULT_TRUCK_CAP = 25;\n'
  + grab(NEW, /function truckCap\(t\) \{[^\n]*\n/, 'truckCap')
  + grab(NEW, /function calcHaulRate\(miles, truckType\) \{[\s\S]*?\n\}/, 'new calcHaulRate');
const N = {};
(new Function('M', newSrc + '\nM.calcHaulRate=calcHaulRate;M.truckCap=truckCap;M.truckHaulMult=truckHaulMult;M.setTruck=function(t){truck=t;};M.MULT=TRUCK_HAUL_MULT;M.setEnv=function(z,a,j){ZONE=z;ACCESS=a;JOBTYPE=j;};'))(N);

const MILES  = [0, -3, 0.5, 1, 5, 12.4, 25, 47.3, 90, 150, 312.7];
const TRUCKS = [
  ['(none selected)', null,  1.00],
  ['Transfer',        'tf',  1.00],
  ['Super 10',        's10', 1.29],
  ['Super Tag',       'st',  1.29],
  ['Strong Arm',      'sa',  1.29],
  ['End Dump',        'ed',  1.12],
  ['Bottom Dump',     'bd',  0.95],
  ['10-Wheeler',      'w10', 1.00],
  ['garbage key',     'zzz', 1.00],
];

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('   *** FAIL: ' + msg); } };

console.log('=== 1. multiplier table ===');
for (const [label, key, want] of TRUCKS)
  console.log(`  ${label.padEnd(16)} key=${String(key).padEnd(5)} truckHaulMult=${N.truckHaulMult(key).toFixed(2)}  truckCap=${N.truckCap(key)}`),
  ok(N.truckHaulMult(key) === want, `${label} multiplier ${N.truckHaulMult(key)} != ${want}`);
ok(N.truckCap('w10') === N.truckCap('tf'), '10-Wheeler cap must equal Transfer cap');
ok(N.truckCap('w10') === 25, '10-Wheeler cap must be 25');
console.log(`  10-Wheeler -> Transfer mapping: cap ${N.truckCap('w10')} == ${N.truckCap('tf')}, mult ${N.truckHaulMult('w10').toFixed(2)} == ${N.truckHaulMult('tf').toFixed(2)}  OK`);

console.log('\n=== 2. calcHaulRate($/ton) by truck x miles   [zone Z2 x1.15, access canyon +0.10] ===');
console.log('  miles  ' + TRUCKS.map(t => t[0].slice(0,10).padStart(11)).join(''));
for (const mi of MILES) {
  let line = '  ' + String(mi).padStart(6) + ' ';
  for (const [, key] of TRUCKS) { N.setTruck(null); line += N.calcHaulRate(mi, key).toFixed(2).padStart(11); }
  console.log(line);
}

console.log('\n=== 3. BASELINE BYTE-IDENTITY vs origin/master (pre-Phase-2) ===');
const ENVS = [['Z0','easy','standard'],['Z2','canyon','standard'],['Z5','no_far','rush'],['Z3','commercial','repeat'],['Z4','tight','standard']];
let n = 0;
for (const [z,a,j] of ENVS) {
  N.setEnv(z,a,j);
  // rebuild OLD with the same env
  const O = {};
  (new Function('M', STUBS.replace('"Z2", ACCESS = "canyon", JOBTYPE = "standard"', `"${z}", ACCESS = "${a}", JOBTYPE = "${j}"`)
    + grab(OLD, /function calcHaulRate\(miles\) \{[\s\S]*?\n\}/, 'old') + '\nM.f=calcHaulRate;'))(O);
  for (const mi of MILES) {
    const oldV = O.f(mi);
    for (const [label,key] of [['no truck',null],['Transfer','tf'],['10-Wheeler','w10']]) {
      N.setTruck(key === null ? null : 'tf');
      const newV = N.calcHaulRate(mi, key);
      ok(Object.is(oldV, newV), `${z}/${a}/${j} mi=${mi} ${label}: old ${oldV} != new ${newV}`);
      n++;
    }
    // also exercise the implicit-global-truck path (truckType omitted)
    N.setTruck(null);
    ok(Object.is(oldV, N.calcHaulRate(mi)), `${z}/${a}/${j} mi=${mi} implicit global truck=null: ${oldV} != ${N.calcHaulRate(mi)}`); n++;
    N.setTruck('tf');
    ok(Object.is(oldV, N.calcHaulRate(mi)), `${z}/${a}/${j} mi=${mi} implicit global truck=tf: ${oldV} != ${N.calcHaulRate(mi)}`); n++;
  }
}
console.log(`  ${n} baseline comparisons across ${ENVS.length} zone/access/jobtype combos x ${MILES.length} mileages`);
console.log(`  Transfer, 10-Wheeler, no-truck, and the implicit global-truck path are all Object.is-identical to master.`);

console.log('\n=== 4. rounding: one round, LAST — applied after floor and multiplier ===');
N.setEnv('Z2','canyon','standard');
for (const mi of [12.4, 47.3]) {
  const tfv = N.calcHaulRate(mi, 'tf');
  for (const [label,key,m] of TRUCKS.filter(t=>t[2]!==1.00)) {
    const got = N.calcHaulRate(mi, key);
    const base = (0.2175*mi+2.7)*1.25*1.15 + 0.10;
    const singleRound = Math.round(Math.max(base, 6.00) * m * 100)/100;
    const doubleRound = Math.round(tfv * m * 100)/100;   // the WRONG way: round the transfer rate, then multiply, then round again
    console.log(`  mi=${String(mi).padStart(5)} ${label.padEnd(12)} x${m.toFixed(2)}  got=${got.toFixed(2)}  single-round=${singleRound.toFixed(2)}  (double-round would give ${doubleRound.toFixed(2)}${doubleRound!==singleRound?'  <-- DIFFERS':''})`);
    ok(got === singleRound, `${label} mi=${mi}: not round(max(base,6) * mult)`);
  }
}

console.log('\n=== 5. the $6.00 floor is the minimum TRANSFER rate — it scales with the multiplier ===');
N.setEnv('Z0','commercial','repeat');
for (const mi of [0.5, 1, 3]) {
  const r = TRUCKS.map(([l,k]) => `${l.split(' ')[0]}=${N.calcHaulRate(mi,k).toFixed(2)}`).join('  ');
  console.log(`  mi=${String(mi).padStart(4)}  ${r}`);
  for (const [l,k,m] of TRUCKS) {
    const got = N.calcHaulRate(mi,k);
    // Floor first, then multiply: every truck's minimum is 6.00 × its multiplier
    // (1e-9 tolerance: 6.00*mult is not exactly representable in IEEE-754).
    ok(got >= 6.00 * m - 1e-9, `${l} mi=${mi} rate ${got} fell below its scaled floor ${(6.00*m).toFixed(2)}`);
    // And when the transfer base is below 6.00, the quote IS the scaled floor.
    const base = (0.2175*mi+2.7)*1.25*1.00 - 0.10;
    if (base < 6.00) ok(got === Math.round(6.00 * m * 100)/100, `${l} mi=${mi} floored quote ${got} != round(6.00 x ${m})`);
  }
}

console.log('\n=== 6. miles <= 0 short-circuits to 0 for every truck ===');
for (const mi of [0,-1]) for (const [l,k] of TRUCKS) ok(N.calcHaulRate(mi,k) === 0, `${l} mi=${mi} != 0`);
console.log('  0 and -1 return 0 for all 9 truck keys  OK');

console.log('\n=== 7. why the floor scales (floor first, then multiply) ===');
// The $6.00 floor is not a universal price minimum — it is the minimum
// TRANSFER rate, i.e. the shortest-haul price of the baseline truck the whole
// formula is calibrated on. A Super 10 costs ~29% more to run per ton than a
// Transfer at EVERY distance, including the shortest: flooring after the
// multiplier would quote a near-zero-mile Super 10 at the same $6.00 as a
// Transfer, silently erasing the truck premium exactly where the floor binds.
// Floor-first keeps the premium: min Super 10 = 6.00 x 1.29 = $7.74, min End
// Dump = $6.72, min Bottom Dump = $5.70 (the discount truck is ALLOWED below
// $6.00 — its floor is 95% of the Transfer floor, same as every other rate).
N.setEnv('Z0','commercial','repeat');
function floorLast(mi, m){ const base=(0.2175*mi+2.7)*1.25*1.00-0.10; return Math.max(Math.round(base*m*100)/100, 6.00); }
for (const [mi, key, label] of [[0.001,'s10','Super 10'], [0.001,'ed','End Dump'], [0.001,'bd','Bottom Dump'], [0.001,'tf','Transfer']]) {
  const m = N.truckHaulMult(key);
  const ours = N.calcHaulRate(mi, key), other = floorLast(mi, m);
  console.log(`  mi=${String(mi).padStart(6)} ${label.padEnd(12)} x${m.toFixed(2)}  floor-first(ours)=$${ours.toFixed(2)}   floor-last=$${other.toFixed(2)}   ${ours!==other?'<-- floor-last would erase the truck premium':'same'}`);
}
ok(N.calcHaulRate(0.001,'s10') === 7.74, `0-mile Super 10 must quote $7.74, got ${N.calcHaulRate(0.001,'s10')}`);
console.log('  A 0-mile Super 10 quotes $7.74 — the Transfer minimum scaled by 1.29 — not $6.00.');

console.log('\n' + (fail === 0 ? '### ALL ASSERTIONS PASSED ###' : `### ${fail} ASSERTION(S) FAILED ###`));
process.exit(fail === 0 ? 0 : 1);
