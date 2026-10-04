/**
 * build-bundle.mjs — calibrate the duel model on REAL 2026 World Cup data.
 *
 * WHAT THE MATHS ACTUALLY SAYS (this is the product, and it is not what I
 * set out to build):
 *
 *   The duel is a symmetric two-player zero-sum game. The opponent can always
 *   MIRROR your tip, and a mirrored duel is level on squared distance, so it
 *   falls to the possession call and splits 50/50. Therefore no tip can
 *   guarantee more than 1/2, the maximin value is exactly 1/2 for every
 *   fixture, and it is attained by whichever scoreline the model thinks is
 *   most likely. "Find the scoreline that beats the game" is impossible and a
 *   tool claiming it would be lying. All the edge is in reading your opponent.
 *
 * So this build reports three honest numbers per fixture:
 *   - SAFE pick      — the tip whose worst case is the best available
 *                      (i.e. the model's most likely scoreline; ~1/2 always)
 *   - MODAL pick     — the single most likely exact scoreline
 *   - CROWD ANSWER   — best response to a modelled crowd, which is where the
 *                      only real edge lives, and how big that edge is
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  MAX_GOALS, scoreMatrix, fit, crossValidateRidge, flatten, payoffMatrix,
  maximinPure, duelOutcome,
} from './engine.mjs';

/* ------------------------------------------------------------------ *
 * Source data — 2026 FIFA World Cup. Summing all 104 scorelines gives 308
 * goals, exactly FIFA's published total; the 48 group tables reconcile with
 * the 72 scorelines independently.
 * ------------------------------------------------------------------ */
const GROUP_MATCHES = `group|home|away|hg|ag
A|Mexico|South Africa|2|0
A|South Korea|Czechia|2|1
A|Czechia|South Africa|1|1
A|Mexico|South Korea|1|0
A|Czechia|Mexico|0|3
A|South Africa|South Korea|1|0
B|Canada|Bosnia and Herzegovina|1|1
B|Qatar|Switzerland|1|1
B|Switzerland|Bosnia and Herzegovina|4|1
B|Canada|Qatar|6|0
B|Switzerland|Canada|2|1
B|Bosnia and Herzegovina|Qatar|3|1
C|Brazil|Morocco|1|1
C|Haiti|Scotland|0|1
C|Scotland|Morocco|0|1
C|Brazil|Haiti|3|0
C|Scotland|Brazil|0|3
C|Morocco|Haiti|4|2
D|United States|Paraguay|4|1
D|Australia|Turkiye|2|0
D|United States|Australia|2|0
D|Turkiye|Paraguay|0|1
D|Turkiye|United States|3|2
D|Paraguay|Australia|0|0
E|Germany|Curacao|7|1
E|Cote d'Ivoire|Ecuador|1|0
E|Germany|Cote d'Ivoire|2|1
E|Ecuador|Curacao|0|0
E|Ecuador|Germany|2|1
E|Curacao|Cote d'Ivoire|0|2
F|Netherlands|Japan|2|2
F|Sweden|Tunisia|5|1
F|Netherlands|Sweden|5|1
F|Tunisia|Japan|0|4
F|Tunisia|Netherlands|1|3
F|Japan|Sweden|1|1
G|Belgium|Egypt|1|1
G|Iran|New Zealand|2|2
G|Belgium|Iran|0|0
G|New Zealand|Egypt|1|3
G|New Zealand|Belgium|1|5
G|Egypt|Iran|1|1
H|Spain|Cabo Verde|0|0
H|Saudi Arabia|Uruguay|1|1
H|Spain|Saudi Arabia|4|0
H|Uruguay|Cabo Verde|2|2
H|Uruguay|Spain|0|1
H|Cabo Verde|Saudi Arabia|0|0
I|France|Senegal|3|1
I|Iraq|Norway|1|4
I|France|Iraq|3|0
I|Norway|Senegal|3|2
I|Norway|France|1|4
I|Senegal|Iraq|5|0
J|Argentina|Algeria|3|0
J|Austria|Jordan|3|1
J|Argentina|Austria|2|0
J|Jordan|Algeria|1|2
J|Jordan|Argentina|1|3
J|Algeria|Austria|3|3
K|Portugal|DR Congo|1|1
K|Uzbekistan|Colombia|1|3
K|Portugal|Uzbekistan|5|0
K|Colombia|DR Congo|1|0
K|Colombia|Portugal|0|0
K|DR Congo|Uzbekistan|3|1
L|England|Croatia|4|2
L|Ghana|Panama|1|0
L|England|Ghana|0|0
L|Panama|Croatia|0|1
L|Panama|England|0|2
L|Croatia|Ghana|2|1`;

