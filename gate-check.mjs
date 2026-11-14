// Gate self-check for token-radar-02. Run from ~/workspace/makefun-token-radar-02:
//   node gate-check.mjs
// Exit 0 = all pass, 1 = any fail.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const board = JSON.parse(readFileSync('out/board.json', 'utf8'));
const dossier = JSON.parse(readFileSync('out/dossier.json', 'utf8'));
const dataJs = readFileSync('out/data.js', 'utf8');
const rows = board.rows;
let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

check('row count is 226', rows.length === 226, rows.length + ' rows');
// board.json rows are lean; the watchlist flag lives in data.js (dashboard data).
const wlTrue = (dataJs.match(/"watchlist":true/g) || []).length;
const wlFalse = (dataJs.match(/"watchlist":false/g) || []).length;
check('watchlist coverage 40/40', wlTrue === 40 && wlTrue + wlFalse === 226, wlTrue + ' true / ' + wlFalse + ' false');
let seq = true;
let mono = true;
for (let i = 0; i < rows.length; i++) {
  if (rows[i].rank !== i + 1) seq = false;
  if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd + 1e-6) mono = false;
}
check('ranks 1..226 sequential', seq);
check('implied value non-increasing by rank', mono);
let stepsOk = true;
let stepsBad = 0;
for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length !== 6) { stepsOk = false; stepsBad++; continue; }
  for (const s of r.farm_steps) {
    if (typeof s !== 'string' || s.length < 20 || s.length > 600) { stepsOk = false; stepsBad++; }
  }
}
check('farm steps: 6 per row, each 20..600 chars', stepsOk, stepsBad + ' bad steps');
const velOk = rows.every((r) => r.velocity >= 0 && r.velocity <= 100 && r.tge_pct >= 0 && r.tge_pct <= 100);
check('velocity and TGE clock pct in 0..100', velOk);
const dossierBytes = statSync('out/dossier.json').size;
check('dossier.json <= 1.5 MiB', dossierBytes <= 1572864, dossierBytes + ' B');
check('dossier text <= 65536 chars', dossier.text.length <= 65536, dossier.text.length + ' chars');
const shots = dossier.images || [];
let shotsOk = shots.length === 3;
let shotDetail = '';
for (const s of shots) {
  try {
    const buf = readFileSync('screenshots/' + s.name);
    if (buf.length > 524288) shotsOk = false;
    if (createHash('sha256').update(buf).digest('hex') !== s.sha256) shotsOk = false;
    shotDetail += s.name + ' ' + buf.length + 'B sha-ok; ';
  } catch { shotsOk = false; }
}
check('3 screenshots, each <= 512 KiB, sha256 matches dossier', shotsOk, shotDetail.trim());
const velRange = [Math.min(...rows.map((r) => r.velocity)), Math.max(...rows.map((r) => r.velocity))];
console.log('INFO  rank 1: ' + rows[0].name + ', implied $' + rows[0].implied_value_usd.toLocaleString('en-US') + ', velocity ' + rows[0].velocity);
console.log('INFO  velocity range ' + velRange[0] + '..' + velRange[1] + '; dossier ' + dossierBytes + ' B');
process.exit(fails ? 1 : 0);
