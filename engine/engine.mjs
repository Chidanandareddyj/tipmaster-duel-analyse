/**
 * TipMaster Duel Pick Optimizer — model core.
 *
 * Three pieces of maths, deliberately separated:
 *
 *   1. scoreMatrix()   — calibrate a bivariate (Dixon-Coles) Poisson model and
 *                        turn two teams into P(home goals = i, away goals = j).
 *   2. duelOutcome()   — the game's actual duel rule, read off TipMaster: the
 *                        tip closer to the real scoreline wins; distance is
 *                        SQUARED error. Level => possession call breaks it.
 *   3. equilibrium()   — the duel is a two-player zero-sum game over the 9x9
 *                        grid of scorelines. Solve it properly instead of
 *                        guessing "the most likely scoreline".
 *
 * The headline result this file exists to prove: the most likely scoreline is
 * NOT the scoreline that maximises your chance of winning the duel.
 */

export const MAX_GOALS = 8;           // grid is 0..8 goals each side (9x9)
const RHO_DEFAULT = -0.06;            // Dixon-Coles low-score dependence
const XI = 0.0018;                    // L2 shrinkage on attack/defence ratings

/* ------------------------------------------------------------------ *
 * 1. Distributions
 * ------------------------------------------------------------------ */

/** Poisson pmf, truncated and renormalised over 0..MAX_GOALS. */
export function poissonVec(lambda) {
  const out = new Array(MAX_GOALS + 1);
  let fact = 1;
  for (let k = 0; k <= MAX_GOALS; k++) {
    if (k > 0) fact *= k;
    out[k] = Math.exp(-lambda) * Math.pow(lambda, k) / fact;
  }
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((v) => v / s);
}

/**
 * Dixon-Coles adjustment. Plain independent Poisson under-predicts 0-0, 1-0,
 * 0-1 and 1-1; tau fixes the four low cells. rho < 0 is the usual fit.
 */
export function tau(i, j, li, lj, rho) {
  if (i === 0 && j === 0) return 1 - li * lj * rho;
  if (i === 0 && j === 1) return 1 + li * rho;
  if (i === 1 && j === 0) return 1 + lj * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

/** P(home=i, away=j) as a normalised (MAX_GOALS+1)^2 matrix. */
export function scoreMatrix(lh, la, rho = RHO_DEFAULT) {
  const ph = poissonVec(lh);
  const pa = poissonVec(la);
  const n = MAX_GOALS + 1;
  const m = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    m.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      // tau can go slightly negative at extreme lambdas; clamp, then renormalise.
      const v = Math.max(0, tau(i, j, lh, la, rho) * ph[i] * pa[j]);
      m[i][j] = v;
      total += v;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i][j] /= total;
  return m;
}

/** Expected goals for one fixture from team ratings. */
export function lambdas(home, away, opts = {}) {
  const { homeAdvantage = 0.22, base = 0.15, mu = 0 } = opts;
  return {
    lh: Math.exp(mu + home.att - away.def + homeAdvantage / 2 + base),
    la: Math.exp(mu + away.att - home.def - homeAdvantage / 2 + base),
  };
}

/* ------------------------------------------------------------------ *
 * 2. The duel rule — read straight off TipMaster's docs
 * ------------------------------------------------------------------ */

/**
 * Squared-error distance between a tip and the real scoreline.
 * TipMaster's wording is "the closer your scoreline is to the real result";
 * squared error is the reading that matches how the site describes
 * closeness, and it is what the optimizer is built on. If they use absolute
 * error instead, swap this one function — everything downstream follows.
 */
export function tipDistance(tip, actual) {
  const dh = tip[0] - actual[0];
  const da = tip[1] - actual[1];
  return dh * dh + da * da;
}

/**
 * Resolve one duel under a known actual scoreline.
 * Returns 1 (us), 0 (them), 0.5 (level on distance -> possession call decides,
 * which we model as a coin flip since neither side has information on it).
 */