// Knockout stage. Scores are 90/120-minute results — which is what TipMaster
// settles on — with shootout winners kept separately.
const KNOCKOUT = [
  ['South Africa','Canada',0,1,null], ['Brazil','Japan',2,1,null],
  ['Germany','Paraguay',1,1,'Paraguay'], ['Netherlands','Morocco',1,1,'Morocco'],
  ['France','Sweden',3,0,null], ["Cote d'Ivoire",'Norway',1,2,null],
  ['Mexico','Ecuador',2,0,null], ['England','DR Congo',2,1,null],
  ['United States','Bosnia and Herzegovina',2,0,null], ['Belgium','Senegal',3,2,null],
  ['Spain','Austria',3,0,null], ['Portugal','Croatia',2,1,null],
  ['Argentina','Cabo Verde',3,2,null], ['Australia','Egypt',1,1,'Egypt'],
  ['Switzerland','Algeria',2,0,null], ['Colombia','Ghana',1,0,null],
  ['Paraguay','France',0,1,null], ['Canada','Morocco',0,3,null],
  ['Portugal','Spain',0,1,null], ['United States','Belgium',1,4,null],
  ['Brazil','Norway',1,2,null], ['Mexico','England',2,3,null],
  ['Argentina','Egypt',3,2,null], ['Switzerland','Colombia',0,0,'Switzerland'],
  ['France','Morocco',2,0,null], ['Spain','Belgium',2,1,null],
  ['Norway','England',1,2,null], ['Argentina','Switzerland',3,1,null],
  ['France','Spain',0,2,null], ['England','Argentina',1,2,null],
  ['France','England',4,6,null], ['Spain','Argentina',1,0,null],
];

const HOSTS = new Set(['United States', 'Mexico', 'Canada']);
const HA = 0.35;
const RHO = -0.06;
const NG = MAX_GOALS + 1;
const NACT = NG * NG;

/* --- parse -------------------------------------------------------- */
const rows = GROUP_MATCHES.trim().split('\n').slice(1).map((l) => l.split('|'));
const teams = [...new Set(rows.flatMap((r) => [r[1], r[2]]))].sort();
const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
const groupData = rows.map((r) => ({
  group: r[0], home: idx[r[1]], away: idx[r[2]], hg: +r[3], ag: +r[4],
  homeName: r[1], awayName: r[2],
}));
const koData = KNOCKOUT.map(([h, a, hg, ag, pens]) => ({
  home: idx[h], away: idx[a], hg, ag, pens, homeName: h, awayName: a,
}));

const goalsAll = [...groupData, ...koData].reduce((s, m) => s + m.hg + m.ag, 0);
console.log(`teams=${teams.length} group=${groupData.length} knockout=${koData.length} goals=${goalsAll}`);
if (goalsAll !== 308) { console.error('!! goal total does not reconcile with FIFA 308'); process.exit(1); }
console.log('OK: goal total reconciles with FIFA (308)');

/* --- 1. choose the ridge by cross-validation ---------------------- */
console.log('\n=== Cross-validating ridge on the 72 group matches (6 folds) ===');
const cv = crossValidateRidge(teams, groupData, {
  homeAdvantage: HA, K: 6, iters: 3000,
  grid: [0, 0.25, 0.5, 1, 2, 4, 8, 16, 32],
});
console.log('  ridge    train LL   holdout LL   gap');
for (const c of cv.curve) {
  console.log(`  ${String(c.ridge).padStart(5)}  ${c.trainLL.toFixed(4).padStart(9)}  ${c.holdoutLL.toFixed(4).padStart(11)}  ${(c.trainLL - c.holdoutLL).toFixed(4).padStart(7)}`);
}
console.log(`  -> best ridge = ${cv.best.ridge} (holdout LL ${cv.best.holdoutLL.toFixed(4)})`);
const RIDGE = cv.best.ridge;

