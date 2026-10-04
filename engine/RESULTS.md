# Calibration & backtest output

Generated: 2026-10-04T11:42:08.722Z

- Teams: 48; group matches fitted: 72; knockout matches backtested: 32
- Total goals: 308 (reconciles exactly with FIFA's published 308)
- Ridge chosen by 6-fold CV: **2** (holdout LL -1.5444)
- Group-stage mu: 0.2775; home advantage: 0.35 log-goals
- Fixtures analysed: 2256; safe pick differs from modal in 1308 (58.0%)
- Safe-pick guarantee range: 0.4792 .. 0.5000 — the mirror theorem caps this at exactly 0.5

## Ridge cross-validation

| ridge | train LL | holdout LL | gap |
|---|---|---|---|
| 0 | -0.5653 | -8.6730 | 8.1077 |
| 0.25 | -0.6624 | -1.9064 | 1.2439 |
| 0.5 | -0.7290 | -1.6748 | 0.9458 |
| 1 | -0.8297 | -1.5654 | 0.7357 |
| 2 | -0.9701 | -1.5444 | 0.5743 |
| 4 | -1.1448 | -1.5743 | 0.4296 |
| 8 | -1.3282 | -1.6241 | 0.2959 |
| 16 | -1.4838 | -1.6676 | 0.1839 |
| 32 | -1.5916 | -1.6979 | 0.1063 |

## Backtest — real knockout results, group-stage-only ratings

| strategy | opponent | W-L-D | points/32 | win% | exact |
|---|---|---|---|---|---|
| safe pick | always 1:1 | 7-5-20 | 17.0 | 53.1% | 2 |
| safe pick | always 1:0 | 21-4-7 | 24.5 | 76.6% | 2 |
| safe pick | always 2:1 | 12-11-9 | 16.5 | 51.6% | 2 |
| safe pick | crowd uniform | 26-2-4 | 28.0 | 87.5% | 2 |
| safe pick | crowd model | 18-4-10 | 23.0 | 71.9% | 2 |
| safe pick | mirrors us | 0-0-32 | 16.0 | 50.0% | 2 |
| modal pick | always 1:1 | 5-4-23 | 16.5 | 51.6% | 3 |
| modal pick | always 1:0 | 21-7-4 | 23.0 | 71.9% | 3 |
| modal pick | always 2:1 | 13-14-5 | 15.5 | 48.4% | 3 |
| modal pick | crowd uniform | 26-1-5 | 28.5 | 89.1% | 3 |
| modal pick | crowd model | 17-5-10 | 22.0 | 68.8% | 3 |
| modal pick | mirrors us | 0-0-32 | 16.0 | 50.0% | 3 |
| crowd best response | always 1:1 | 5-5-22 | 16.0 | 50.0% | 2 |
| crowd best response | always 1:0 | 21-5-6 | 24.0 | 75.0% | 2 |
| crowd best response | always 2:1 | 12-12-8 | 16.0 | 50.0% | 2 |
| crowd best response | crowd uniform | 26-2-4 | 28.0 | 87.5% | 2 |
| crowd best response | crowd model | 18-5-9 | 22.5 | 70.3% | 2 |
| crowd best response | mirrors us | 0-0-32 | 16.0 | 50.0% | 2 |
| always 1:1 | always 1:1 | 0-0-32 | 16.0 | 50.0% | 3 |
| always 1:1 | always 1:0 | 23-9-0 | 23.0 | 71.9% | 3 |
| always 1:1 | always 2:1 | 16-16-0 | 16.0 | 50.0% | 3 |
| always 1:1 | crowd uniform | 26-1-5 | 28.5 | 89.1% | 3 |
| always 1:1 | crowd model | 19-10-3 | 20.5 | 64.1% | 3 |
| always 1:1 | mirrors us | 0-0-32 | 16.0 | 50.0% | 3 |

## Key fixture picks

| fixture | xG | modal | p | safe | guarantee | crowd best | crowd EV | modal EV |
|---|---|---|---|---|---|---|---|---|
| Spain v Argentina | 0.971-1.044 | 1:1 | 0.143 | 1:1 | 0.5000 | 1:1 | 0.6789 | 0.6789 |
| Germany v Paraguay | 2.172-1.208 | 2:1 | 0.097 | 2:1 | 0.5000 | 2:1 | 0.6781 | 0.6781 |
| France v Spain | 1.179-1.059 | 1:1 | 0.141 | 1:1 | 0.5000 | 1:1 | 0.6901 | 0.6901 |
| England v Argentina | 1.106-1.431 | 1:1 | 0.133 | 1:1 | 0.5000 | 1:1 | 0.6885 | 0.6885 |
| Brazil v Morocco | 1.489-1.168 | 1:1 | 0.129 | 1:1 | 0.5000 | 1:1 | 0.6879 | 0.6879 |
| Mexico v Ecuador | 1.191-0.572 | 1:0 | 0.197 | 1:0 | 0.5000 | 1:0 | 0.6292 | 0.6292 |
| Germany v Curacao | 3.503-1.091 | 3:1 | 0.080 | 3:1 | 0.5000 | 3:1 | 0.6513 | 0.6513 |
| Ecuador v Germany | 1.058-1.748 | 1:1 | 0.118 | 1:2 | 0.5000 | 1:1 | 0.6523 | 0.6523 |
| Netherlands v Japan | 1.631-1.625 | 1:1 | 0.108 | 2:1 | 0.4849 | 1:1 | 0.6430 | 0.6430 |
| United States v Paraguay | 1.931-1.187 | 1:1 | 0.108 | 2:1 | 0.5000 | 2:1 | 0.6731 | 0.6357 |
| Cabo Verde v Spain | 0.644-1.109 | 0:1 | 0.185 | 0:1 | 0.5000 | 1:1 | 0.6289 | 0.6187 |
| Brazil v Norway | 2.326-1.32 | 2:1 | 0.093 | 2:1 | 0.5000 | 2:1 | 0.6647 | 0.6647 |
| France v England | 1.617-1.206 | 1:1 | 0.123 | 1:1 | 0.5000 | 1:1 | 0.6797 | 0.6797 |
| Germany v Cote d'Ivoire | 1.683-1.501 | 1:1 | 0.111 | 2:1 | 0.5000 | 1:1 | 0.6706 | 0.6706 |
| Argentina v Egypt | 1.43-0.957 | 1:1 | 0.133 | 1:1 | 0.5000 | 1:1 | 0.6720 | 0.6720 |
| Portugal v Spain | 0.88-1.014 | 0:0 | 0.158 | 1:1 | 0.5000 | 1:1 | 0.6668 | 0.4511 |

## Most common safe picks across all fixtures

| safe pick | fixtures | share |
|---|---|---|
| 1:1 | 998 | 44.2% |
| 1:2 | 361 | 16.0% |
| 2:1 | 361 | 16.0% |
| 2:2 | 104 | 4.6% |
| 1:3 | 89 | 3.9% |
| 3:1 | 89 | 3.9% |
| 1:0 | 59 | 2.6% |
| 0:1 | 59 | 2.6% |
| 2:0 | 37 | 1.6% |
| 0:2 | 37 | 1.6% |
| 4:1 | 14 | 0.6% |
| 1:4 | 14 | 0.6% |

## Germany: group-stage rating vs knockout reality

- Group attack: 0.584 ± 0.362 (rank 1/48)
- Knockout attack: -0.019 (rank 31/48)
- Drift: -0.603 = -1.67 standard errors

| opponent | score |
|---|---|
| Curacao | 7-1 |
| Cote d'Ivoire | 2-1 |
| Ecuador | 1-2 |