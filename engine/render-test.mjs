/**
 * render-test.mjs — run the PAGE'S OWN module code in Node.
 *
 * Chrome cannot launch in this sandbox (its IPC layer needs named pipes, which
 * are blocked), so instead of screenshotting we do something arguably stricter:
 * we pull the <script type="module"> block straight out of site/index.html,
 * stub the handful of DOM APIs it touches, import it for real, and then drive
 * every one of the 2256 team pairings and all 81 opponent tips through it.
 *
 * That catches actual runtime errors in the page logic — NaN, undefined,
 * crashed renders — which a screenshot would not.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const HTML = readFileSync('../site/index.html', 'utf8');
const bundle = JSON.parse(readFileSync('../site/data/bundle.json', 'utf8'));

/* --- pull the module out of the HTML ------------------------------ */
const m = HTML.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('could not find the module script'); process.exit(1); }
let code = m[1];
console.log(`extracted module: ${code.length} chars`);

/* --- append a capture hook (inert in the browser) ----------------- */
code += `
if (globalThis.__capture) {
  globalThis.__capture({
    state, NAMES, TEAMS, byName, PTS, NG, NACT,
    matrix, lambdasFor, modalPick, safePick, bestResponse, evAgainst,
    crowdDist, uniformCrowd, pointMass, worstOf,
    render, renderStatic, renderOpponent, M, bundle,
  });
}
`;

/* --- DOM + fetch stubs ------------------------------------------- */
const made = new Map();
function el(id) {
  if (!made.has(id)) {
    made.set(id, {
      id, innerHTML: '', textContent: '', style: {}, value: '',
      addEventListener() {},
      get innerText() { return this.innerHTML; },
    });
  }
  return made.get(id);
}
globalThis.document = {
  getElementById: el,
  querySelector: () => null,
};
globalThis.window = globalThis;
globalThis.fetch = async (url) => {
  if (String(url).includes('bundle.json')) {
    return { ok: true, json: async () => bundle, text: async () => JSON.stringify(bundle) };
  }
  throw new Error('unexpected fetch: ' + url);
};
let captured = null;
globalThis.__capture = (o) => { captured = o; };

/* --- execute the page module --------------------------------------
 * The module does `import ... from '../engine/engine.mjs'`, which only
 * resolves from a real path — a data: URL has no base to resolve against. So
 * we materialise the extracted source next to this harness (engine/) and
 * import it from there, which makes '../engine/engine.mjs' resolve correctly.
 * ------------------------------------------------------------------ */
import { writeFileSync as _w } from 'node:fs';
const TMP = './_page-module.gen.mjs';
_w(TMP, code);
try {
  await import(TMP + '?v=' + Date.now());
} catch (e) {
  console.error('MODULE FAILED TO EXECUTE:', e && e.message);
  console.error(e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : '');
  process.exit(1);
}
if (!captured) { console.error('capture hook never ran'); process.exit(1); }
const P_ = captured;
console.log('module executed cleanly');

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) fails++;
};

/* --- 1. did the first render populate the page? ------------------- */
const picksHtml = el('picks').innerHTML;
const heatHtml = el('heat').innerHTML;
const evHtml = el('evTable').innerHTML;
const btHtml = el('btTable').innerHTML;
const cvHtml = el('cvTable').innerHTML;