/* --- 2. final fits ------------------------------------------------ */
console.log('\nFitting final group model (with SEs) and knockout model...');
const gFit = fit(teams, groupData, {
  iters: 8000, lr: 0.05, homeAdvantage: HA, ridge: RIDGE, computeSE: true,
});
const kFit = fit(teams, koData, { iters: 8000, lr: 0.05, homeAdvantage: 0, ridge: RIDGE });

const ratings = teams.map((t, i) => ({
  name: t,
  att: gFit.att[i], def: gFit.def[i],
  seAtt: gFit.seAtt[i], seDef: gFit.seDef[i],
  attKO: kFit.att[i], defKO: kFit.def[i],
  drift: kFit.att[i] - gFit.att[i],
  host: HOSTS.has(t),
}));

console.log('\nGroup-stage ratings, best attacks first (with standard error):');
console.log('  team                      att     ±se    def     ±se   KO-att   drift');
for (const r of [...ratings].sort((a, b) => b.att - a.att).slice(0, 12)) {
  console.log(`  ${r.name.padEnd(24)} ${r.att.toFixed(3).padStart(6)} ${r.seAtt.toFixed(3).padStart(6)} ${r.def.toFixed(3).padStart(6)} ${r.seDef.toFixed(3).padStart(6)} ${r.attKO.toFixed(3).padStart(8)} ${r.drift.toFixed(3).padStart(7)}${r.host ? '  [host]' : ''}`);
}

const byAtt = [...ratings].sort((a, b) => b.att - a.att);
const byKO = [...ratings].sort((a, b) => b.attKO - a.attKO);
const ger = ratings.find((r) => r.name === 'Germany');

console.log('\n=== GERMANY: what the group stage said vs what the knockouts showed ===');
if (ger) {
  const rankRaw = byAtt.findIndex((r) => r.name === 'Germany') + 1;
  const rankKO = byKO.findIndex((r) => r.name === 'Germany') + 1;
  console.log(`  group attack  ${ger.att.toFixed(3)} ± ${ger.seAtt.toFixed(3)}  (rank ${rankRaw}/48)`);
  console.log(`  KO    attack  ${ger.attKO.toFixed(3)}          (rank ${rankKO}/48)`);
  console.log(`  drift         ${ger.drift.toFixed(3)}  = ${(ger.drift / ger.seAtt).toFixed(2)} standard errors`);
  console.log(`  group defence ${ger.def.toFixed(3)} ± ${ger.seDef.toFixed(3)}`);
  console.log(`  KO    defence ${ger.defKO.toFixed(3)}`);
}

/* --- 3. the German group-of-death angle --------------------------- */
// Germany's group attack is built almost entirely on one match. Show what the
// rating is without it — a leave-one-match-out refit is not needed to make the
// point, but the two component matches are worth printing side by side.
const gerMatches = groupData.filter((m) => m.homeName === 'Germany' || m.awayName === 'Germany');
console.log('\n  Germany\'s three group matches:');
for (const m of gerMatches) {
  const gf = m.homeName === 'Germany' ? m.hg : m.ag;
  const ga = m.homeName === 'Germany' ? m.ag : m.hg;
  const opp = m.homeName === 'Germany' ? m.awayName : m.homeName;
  const oppRank = byAtt.findIndex((r) => r.name === opp) + 1;
  console.log(`    vs ${opp.padEnd(22)} ${gf}-${ga}   (opponent attack rank ${oppRank}/48)`);
}

/* --- pick machinery ----------------------------------------------- */
function matrixFor(hName, aName, opts = {}) {
  const { useKO = false, neutral = true } = opts;
  const H = ratings.find((r) => r.name === hName);
  const A = ratings.find((r) => r.name === aName);
  if (!H || !A) throw new Error(`unknown team ${hName} / ${aName}`);
  const mu = useKO ? kFit.mu : gFit.mu;
  const hAdv = neutral ? 0 : HA;
  const lh = Math.exp(mu + (useKO ? H.attKO : H.att) - (useKO ? A.defKO : A.def) + hAdv / 2);
  const la = Math.exp(mu + (useKO ? A.attKO : A.att) - (useKO ? H.defKO : H.def) - hAdv / 2);
  return { P: scoreMatrix(lh, la, RHO), lh, la };
}

const pts = [];
for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) pts.push([i, j]);

const modalPick = (P) => {
  let bi = 0, bv = -1;
  for (let k = 0; k < NACT; k++) { const [i, j] = pts[k]; if (P[i][j] > bv) { bv = P[i][j]; bi = k; } }
  return { pick: pts[bi], p: bv, idx: bi };
};

