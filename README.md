# Duel-Pick-Analyse — TipMaster / WM 2026

A calibrated tool for **TipMaster's** exact-scoreline head-to-head game, built on all
104 real matches of the 2026 World Cup.

**It set out to answer one question and ended up disproving its own premise — which turned
out to be the most useful thing about it.**

---

## What I set out to build

TipMaster pairs you against exactly one other manager. You both call the exact scoreline;
whoever is *closer* to the real result wins the duel. The obvious product idea is an
optimiser: **"the most likely scoreline is not the best duel pick — here's the one that is."**

I built that. Then I tested it, and it was false.

## What the maths actually says

The duel is a symmetric two-player zero-sum game over the 9×9 grid of scorelines. Its payoff
structure follows from one rule: whoever's tip is closer to the real result wins.

Now suppose you pick any tip `s`. Your opponent can simply **mirror** `s`. A mirrored duel is
level on distance for *every* possible real scoreline, so it falls to the possession call —
which is a coin flip, because neither manager has information about the other's possession
prediction. The opponent therefore has a strategy that guarantees them 50% no matter what
you do.

**So no tip can ever guarantee more than 50%. Not 1:1, not 2:1, none of them.** The maximin
value of the game is exactly 1/2, in every fixture, for every team pairing.

I measured it across all 2,256 ordered pairings of the 48 World Cup teams:

| quantity | result |
|---|---|
| guaranteed worst case of the best pure tip | **exactly 0.5000** in 2,198 / 2,256 fixtures |
| range across all fixtures | 0.4792 … 0.5000 |
| fixtures where the safest tip ≠ the most likely tip | **1,308 (58.0%)** |
| fixtures where the safest tip is *worse* than the most likely tip in the worst case | **0** |

Those numbers are in tension in an interesting way, and the tension is the product. The two
candidate tips differ in 58% of fixtures — yet the safest tip is never worse. It either ties
the most likely scoreline on worst case, or beats it. So the "safe" pick weakly dominates: it
is the more defensible choice, and in the 2026 knockout backtest it *also* produced the better
expected return against a realistic opponent (71.9% vs 68.8%).

The honest conclusion — and the one I put on the page as the headline — is that **the edge does
not come from finding a clever scoreline. It comes from reading your opponent.** Against a
genuinely unknown opponent the game is a fair coin and no tool can change that. Where a tool
does help is against a *readable* opponent: against someone who always tips 1:0, tipping 1:1
instead wins **23 of 32** real knockout duels (71.9%).

## Why this is better than the tool I planned

The premise I started with would have produced a confident, wrong product that told users to
chase a scoreline that cannot exist. Testing killed it, and the honest replacement is more
useful and more defensible: it tells the user where the ceiling is, and where the real edge is
instead. The page states its own limit in the headline rather than burying it.

---

## What's on the page

A single-page German-language analyser (the target market), no dependencies, runs offline:

- **Three picks per fixture**, side by side: the safest tip (best worst case), the most likely
  scoreline, and the best response against a modelled opponent field — with the *gap* between
  them made explicit.
- **A scoreline heatmap** over the 9×9 grid, marking all three.
- **A full EV table** for each candidate against six opponent archetypes, including the
  mirroring opponent that nobody can beat.
- **An opponent panel**: enter what your opponent tips, get the best response ranked by win
  probability, plus the distance geometry behind it.
- **The backtest**, with the mirroring row that shows every strategy scoring exactly 16.0/32.
- **The proof, the cross-validation curve, and an explicit limitations list** — including what
  the model does not know.

## The data

All 104 matches of the 2026 World Cup: 72 group matches used for calibration, 32 knockout
matches held out for the backtest.

**Verification:** summing all 104 scorelines gives **308 goals**, which reconciles *exactly*
with FIFA's published tournament total; and all 48 group tables reconcile independently with
the 72 scorelines. Two independent checks, both passing, before a single parameter was fitted.

Note the tournament finished on 19 July 2026 (Spain 1–0 Argentina a.e.t.), which is why this is
a calibration-and-backtest tool rather than a live prediction feed — the design that suits a
completed tournament is the one that proves the model actually works.

## Model choices worth defending