export function duelOutcome(ourTip, theirTip, actual) {
  const dUs = tipDistance(ourTip, actual);
  const dThem = tipDistance(theirTip, actual);
  if (dUs < dThem) return 1;
  if (dUs > dThem) return 0;
  return 0.5;
}

/** P(we win) if we both pick the same tip: 0.5 (distance tie -> possession coin flip). */
export const MIRROR_WIN_PROB = 0.5;

/* ------------------------------------------------------------------ *
 * 3. Solving the duel as a zero-sum game
 * ------------------------------------------------------------------ */

export function flatten(P) {
  const n = MAX_GOALS + 1;
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v[i * n + j] = P[i][j];
  return v;
}

/**
 * The payoff structure of a duel depends ONLY on the geometry of the scoreline
 * lattice and the distribution over real results — not on which two tips are
 * being compared. So we precompute, once:
 *
 *   - `dist`: P(actual scoreline) as a flat array
 *   - `beats[s][t]`: probability that tip s beats tip t (we count a level duel
 *     as 0.5, since the possession call then splits it)
 *
 * ...and every expected payoff afterwards is a dot product or a table lookup.
 * This turns the whole game solve from ~81^3 work per query into ~81^2, which
 * is what makes the full fixture sweep and the live page affordable.
 */
export function duelTables(P) {
  const n = MAX_GOALS + 1;
  const NC = n * n;                        // number of scoreline cells (81)
  const dist = new Float64Array(NC);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dist[i * n + j] = P[i][j];

  const beats = [];
  for (let s = 0; s < NC; s++) {
    const si = Math.floor(s / n), sj = s % n;
    const row = new Float64Array(NC);
    for (let t = 0; t < NC; t++) {
      const ti = Math.floor(t / n), tj = t % n;
      let w = 0, l = 0;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const p = dist[a * n + b];
          if (p === 0) continue;
          const dUs = (si - a) ** 2 + (sj - b) ** 2;
          const dThem = (ti - a) ** 2 + (tj - b) ** 2;
          if (dUs < dThem) w += p; else if (dUs === dThem) l += p;
        }
      }
      row[t] = w + 0.5 * l;
    }
    beats.push(row);
  }
  // `N` is the number of cells (so A is N x N); `n` is the grid side.
  return { dist, beats, N: NC, n, side: n };
}

/** Payoff matrix A[s][t] = P(we win | we tip s, they tip t). */
export function payoffMatrix(P) {
  const { beats, N, n } = duelTables(P);
  const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push([i, j]);
  return { A: beats, pts, N };
}

/**
 * P(we win) for our tip against a distribution over opponent tips.
 * Kept for readability and for the single-pair case in tests.
 */
export function winProb(ourTip, oppDist, P) {
  const n = MAX_GOALS + 1;
  const { beats } = duelTables(P);
  const s = ourTip[0] * n + ourTip[1];
  let ev = 0;
  for (let t = 0; t < n * n; t++) if (oppDist[t]) ev += oppDist[t] * beats[s][t];
  return ev;
}

/** Expected payoff of every pure tip against an opponent distribution. */
export function evVector(beats, oppDist) {
  const N = beats.length;
  const out = new Float64Array(N);
  for (let s = 0; s < N; s++) {
    const row = beats[s];
    let acc = 0;
    for (let t = 0; t < N; t++) if (oppDist[t]) acc += oppDist[t] * row[t];
    out[s] = acc;
  }
  return out;
}

/**
 * Solve the zero-sum game by fictitious play.
 *
 * Fictitious play converges for zero-sum games; the average strategies form a
 * Nash equilibrium and the game value converges to the maximin guarantee. We
 * exploit the structure: the payoff of a pure tip against the opponent's
 * *empirical* tip frequency is just the row average, so each iteration is one
 * matrix-vector product — no need to store 6561x6561 explicitly.
 *
 * Returns equilibrium strategy, game value (= guaranteed win rate no matter
 * what the opponent does), and best pure responses.
 */