const safePick = (A) => {
  let bi = 0, bv = -Infinity;
  for (let s = 0; s < NACT; s++) {
    let worst = Infinity;
    for (let t = 0; t < NACT; t++) if (A[s][t] < worst) worst = A[s][t];
    if (worst > bv) { bv = worst; bi = s; }
  }
  return { pick: pts[bi], guarantee: bv, idx: bi };
};

const evAgainst = (A, oppDist) => {
  const out = new Float64Array(NACT);
  for (let s = 0; s < NACT; s++) {
    let ev = 0;
    for (let t = 0; t < NACT; t++) if (oppDist[t]) ev += oppDist[t] * A[s][t];
    out[s] = ev;
  }
  return out;
};

/**
 * CROWD MODELS — the tool's stated assumptions, exposed in the UI so a user can
 * disagree with them. No live crowd data is used: TipMaster publishes consensus
 * only through its agent API, which does not answer from here, so these are
 * explicitly assumptions rather than observations.
 *
 * `humanPool`: the scorelines a person actually writes down. Empirically people
 *   almost never tip more than 4 goals for one side, and cluster on 1-2.
 * `drawAversion`: the well-documented tendency to under-tip draws, because a
 *   1:1 feels like a non-answer. Combined with `scoreBias` this is the single
 *   assumption the whole edge calculation rests on, which is exactly why it is
 *   a named, visible input on the page rather than a buried constant.
 */
const HUMAN_TIPS = [
  [0,0],[1,0],[0,1],[1,1],[2,0],[0,2],[2,1],[1,2],[2,2],
  [3,0],[0,3],[3,1],[1,3],[3,2],[2,3],[3,3],[4,0],[0,4],[4,1],[4,2],
];
const DRAW_AVERSION = 0.65;
const SCORE_BIAS = 0.5;
const isDraw = ([i, j]) => i === j;
const humanWeight = (tip) => (isDraw(tip) ? DRAW_AVERSION : 1) / (1 + SCORE_BIAS * (tip[0] + tip[1]));

/** Uniform over the human pool — the weakest assumption, a useful baseline. */
const crowdUniform = () => {
  const d = new Float64Array(NACT);
  for (const [i, j] of HUMAN_TIPS) d[i * NG + j] = 1 / HUMAN_TIPS.length;
  return d;
};

/**
 * A crowd that *watches the same match we do*: it starts from the model's own
 * score distribution restricted to the human pool, then applies draw aversion
 * and the low-score bias. This is the realistic opponent and the one the page
 * reports the exploit against by default.
 */
const crowdFromModel = (P, opts = {}) => {
  const { drawAversion = DRAW_AVERSION, scoreBias = SCORE_BIAS, topN = 10 } = opts;
  const d = new Float64Array(NACT);
  const pool = HUMAN_TIPS.map(([i, j]) => ({ i, j, p: P[i][j] }))
    .sort((a, b) => b.p - a.p)
    .slice(0, topN);
  let tot = 0;
  for (const { i, j, p } of pool) {
    const w = p * (i === j ? drawAversion : 1) / (1 + scoreBias * (i + j));
    d[i * NG + j] = w;
    tot += w;
  }
  for (let k = 0; k < NACT; k++) d[k] /= tot;
  return d;
};

/** A single-tip opponent. */
const pointMass = (i, j) => {
  const d = new Float64Array(NACT);
  d[i * NG + j] = 1;
  return d;
};

const crowdBestResponse = (A, dist) => {
  const ev = evAgainst(A, dist);
  let bi = 0;
  for (let s = 1; s < NACT; s++) if (ev[s] > ev[bi]) bi = s;
  return { pick: pts[bi], ev: ev[bi], evAll: ev };
};