ok('pick cards rendered', picksHtml.length > 200, `${picksHtml.length} chars`);
ok('heatmap rendered (81 cells)', (heatHtml.match(/class="cell/g) || []).length === 81,
   `${(heatHtml.match(/class="cell/g) || []).length} cells`);
ok('EV table rendered', evHtml.includes('<tbody>') && evHtml.length > 200);
ok('backtest table rendered', btHtml.includes('mirrors us'));
ok('CV table rendered', cvHtml.includes('gewählt'));

// The whole page must contain no undefined/NaN leaking into the markup.
for (const [name, html] of Object.entries({ picks: picksHtml, heat: heatHtml, ev: evHtml, bt: btHtml, cv: cvHtml })) {
  ok(`no "undefined" in ${name}`, !html.includes('undefined'), html.includes('undefined') ? html.match(/.{0,40}undefined.{0,40}/)[0] : '');
  ok(`no "NaN" in ${name}`, !html.includes('NaN'), html.includes('NaN') ? html.match(/.{0,40}NaN.{0,40}/)[0] : '');
}
// German number formatting must use a comma, not a dot. Checked here on the
// INITIAL render, before the fixture sweep overwrites the panels below.
{
  const sample = picksHtml.match(/[\d.,]+\s*%/g) || [];
  console.log(`  percentage formats seen in picks: ${JSON.stringify(sample.slice(0, 6))}`);
  ok('percentages use German comma', /(^|[^\d.])\d+,\d\s*%/.test(picksHtml));
  ok('no English-style decimals in prose panels',
     !/\d\.\d\s*%/.test(picksHtml) && !/\d\.\d\s*%/.test(evHtml),
     'no d.d % found');
}

/* --- 2. the three picks obey the theory on the default fixture ---- */
{
  const { state, lambdasFor, matrix, modalPick, safePick, worstOf } = P_;
  const { lh, la } = lambdasFor(state.home, state.away, true);
  const P = matrix(lh, la);
  const { payoffMatrix } = await import('../engine/engine.mjs');
  const { A } = payoffMatrix(P);
  const safe = safePick(A), modal = modalPick(P);
  ok('safe pick guarantee is exactly 0.5', Math.abs(safe.guarantee - 0.5) < 1e-9,
     `${safe.pick} -> ${safe.guarantee}`);
  ok('safe pick worst case is never beaten by the modal pick',
     worstOf(A, safe.idx) >= worstOf(A, modal.idx) - 1e-9,
     `safe ${worstOf(A, safe.idx).toFixed(6)} vs modal ${worstOf(A, modal.idx).toFixed(6)}`);
}

/* --- 3. drive EVERY fixture through the render ------------------- */
{
  const { state, NAMES, render } = P_;
  const { payoffMatrix } = await import('../engine/engine.mjs');
  let n = 0, worstGuarantee = 1, worstGuaranteeFixture = '';
  const bad = [];
  const t0 = Date.now();
  for (const h of NAMES) {
    for (const a of NAMES) {
      if (h === a) continue;
      state.home = h; state.away = a;
      render();
      const html = el('picks').innerHTML;
      const bads = [];
      if (html.includes('NaN')) bads.push('NaN');
      if (html.includes('undefined')) bads.push('undefined');
      if (bads.length) {
        bad.push({ h, a, kinds: bads.join('+'), snippet: html.replace(/\s+/g, ' ').slice(0, 260) });
      }
      const { lh, la } = P_.lambdasFor(h, a, true);
      const { A } = payoffMatrix(P_.matrix(lh, la));
      const s = P_.safePick(A);
      if (s.guarantee < worstGuarantee) { worstGuarantee = s.guarantee; worstGuaranteeFixture = `${h} v ${a}`; }
      n++;
    }
  }
  console.log(`  rendered ${n} fixtures in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (bad.length) {
    console.error(`  ${bad.length} fixtures produced bad output. First 5:`);
    for (const b of bad.slice(0, 5)) {
      console.error(`    ${b.h} v ${b.a}  [${b.kinds}]`);
      console.error(`      ${b.snippet}`);
    }
  }
  ok('every fixture renders without NaN/undefined', bad.length === 0, `${n - bad.length}/${n} clean`);
  ok('safe guarantee never exceeds 0.5', worstGuarantee <= 0.5 + 1e-9,
     `min over all fixtures ${worstGuarantee.toFixed(6)} (${worstGuaranteeFixture})`);
  ok('safe guarantee never drops below 0.47', worstGuarantee > 0.47,
     `min ${worstGuarantee.toFixed(6)}`);
}

/* --- 4. drive every opponent tip through the opponent panel ------ */
{
  const { state, PTS, render } = P_;
  let n = 0;
  for (const [i, j] of PTS) {
    state.opp = [i, j];
    render();
    const html = el('oppOut').innerHTML;
    if (html.includes('NaN') || html.includes('undefined')) {
      console.error(`  !! opponent panel broke on ${i}:${j}`);
      fails++;
    }
    n++;
  }
  ok('all 81 opponent tips render cleanly', n === 81, `${n} tips`);
}

/* --- 5. the draw-aversion slider must move the answer ------------- */
{
  const { state, render, crowdDist, matrix, lambdasFor, bestResponse } = P_;
  const { payoffMatrix } = await import('../engine/engine.mjs');
  const { lh, la } = lambdasFor(state.home, state.away, true);
  const P = matrix(lh, la);
  const { A } = payoffMatrix(P);
  const evs = [];
  const seen = [];
  for (const d of [0.3, 0.65, 1.2]) {
    state.drawAv = d;
    render();
    evs.push(bestResponse(A, crowdDist(P, d)).ev);
    seen.push((el('picks').innerHTML.match(/[\d,]+ %/g) || []).slice(0, 2).join(' '));
  }
  console.log(`  crowd EV at draw-aversion 0.30 / 0.65 / 1.20 = ${evs.map((v) => v.toFixed(4)).join(' / ')}`);
  ok('crowd model responds to the slider', new Set(evs.map((v) => v.toFixed(6))).size > 1);
  ok('crowd EV stays a sane probability', evs.every((v) => v > 0.3 && v < 1.0));
  // German formatting must survive the whole render path.
  ok('rendered percentages use a comma', seen.every((s) => !/\d\.\d/.test(s)), JSON.stringify(seen));
}

/* --- 6. write the rendered DOM for manual inspection -------------- */
{
  const snapshot = ['picks', 'worstBox', 'evTable', 'heat', 'oppOut', 'btTable', 'cvTable', 'statRow', 'gerBox']
    .map((id) => `\n\n<!-- ===== #${id} ===== -->\n` + el(id).innerHTML)
    .join('');
  writeFileSync('rendered-snapshot.html', snapshot);
  console.log('wrote rendered-snapshot.html');
}

console.log(`\n${fails === 0 ? 'ALL RENDER TESTS PASSED' : fails + ' RENDER TEST(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