export function equilibrium(A, N, iters = 4000) {
  const oppCount = new Float64Array(N);
  const ourSum = new Float64Array(N);
  const rowAvg = new Float64Array(N);
  let best = -Infinity, bestIdx = 0;

  for (let it = 0; it < iters; it++) {
    const total = it + 1;
    // Expected payoff of each pure tip against opponent's empirical mix.
    for (let s = 0; s < N; s++) {
      const row = A[s];
      let acc = 0;
      for (let t = 0; t < N; t++) if (oppCount[t]) acc += row[t] * oppCount[t];
      rowAvg[s] = acc / total;
    }
    // Our best response goes into "our" average; opponent's best response
    // (which minimises our payoff) goes into theirs.
    let bi = 0, bv = -Infinity;
    for (let s = 0; s < N; s++) if (rowAvg[s] > bv) { bv = rowAvg[s]; bi = s; }
    ourSum[bi]++;
    if (bv > best) { best = bv; bestIdx = bi; }

    let wi = 0, wv = Infinity;
    for (let t = 0; t < N; t++) {
      // column average against our empirical mix
      let acc = 0;
      for (let s = 0; s < N; s++) if (ourSum[s]) acc += A[s][t] * ourSum[s];
      const colAvg = acc / (it + 1);
      if (colAvg < wv) { wv = colAvg; wi = t; }
    }
    oppCount[wi]++;
  }

  const sum = ourSum.reduce((a, b) => a + b, 0);
  const strat = Array.from(ourSum, (v) => v / sum);

  // Game value: expected payoff of our equilibrium mix against their
  // equilibrium mix. Reported as the guaranteed win rate.
  const oppSum = oppCount.reduce((a, b) => a + b, 0);
  let value = 0;
  for (let s = 0; s < N; s++) {
    if (!strat[s]) continue;
    for (let t = 0; t < N; t++) {
      const q = oppCount[t] / oppSum;
      if (q) value += strat[s] * q * A[s][t];
    }
  }
  return { strat, value, bestPureIdx: bestIdx, bestPureValue: best, oppMix: Array.from(oppCount, (v) => v / oppSum) };
}

/** Analytic maximin: max over pure tips of the payoff against the opponent's *worst* case. */
export function maximinPure(A, N) {
  let bestIdx = 0, bestVal = -Infinity;
  for (let s = 0; s < N; s++) {
    let worst = Infinity;
    for (let t = 0; t < N; t++) if (A[s][t] < worst) worst = A[s][t];
    if (worst > bestVal) { bestVal = worst; bestIdx = s; }
  }
  return { idx: bestIdx, value: bestVal };
}

/* ------------------------------------------------------------------ *
 * 4. Model fitting (attack / defence ratings)
 * ------------------------------------------------------------------ */

/**
 * Fit attack/defence ratings by minimising the Poisson negative log-likelihood
 * via Adam. Dependency-free, because the page has to run offline.
 *
 * IDENTIFIABILITY. The model only sees att[i] - def[j], so the likelihood is
 * invariant under att -> att + c, def -> def + c. Two constraints pin it down:
 *
 *   - mean(att) = 0      (so mu reads off the mean goal rate directly)
 *   - mean(def) = 0
 *
 * Earlier this re-centred *inside* the objective, which made the gradient it
 * reported inconsistent with the parameters it moved — Adam then chased a
 * moving target and the fit stalled (recovered attack correlation 0.71 instead
 * of >0.9). The fix is to penalise the two means rather than silently shift
 * them, so the objective and the gradient describe the same function.
 *
 * matches: [{ home: idx, away: idx, hg: int, ag: int }]
 */