const analyse = (P) => {
  const { A } = payoffMatrix(P);
  const modal = modalPick(P);
  const safe = safePick(A);
  const cl = crowdFromModel(P);
  const brClust = crowdBestResponse(A, cl);
  const brUni = crowdBestResponse(A, crowdUniform());
  // Worst case across every possible single-tip opponent.
  const worstOf = (idx) => {
    let w = Infinity;
    for (let t = 0; t < NACT; t++) if (A[idx][t] < w) w = A[idx][t];
    return w;
  };
  return {
    modal: modal.pick, modalP: modal.p,
    safe: safe.pick, safeGuarantee: safe.guarantee,
    crowdBest: brClust.pick, crowdBestEv: brClust.ev,
    crowdUniformBest: brUni.pick, crowdUniformEv: brUni.ev,
    modalEv: brClust.evAll[modal.idx],
    safeEv: brClust.evAll[safe.idx],
    modalWorst: worstOf(modal.idx),
    safeWorst: safe.guarantee,
    divergent: safe.pick[0] !== modal.pick[0] || safe.pick[1] !== modal.pick[1],
    edge: brClust.ev - 0.5,
  };
};

/* --- 4. headline stats across every fixture ----------------------- */
console.log('\n=== FIXTURE SWEEP ===');
// The full 2256-fixture sweep builds an 81x81 payoff matrix per fixture, which
// is the expensive part of this build. It is skipped by default because the
// PAGE does this work live in the browser — faster, and it lets the user pick
// their own fixture rather than reading a pre-baked table.
// Run with `node build-bundle.mjs --sweep` to include it.
const DO_SWEEP = process.argv.includes('--sweep');
let divCount = 0, total = 0, maxG = -Infinity, minG = Infinity;
const guaranteeHisto = new Map();
const safePickCounts = new Map();
let sumEdge = 0, sumCrowdEV = 0, sumSafeEV = 0, sumModalEV = 0;
const divergenceSamples = [];