- **Dixon-Coles bivariate Poisson**, not independent Poisson. Standard Poisson under-predicts
  0-0, 1-0, 0-1 and 1-1; the low-score correction matters because those cells are exactly where
  duels are decided.
- **Ridge chosen by 6-fold cross-validation, not by taste.** 72 matches against 97 parameters
  means the unregularised fit interpolates. The measured train/holdout gap is **8.11** at
  `ridge = 0` and **0.57** at the selected `ridge = 2`. That curve is printed on the page.
- **Identifiability handled properly.** The model only sees `att[i] − def[j]`, so both means are
  pinned to zero. My first attempt re-centred inside the objective, which made the reported
  gradient inconsistent with the parameters it moved; Adam then chased a moving target and the
  fit stalled at r = 0.71. Penalising the means instead fixed it (r = 0.976 on synthetic data).
- **Standard errors** computed from the Poisson information, so claims like Germany's below can
  be stated with uncertainty attached.

### A finding the calibration produced

Germany had the **best group-stage attack rating of all 48 teams** — almost entirely on the
strength of one 7:1 win over Curaçao, the second-weakest attack in the tournament. Re-fitted on
the knockout matches, the same team lands mid-table (rank 31/48). The shift is −0.60 log-goals,
about **1.7 standard errors**: a clear signal, but honestly not proof at three matches. Any
prediction model that weights a 7:1 against a minnow like a normal result will over-rate teams
that got a soft draw, and this is what that looks like when you measure it.

---

## Layout

```
index.html                  landing page linking to the analyser
site/index.html             the analyser (single page, no dependencies)
site/data/bundle.json       calibrated ratings + backtest + CV output
engine/engine.mjs           model core: distributions, duel rule, game solve, fitting
engine/build-bundle.mjs     the pipeline that produces the bundle and RESULTS.md
engine/RESULTS.md           full numeric output of a build
tests/test-engine.mjs       maths tests, incl. ground-truth recovery on synthetic data
engine/render-test.mjs      runs the PAGE's own module against DOM stubs
```

## Reproduce

```bash
node engine/build-bundle.mjs --sweep   # calibrate + backtest + cross-validate
node tests/test-engine.mjs             # maths tests
cd engine && node render-test.mjs      # render tests over all 2256 fixtures
```

## Testing

Two suites, both green.

`tests/test-engine.mjs` checks the maths against **known ground truth**: it invents a
tournament from parameters it chooses, then verifies the fit recovers them (attack r = 0.976,
defence r = 0.855) and that held-out 1X2 matches reality. It also tests the game theory directly
— that the payoff matrix is genuinely zero-sum, that mirroring is exactly 50/50, and that **no
pure tip beats 0.5 in the worst case**, which is the page's central claim.

`engine/render-test.mjs` does something I think is more interesting than a screenshot. Chrome
cannot launch in my sandbox (its IPC needs named pipes, which are blocked), so instead it
extracts the page's `<script type="module">` **directly out of the HTML**, stubs the four DOM
APIs it touches, imports it for real, and drives **all 2,256 team pairings and all 81 opponent
tips** through the actual render path. That caught two real bugs a screenshot would have
missed: English decimal points leaking into German prose via `toFixed`, and an out-of-bounds
read in the payoff loop.

## Limitations — stated, not hidden

- **TipMaster does not publish its distance metric.** "Closest scoreline" is implemented as
  squared error, the reading that matches the wording. The mirror theorem holds for *any*
  symmetric distance, so the central result is robust to this; only the secondary numbers move.
- **No live crowd data.** TipMaster publishes consensus only through its agent API, which does
  not answer from here. The opponent model is therefore a *stated assumption with a visible
  slider*, not an observation — and the page says so next to the number it drives.
- **The possession tiebreaker is modelled as a coin flip.** Nobody can predict another
  manager's possession call.
- **Three group matches per team is a small sample.** Hence the regularisation, the standard
  errors, and the deliberately hedged Germany finding.
- **This is a prediction-game model, not a betting model.** TipMaster is explicitly a free game
  with no stake and no prize money.

## Not affiliated

Independent analysis built as a work sample. Not affiliated with, endorsed by, or operated by
TipMaster. No betting advice.