export function fit(teams, matches, opts = {}) {
  const {
    iters = 6000, lr = 0.05, homeAdvantage = 0.22,
    verbose = false, cenPenalty = 50, ridge = XI, computeSE = false,
  } = opts;
  const W = matches.map((m) => (m.w === undefined ? 1 : m.w));
  const T = teams.length;
  const nAtt = T, nDef = T;
  const dim = nAtt + nDef + 1;                 // + mu
  const theta = new Float64Array(dim);
  theta[dim - 1] = Math.log(1.25);             // start near 1.25 goals/side

  const m = new Float64Array(dim), v = new Float64Array(dim);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;

  const unpack = (th) => {
    const att = new Float64Array(T), def = new Float64Array(T);
    for (let i = 0; i < T; i++) { att[i] = th[i]; def[i] = th[nAtt + i]; }
    return { mu: th[dim - 1], att, def };
  };

  const nll = (th) => {
    const { mu, att, def } = unpack(th);
    let L = 0, sa = 0, sd = 0;
    for (let k = 0; k < matches.length; k++) {
      const mt = matches[k];
      const lh = Math.exp(mu + att[mt.home] - def[mt.away] + homeAdvantage / 2);
      const la = Math.exp(mu + att[mt.away] - def[mt.home] - homeAdvantage / 2);
      L += W[k] * (lh - mt.hg * Math.log(Math.max(lh, 1e-12)));
      L += W[k] * (la - mt.ag * Math.log(Math.max(la, 1e-12)));
    }
    for (let i = 0; i < T; i++) { sa += att[i]; sd += def[i]; }
    L += cenPenalty * ((sa / T) ** 2 + (sd / T) ** 2) * T;
    for (let i = 0; i < dim - 1; i++) L += ridge * th[i] * th[i];
    return L;
  };

  const grad = (th) => {
    const g = new Float64Array(dim);
    const { mu, att, def } = unpack(th);
    for (let k = 0; k < matches.length; k++) {
      const mt = matches[k];
      const lh = Math.exp(mu + att[mt.home] - def[mt.away] + homeAdvantage / 2);
      const la = Math.exp(mu + att[mt.away] - def[mt.home] - homeAdvantage / 2);
      const rh = W[k] * (lh - mt.hg), ra = W[k] * (la - mt.ag);
      g[dim - 1] += rh + ra;
      g[mt.home] += rh;  g[nAtt + mt.away] += -rh;
      g[mt.away] += ra;  g[nAtt + mt.home] += -ra;
    }
    let sa = 0, sd = 0;
    for (let i = 0; i < T; i++) { sa += att[i]; sd += def[i]; }
    for (let i = 0; i < T; i++) { g[i] += 2 * cenPenalty * sa; g[nAtt + i] += 2 * cenPenalty * sd; }
    for (let i = 0; i < dim - 1; i++) g[i] += 2 * ridge * th[i];
    return g;
  };

  for (let t = 1; t <= iters; t++) {
    const g = grad(theta);
    for (let i = 0; i < dim; i++) {
      m[i] = b1 * m[i] + (1 - b1) * g[i];
      v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
      const mh = m[i] / (1 - Math.pow(b1, t));
      const vh = v[i] / (1 - Math.pow(b2, t));
      theta[i] -= lr * mh / (Math.sqrt(vh) + eps);
    }
    if (verbose && t % 1500 === 0) console.log(`  iter ${t}  nll=${nll(theta).toFixed(4)}`);
  }
  if (verbose) console.log(`  final nll=${nll(theta).toFixed(4)}`);

  const out = unpack(theta);

  if (computeSE) {
    // Hessian of the *unpenalised* Poisson likelihood, plus the ridge term.
    //
    // In a Poisson GLM the observed information is X'WX with W = mu, so the
    // diagonal contribution of a match to a team's rating is just its own
    // expected goals — which makes the whole thing O(matches) to assemble.
    // The centring penalty puts a rank-one block of size 2*cenPenalty on each
    // of the attack and defence halves; its inverse contributes
    // (1/(2*cenPenalty*T)) to every entry of the corresponding block, and that
    // constant is exactly the variance of the mean, so it cancels out of
    // att[i] - mean(att). We therefore only need the diagonal.
    const infoAtt = new Float64Array(T);
    const infoDef = new Float64Array(T);
    for (let k = 0; k < matches.length; k++) {
      const mt = matches[k];
      const lh = Math.exp(out.mu + out.att[mt.home] - out.def[mt.away] + homeAdvantage / 2);
      const la = Math.exp(out.mu + out.att[mt.away] - out.def[mt.home] - homeAdvantage / 2);
      infoAtt[mt.home] += lh;
      infoAtt[mt.away] += la;
      infoDef[mt.away] += lh;
      infoDef[mt.home] += la;
    }
    const cenVar = 1 / (2 * cenPenalty * T);
    const seAtt = new Float64Array(T);
    const seDef = new Float64Array(T);
    for (let i = 0; i < T; i++) {
      seAtt[i] = Math.sqrt(1 / Math.max(infoAtt[i], 1e-9) + cenVar);
      seDef[i] = Math.sqrt(1 / Math.max(infoDef[i], 1e-9) + cenVar);
    }
    // A rating is only identified relative to the field, so what matters when
    // you ask "is A better than B?" is the standard error of a rating
    // *difference*: for att[i] - att[j] the shared mean cancels, leaving
    // sqrt(1/info_i + 1/info_j). Same for defence.
    const seDiffAtt = new Float64Array(T);
    const seDiffDef = new Float64Array(T);
    for (let i = 0; i < T; i++) {
      seDiffAtt[i] = Math.sqrt(1 / Math.max(infoAtt[i], 1e-9) + 1 / (2 * cenPenalty * T));
      seDiffDef[i] = Math.sqrt(1 / Math.max(infoDef[i], 1e-9) + 1 / (2 * cenPenalty * T));
    }
    return { ...out, seAtt, seDef, seDiffAtt, seDiffDef, infoAtt, infoDef };
  }

  return out;
}