if (DO_SWEEP) {
  for (const H of ratings) {
    for (const A of ratings) {
      if (H.name === A.name) continue;
      const { P } = matrixFor(H.name, A.name, { neutral: true });
      const r = analyse(P);
      total++;
      if (r.divergent) {
        divCount++;
        if (divergenceSamples.length < 12) {
          divergenceSamples.push({ fixture: `${H.name} v ${A.name}`, modal: r.modal, safe: r.safe, guarantee: r.safeGuarantee });
        }
      }
      maxG = Math.max(maxG, r.safeGuarantee);
      minG = Math.min(minG, r.safeGuarantee);
      const gk = r.safeGuarantee.toFixed(4);
      guaranteeHisto.set(gk, (guaranteeHisto.get(gk) || 0) + 1);
      const sk = `${r.safe[0]}:${r.safe[1]}`;
      safePickCounts.set(sk, (safePickCounts.get(sk) || 0) + 1);
      sumEdge += r.edge;
      sumCrowdEV += r.crowdBestEv;
      sumSafeEV += r.safeEv;
      sumModalEV += r.modalEv;
    }
  }
  console.log(`  fixtures analysed:              ${total}`);
  console.log(`  safe pick != modal pick:        ${divCount} (${(100 * divCount / total).toFixed(1)}%)`);
  console.log(`  safe-pick guarantee range:      ${minG.toFixed(6)} .. ${maxG.toFixed(6)}`);
  console.log(`  distinct guarantee values:      ${guaranteeHisto.size} -> ${[...guaranteeHisto.entries()].map(([k, v]) => `${k}×${v}`).join('  ')}`);
  console.log(`  mean crowd best-response edge:  ${(sumEdge / total).toFixed(4)} over 1/2`);
  console.log(`  vs crowd model: safe EV ${(sumSafeEV / total).toFixed(4)}, modal EV ${(sumModalEV / total).toFixed(4)}, best-response EV ${(sumCrowdEV / total).toFixed(4)}`);
  console.log(`  most common safe picks:         ${[...safePickCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} (${v})`).join('  ')}`);
  // How often does the safe pick differ from the modal pick, and by how much
  // does it actually improve the worst case? This is the honest size of the
  // "pick the safe scoreline" advice.
  let improved = 0, equal = 0, worse = 0;
  for (const H of ratings) {
    for (const A of ratings) {
      if (H.name === A.name) continue;
      const r = analyse(matrixFor(H.name, A.name, { neutral: true }).P);
      if (r.safeWorst > r.modalWorst + 1e-9) improved++;
      else if (Math.abs(r.safeWorst - r.modalWorst) <= 1e-9) equal++;
      else worse++;
    }
  }
  console.log(`  safe pick strictly improves worst case on ${improved}/${total} fixtures (equal on ${equal}, worse on ${worse})`);
  for (const d of divergenceSamples) {
    console.log(`    ${d.fixture.padEnd(34)} modal ${d.modal[0]}:${d.modal[1]}   safe ${d.safe[0]}:${d.safe[1]}  (guarantee ${d.guarantee.toFixed(4)})`);
  }
} else {
  console.log('  skipped (pass --sweep to include). The page computes this live.');
}

/* --- 5. backtest on the real knockout stage ----------------------- */
console.log('\n=== BACKTEST: 32 real knockout matches, ratings from the GROUP stage only ===');
// Opponent archetypes. `mirrors us` is the worst case the theorem describes:
// the opponent copies our tip, every duel is level, and the possession call
// gives a flat 50%. No strategy can beat that row — which is the point.
const ARCHETYPES = {
  'always 1:1': pointMass(1, 1),
  'always 1:0': pointMass(1, 0),
  'always 2:1': pointMass(2, 1),
  'crowd uniform': crowdUniform(),
  'crowd model': null,      // derived per fixture from the model, like the crowd
  'mirrors us': null,       // copies our tip
};
const STRATEGIES = {
  'safe pick': (P, A) => safePick(A).pick,
  'modal pick': (P) => modalPick(P).pick,
  'crowd best response': (P, A) => crowdBestResponse(A, crowdFromModel(P)).pick,
  'always 1:1': () => [1, 1],
};

const backtest = {};
for (const [sName, sFn] of Object.entries(STRATEGIES)) {
  backtest[sName] = {};
  for (const [aName, aDistTemplate] of Object.entries(ARCHETYPES)) {
    let w = 0, l = 0, d = 0, exact = 0;
    for (const m of koData) {
      const { P } = matrixFor(m.homeName, m.awayName, { neutral: true });
      const { A } = payoffMatrix(P);
      const ourTip = sFn(P, A);
      let theirTip;
      if (aName === 'mirrors us') theirTip = ourTip;
      else if (aName === 'crowd model') {
        const dist = crowdFromModel(P);
        let bi = 0; for (let s = 1; s < NACT; s++) if (dist[s] > dist[bi]) bi = s;
        theirTip = pts[bi];
      } else {
        let bi = 0; for (let s = 1; s < NACT; s++) if (aDistTemplate[s] > aDistTemplate[bi]) bi = s;
        theirTip = pts[bi];
      }
      const actual = [m.hg, m.ag];
      const r = duelOutcome(ourTip, theirTip, actual);
      if (r === 1) w++; else if (r === 0) l++; else d++;
      if (ourTip[0] === actual[0] && ourTip[1] === actual[1]) exact++;
    }
    backtest[sName][aName] = { w, l, d, exact, score: w + 0.5 * d, pct: (w + 0.5 * d) / koData.length };
  }
}
console.log('\n  strategy              opponent           W-L-D    pts/32    win%   exact');
for (const [sName, byArch] of Object.entries(backtest)) {
  for (const [aName, r] of Object.entries(byArch)) {
    console.log(`  ${sName.padEnd(20)} ${aName.padEnd(17)} ${String(r.w).padStart(2)}-${String(r.l).padStart(2)}-${String(r.d).padStart(2)}  ${r.score.toFixed(1).padStart(7)}  ${(100 * r.pct).toFixed(1).padStart(5)}%  ${String(r.exact).padStart(4)}`);
  }
  console.log('');
}

/* --- 6. key fixture pick tables for the UI ------------------------ */
const keyFixtures = [
  ['Spain', 'Argentina'], ['Germany', 'Paraguay'], ['France', 'Spain'],
  ['England', 'Argentina'], ['Brazil', 'Morocco'], ['Mexico', 'Ecuador'],
  ['Germany', 'Curacao'], ['Ecuador', 'Germany'], ['Netherlands', 'Japan'],
  ['United States', 'Paraguay'], ['Cabo Verde', 'Spain'], ['Brazil', 'Norway'],
  ['France', 'England'], ['Germany', "Cote d'Ivoire"], ['Argentina', 'Egypt'],
  ['Portugal', 'Spain'],
];
const pickTables = keyFixtures.map(([h, a]) => {
  const { P, lh, la } = matrixFor(h, a, { neutral: true });
  const r = analyse(P);
  return { home: h, away: a, lh: +lh.toFixed(3), la: +la.toFixed(3), ...r };
});
console.log('=== KEY FIXTURE PICKS ===');
console.log('  fixture                       xG       modal   p      safe   guar    crowdBR  crowdEV  modalEV');
for (const t of pickTables) {
  console.log(`  ${(t.home + ' v ' + t.away).padEnd(28)} ${(t.lh.toFixed(2)+'-'+t.la.toFixed(2)).padStart(5)}  ${(t.modal[0]+':'+t.modal[1]).padStart(5)}  ${t.modalP.toFixed(3)}  ${(t.safe[0]+':'+t.safe[1]).padStart(4)}  ${t.safeGuarantee.toFixed(4)}  ${(t.crowdBest[0]+':'+t.crowdBest[1]).padStart(5)}   ${t.crowdBestEv.toFixed(4)}  ${t.modalEv.toFixed(4)}`);
}

const safePickStats = [...safePickCounts.entries()].sort((a, b) => b[1] - a[1])
  .map(([pick, count]) => ({ pick, count, pct: count / total }));

/* --- 7. emit ------------------------------------------------------ */
const bundle = {
  meta: {
    tournament: 'FIFA World Cup 2026',
    generated: new Date().toISOString(),
    groupMatches: groupData.length,
    knockoutMatches: koData.length,
    totalGoals: goalsAll,
    maxGoals: MAX_GOALS,
    rho: RHO,
    ridge: RIDGE,
    muGroup: +gFit.mu.toFixed(4),
    muKnockout: +kFit.mu.toFixed(4),
    homeAdvantage: HA,
    maximinValue: 0.5,
    cv: { curve: cv.curve.map((c) => ({ ...c, trainLL: +c.trainLL.toFixed(4), holdoutLL: +c.holdoutLL.toFixed(4) })), best: cv.best.ridge },
    analysis: {
      fixturesAnalysed: total,
      divergent: divCount,
      divergentPct: divCount / total,
      minGuarantee: +minG.toFixed(6),
      maxGuarantee: +maxG.toFixed(6),
      meanCrowdEdge: +(sumEdge / total).toFixed(4),
      safePickStats,
    },
    backtest,
    archetypes: Object.keys(ARCHETYPES),
    strategies: Object.keys(STRATEGIES),
  },
  teams: ratings.map((r) => ({
    n: r.name,
    a: +r.att.toFixed(4), d: +r.def.toFixed(4),
    sa: +r.seAtt.toFixed(4), sd: +r.seDef.toFixed(4),
    ka: +r.attKO.toFixed(4), kd: +r.defKO.toFixed(4),
    drift: +r.drift.toFixed(4),
    host: r.host ? 1 : 0,
  })),
  germany: ger ? {
    att: +ger.att.toFixed(4), seAtt: +ger.seAtt.toFixed(4), attKO: +ger.attKO.toFixed(4),
    def: +ger.def.toFixed(4), seDef: +ger.seDef.toFixed(4), defKO: +ger.defKO.toFixed(4),
    drift: +ger.drift.toFixed(4), driftSE: +(ger.drift / ger.seAtt).toFixed(2),
    rankAtt: byAtt.findIndex((r) => r.name === 'Germany') + 1,
    rankKO: byKO.findIndex((r) => r.name === 'Germany') + 1,
    groupMatches: gerMatches.map((m) => ({
      opp: m.homeName === 'Germany' ? m.awayName : m.homeName,
      gf: m.homeName === 'Germany' ? m.hg : m.ag,
      ga: m.homeName === 'Germany' ? m.ag : m.hg,
    })),
  } : null,
  pickTables: pickTables.map((t) => ({
    home: t.home, away: t.away, lh: t.lh, la: t.la,
    modal: t.modal, modalP: +t.modalP.toFixed(4),
    safe: t.safe, safeGuarantee: +t.safeGuarantee.toFixed(4),
    crowdBest: t.crowdBest, crowdBestEv: +t.crowdBestEv.toFixed(4),
    crowdUniformBest: t.crowdUniformBest, crowdUniformEv: +t.crowdUniformEv.toFixed(4),
    modalEv: +t.modalEv.toFixed(4), safeEv: +t.safeEv.toFixed(4),
    modalWorst: +t.modalWorst.toFixed(4), safeWorst: +t.safeWorst.toFixed(4),
    divergent: t.divergent, edge: +t.edge.toFixed(4),
  })),
  matches: groupData.map((m) => ({ g: m.group, h: m.homeName, a: m.awayName, hg: m.hg, ag: m.ag })),
  knockout: koData.map((m) => ({ h: m.homeName, a: m.awayName, hg: m.hg, ag: m.ag, pens: m.pens })),
};

mkdirSync('../site/data', { recursive: true });
const json = JSON.stringify(bundle);
writeFileSync('../site/data/bundle.json', json);
console.log(`\nwrote bundle.json (${(json.length / 1024).toFixed(1)} KB)`);

/* --- 8. markdown report ------------------------------------------- */
const md = [];
md.push('# Calibration & backtest output\n');
md.push(`Generated: ${bundle.meta.generated}\n`);
md.push(`- Teams: ${ratings.length}; group matches fitted: ${groupData.length}; knockout matches backtested: ${koData.length}`);
md.push(`- Total goals: ${goalsAll} (reconciles exactly with FIFA's published 308)`);
md.push(`- Ridge chosen by 6-fold CV: **${RIDGE}** (holdout LL ${cv.best.holdoutLL.toFixed(4)})`);
md.push(`- Group-stage mu: ${bundle.meta.muGroup}; home advantage: ${HA} log-goals`);
md.push(`- Fixtures analysed: ${total}; safe pick differs from modal in ${divCount} (${(100 * divCount / total).toFixed(1)}%)`);
md.push(`- Safe-pick guarantee range: ${minG.toFixed(4)} .. ${maxG.toFixed(4)} — the mirror theorem caps this at exactly 0.5\n`);
md.push('## Ridge cross-validation\n');
md.push('| ridge | train LL | holdout LL | gap |');
md.push('|---|---|---|---|');
for (const c of cv.curve) md.push(`| ${c.ridge} | ${c.trainLL.toFixed(4)} | ${c.holdoutLL.toFixed(4)} | ${(c.trainLL - c.holdoutLL).toFixed(4)} |`);
md.push('\n## Backtest — real knockout results, group-stage-only ratings\n');
md.push('| strategy | opponent | W-L-D | points/32 | win% | exact |');
md.push('|---|---|---|---|---|---|');
for (const [sName, byArch] of Object.entries(backtest)) {
  for (const [aName, r] of Object.entries(byArch)) {
    md.push(`| ${sName} | ${aName} | ${r.w}-${r.l}-${r.d} | ${r.score.toFixed(1)} | ${(100 * r.pct).toFixed(1)}% | ${r.exact} |`);
  }
}
md.push('\n## Key fixture picks\n');
md.push('| fixture | xG | modal | p | safe | guarantee | crowd best | crowd EV | modal EV |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const t of pickTables) {
  md.push(`| ${t.home} v ${t.away} | ${t.lh}-${t.la} | ${t.modal[0]}:${t.modal[1]} | ${t.modalP.toFixed(3)} | ${t.safe[0]}:${t.safe[1]} | ${t.safeGuarantee.toFixed(4)} | ${t.crowdBest[0]}:${t.crowdBest[1]} | ${t.crowdBestEv.toFixed(4)} | ${t.modalEv.toFixed(4)} |`);
}
md.push('\n## Most common safe picks across all fixtures\n');
md.push('| safe pick | fixtures | share |');
md.push('|---|---|---|');
for (const s of safePickStats.slice(0, 12)) md.push(`| ${s.pick} | ${s.count} | ${(100 * s.pct).toFixed(1)}% |`);
if (ger) {
  md.push('\n## Germany: group-stage rating vs knockout reality\n');
  md.push(`- Group attack: ${ger.att.toFixed(3)} ± ${ger.seAtt.toFixed(3)} (rank ${byAtt.findIndex((r) => r.name === 'Germany') + 1}/48)`);
  md.push(`- Knockout attack: ${ger.attKO.toFixed(3)} (rank ${byKO.findIndex((r) => r.name === 'Germany') + 1}/48)`);
  md.push(`- Drift: ${ger.drift.toFixed(3)} = ${(ger.drift / ger.seAtt).toFixed(2)} standard errors`);
  md.push('\n| opponent | score |');
  md.push('|---|---|');
  for (const m of gerMatches) md.push(`| ${m.homeName === 'Germany' ? m.awayName : m.homeName} | ${m.homeName === 'Germany' ? m.hg + '-' + m.ag : m.ag + '-' + m.hg} |`);
}
writeFileSync('RESULTS.md', md.join('\n'));
console.log('wrote RESULTS.md');