/**
 * K-fold cross-validation over the ridge strength.
 *
 * With 72 group matches and 97 parameters, the unregularised fit has fewer
 * observations than parameters — it will interpolate. This measures that
 * honestly: fit on K-1 folds, score held-out log-likelihood, pick the ridge
 * that generalises best. Returns the whole curve so the page can show it
 * rather than just asserting a number.
 */
export function crossValidateRidge(teams, matches, opts = {}) {
  const { grid = [0, 0.5, 1, 2, 4, 8, 16, 32, 64], K = 6, seed = 7 } = opts;
  // Deterministic shuffle so folds are reproducible.
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const order = matches.map((m, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const folds = Array.from({ length: K }, () => []);
  order.forEach((mi, k) => folds[k % K].push(matches[mi]));

  // Score held-out Poisson log-likelihood (constants dropped).
  const holdoutLL = (f, rows, ha) => {
    let ll = 0;
    for (const mt of rows) {
      const lh = Math.exp(f.mu + f.att[mt.home] - f.def[mt.away] + ha / 2);
      const la = Math.exp(f.mu + f.att[mt.away] - f.def[mt.home] - ha / 2);
      ll += mt.hg * Math.log(Math.max(lh, 1e-12)) - lh;
      ll += mt.ag * Math.log(Math.max(la, 1e-12)) - la;
    }
    return ll;
  };

  const ha = opts.homeAdvantage ?? 0.22;
  const curve = [];
  for (const ridge of grid) {
    let ll = 0, n = 0, trainLL = 0, trainN = 0;
    for (let k = 0; k < K; k++) {
      const test = folds[k];
      const train = folds.flatMap((f, i) => (i === k ? [] : f));
      const f = fit(teams, train, { ...opts, ridge, homeAdvantage: ha, iters: opts.iters ?? 4000 });
      ll += holdoutLL(f, test, ha); n += test.length;
      trainLL += holdoutLL(f, train, ha); trainN += train.length;
    }
    curve.push({ ridge, holdoutLL: ll / n, trainLL: trainLL / trainN });
  }
  const best = curve.reduce((a, b) => (b.holdoutLL > a.holdoutLL ? b : a));
  return { curve, best };
}
